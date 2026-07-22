const { app, BrowserWindow, protocol, ipcMain, dialog, net } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { 
  parseHeader, 
  createDecryptedRangeStream, 
  verifyFilePassword, 
  encryptFile 
} = require('./encryptor');

// Setup video storage directory
const VIDEOS_DIR = path.join(__dirname, 'videos');
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

// In-memory key store for authenticated streaming sessions (filePath -> password)
const activeSessions = new Map();

const QUALITY_PRESETS = {
  360: { height: 360, videoBitrate: '800k', audioBitrate: '96k' },
  480: { height: 480, videoBitrate: '1400k', audioBitrate: '128k' },
  720: { height: 720, videoBitrate: '2800k', audioBitrate: '128k' },
  1080: { height: 1080, videoBitrate: '5000k', audioBitrate: '192k' }
};

function transcodeVideo(inputPath, outputPath, preset) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-vf', `scale=-2:${preset.height}`,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-b:v', preset.videoBitrate,
      '-maxrate', preset.videoBitrate,
      '-bufsize', `${parseInt(preset.videoBitrate, 10) * 2}k`,
      '-c:a', 'aac',
      '-b:a', preset.audioBitrate,
      '-movflags', '+faststart',
      outputPath
    ];
    const ffmpeg = spawn('ffmpeg', args, { windowsHide: true });
    let stderr = '';

    ffmpeg.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    ffmpeg.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error('FFmpeg is not installed or is not available in PATH.'));
      } else {
        reject(err);
      }
    });
    ffmpeg.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed with exit code ${code}: ${stderr.trim()}`));
    });
  });
}

// Helper to get local network IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '127.0.0.1';
}

// 1. Register custom scheme as privileged (must be before app ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'safe-video',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true, // Crucial for video element compatibility
      bypassCSP: true
    }
  }
]);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Secure Native Video Player',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true // Set to true to allow development, but F12 shortcuts are disabled
    }
  });

  // Enable native content protection (blocks screen captures/shares on Win/macOS)
  mainWindow.setContentProtection(true);

  // Load the dashboard
  mainWindow.loadFile('index.html');

  // Prevent opening DevTools via standard keyboard shortcuts (F12, Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      // In development we might want to comment this out, but for security we restrict it
      event.preventDefault();
    }
  });

  // Handle focus and blur to alert renderer (helps pause/blur video when switching apps)
  mainWindow.on('blur', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('focus-changed', false);
    }
  });

  mainWindow.on('focus', () => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('focus-changed', true);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 2. Set up the secure custom video protocol handler
function setupProtocol() {
  protocol.handle('safe-video', async (request) => {
    try {
      const urlObj = new URL(request.url);
      const filePath = decodeURIComponent(urlObj.searchParams.get('file'));
      
      // Verify session exists for this file
      if (!activeSessions.has(filePath)) {
        return new Response('Unauthorized: Please unlock the video file first.', {
          status: 403,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      const password = activeSessions.get(filePath);
      const rangeHeader = request.headers.get('range');
      
      let start = 0;
      let end = null;

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        start = parseInt(parts[0], 10);
        end = parts[1] ? parseInt(parts[1], 10) : null;
      }

      const { stream, streamSize, totalDecryptedSize } = await createDecryptedRangeStream(
        filePath,
        password,
        start,
        end
      );

      const targetEnd = (end === null || end === undefined) ? totalDecryptedSize - 1 : end;

      if (rangeHeader) {
        return new Response(stream, {
          status: 206, // Partial content
          headers: {
            'Content-Range': `bytes ${start}-${targetEnd}/${totalDecryptedSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': streamSize.toString(),
            'Content-Type': 'video/mp4'
          }
        });
      } else {
        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Length': totalDecryptedSize.toString(),
            'Content-Type': 'video/mp4'
          }
        });
      }
    } catch (err) {
      console.error('Protocol handler error:', err);
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  });
}

// Initialize Application
app.whenReady().then(() => {
  setupProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC IPC HANDLERS ---

// 1. List all .envideo files in the videos folder
ipcMain.handle('list-videos', async () => {
  try {
    const files = fs.readdirSync(VIDEOS_DIR);
    const videoFiles = files.filter(f => f.endsWith('.envideo'));
    
    const results = [];
    for (const file of videoFiles) {
      const fullPath = path.join(VIDEOS_DIR, file);
      try {
        const { metadata } = await parseHeader(fullPath);
        results.push({
          path: fullPath,
          name: file,
          title: metadata.title || file,
          addedAt: metadata.addedAt,
          size: metadata.originalSize,
          quality: metadata.quality || null,
          variantGroup: metadata.variantGroup || null
        });
      } catch (err) {
        console.error(`Failed to parse header for ${file}:`, err);
      }
    }
    return { success: true, videos: results };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 2. Open file dialog to select a video for encryption
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov'] }
    ]
  });
  return result.filePaths[0];
});

// 3. Open dialog to select directory for saving output
ipcMain.handle('select-directory-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  return result.filePaths[0];
});

// 4. Encrypt a raw video file
ipcMain.handle('encrypt-video', async (event, { inputPath, outputPath, password, title, qualities }) => {
  let tempDir;
  try {
    const finalOutputDir = outputPath || VIDEOS_DIR;
    const basename = path.basename(inputPath, path.extname(inputPath));
    const selectedQualities = [...new Set((qualities || []).map(Number))]
      .filter(quality => QUALITY_PRESETS[quality])
      .sort((a, b) => a - b);

    if (selectedQualities.length === 0) {
      throw new Error('Select at least one output quality.');
    }

    fs.mkdirSync(finalOutputDir, { recursive: true });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-video-'));
    const variantGroup = `${basename}-${Date.now()}`;
    const outputPaths = [];

    for (let index = 0; index < selectedQualities.length; index++) {
      const quality = selectedQualities[index];
      const preset = QUALITY_PRESETS[quality];
      const tempPath = path.join(tempDir, `${basename}-${quality}p.mp4`);
      const finalOutputPath = path.join(finalOutputDir, `${basename}-${quality}p.envideo`);
      const startPercent = Math.round((index / selectedQualities.length) * 90);

      event.sender.send('encryption-progress', {
        percent: startPercent,
        status: `Transcoding ${quality}p rendition...`
      });
      await transcodeVideo(inputPath, tempPath, preset);

      event.sender.send('encryption-progress', {
        percent: startPercent + Math.round(70 / selectedQualities.length),
        status: `Encrypting ${quality}p rendition...`
      });
      await encryptFile(tempPath, finalOutputPath, password, {
        title: title || basename,
        quality: `${quality}p`,
        variantGroup
      });
      outputPaths.push(finalOutputPath);
    }

    event.sender.send('encryption-progress', {
      percent: 100,
      status: 'All renditions encrypted successfully.'
    });
    return { success: true, outputPaths };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

// 5. Verify the password and unlock a video for streaming
ipcMain.handle('verify-password', async (event, { filePath, password }) => {
  const isValid = await verifyFilePassword(filePath, password);
  if (isValid) {
    activeSessions.set(filePath, password);
    const { metadata } = await parseHeader(filePath);
    return { success: true, metadata };
  } else {
    return { success: false, error: 'Incorrect password.' };
  }
});

// 6. Get local system details for watermarking
ipcMain.handle('get-system-info', async () => {
  try {
    return {
      username: os.userInfo().username,
      hostname: os.hostname(),
      ip: getLocalIP()
    };
  } catch (err) {
    return {
      username: 'User',
      hostname: 'LocalMachine',
      ip: '127.0.0.1'
    };
  }
});
