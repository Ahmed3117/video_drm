// Cache DOM elements
const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const sysIp = document.getElementById('sys-ip');
const sysUser = document.getElementById('sys-user');

// Video Player Elements
const videoList = document.getElementById('video-list');
const btnRefreshLibrary = document.getElementById('btn-refresh-library');
const videoWindow = document.getElementById('video-window');
const stateIdle = document.getElementById('state-idle');
const stateLocked = document.getElementById('state-locked');
const statePlaying = document.getElementById('state-playing');
const lockedVideoTitle = document.getElementById('locked-video-title');
const unlockPassword = document.getElementById('unlock-password');
const btnUnlockVideo = document.getElementById('btn-unlock-video');
const unlockError = document.getElementById('unlock-error');

// Custom HTML5 Video Player Elements
const videoContainer = document.getElementById('video-container');
const mainVideo = document.getElementById('main-video');
const playerControls = document.getElementById('player-controls');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnRewind10 = document.getElementById('btn-rewind-10');
const btnForward10 = document.getElementById('btn-forward-10');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnMute = document.getElementById('btn-mute');
const iconVolume = document.getElementById('icon-volume');
const iconMuted = document.getElementById('icon-muted');
const volumeSlider = document.getElementById('volume-slider');
const currentTimeText = document.getElementById('current-time');
const totalTimeText = document.getElementById('total-time');
const scrubContainer = document.getElementById('scrub-container');
const progressFill = document.getElementById('progress-fill');
const progressBuffer = document.getElementById('progress-buffer');
const progressHandle = document.getElementById('progress-handle');
const btnSpeed = document.getElementById('btn-speed');
const speedDropdown = document.getElementById('speed-dropdown');
const speedOptions = document.querySelectorAll('.speed-option');
const btnFullscreen = document.getElementById('btn-fullscreen');
const focusBlurOverlay = document.getElementById('focus-blur-overlay');

// Watermark Elements
const watermarkOverlay = document.getElementById('watermark-overlay');
const wmIp = document.getElementById('wm-ip');
const wmUser = document.getElementById('wm-user');
const wmTime = document.getElementById('wm-time');

// Encryptor Elements
const encInputPath = document.getElementById('enc-input-path');
const btnSelectInputFile = document.getElementById('btn-select-input-file');
const encVideoTitle = document.getElementById('enc-video-title');
const encPassword = document.getElementById('enc-password');
const btnTogglePasswordVisibility = document.getElementById('btn-toggle-password-visibility');
const encOutputPath = document.getElementById('enc-output-path');
const btnSelectOutputDir = document.getElementById('btn-select-output-dir');
const btnStartEncryption = document.getElementById('btn-start-encryption');
const encryptionProgress = document.getElementById('encryption-progress');
const progressStatus = document.getElementById('progress-status');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressPercent = document.getElementById('progress-percent');
const qualityInputs = document.querySelectorAll('input[name="enc-quality"]');

// Application States
let currentVideoFile = null;
let systemInfo = { username: 'Guest', hostname: 'Local', ip: '127.0.0.1' };
let watermarkInterval = null;
let controlsTimeout = null;
let isScrubbing = false;

// Initialize App
async function init() {
  setupTabNavigation();
  setupSecurityListeners();
  setupVideoPlayerControls();
  setupEncryptor();
  
  // Load System Info and setup watermarks
  try {
    systemInfo = await api.getSystemInfo();
    sysIp.textContent = systemInfo.ip;
    sysUser.textContent = systemInfo.username;
    
    // Set static watermark values
    wmIp.textContent = `IP: ${systemInfo.ip}`;
    wmUser.textContent = `USER: ${systemInfo.username}`;
  } catch(e) {
    console.error('Failed to load system info:', e);
  }
  
  // Load initial videos library
  loadLibrary();
  
  // Scan button
  btnRefreshLibrary.addEventListener('click', loadLibrary);
}

// ---------------- TAB NAVIGATION ----------------

function setupTabNavigation() {
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.dataset.tab;
      
      // Update nav active state
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      // Update tab pane active state
      tabPanes.forEach(pane => {
        if (pane.id === targetTab) {
          pane.classList.add('active');
        } else {
          pane.classList.remove('active');
        }
      });
      
      // Pause playing video if switching tabs
      if (targetTab !== 'tab-player') {
        pauseVideo();
      }
    });
  });
}

// ---------------- SECURITY LISTENERS ----------------

function setupSecurityListeners() {
  // Block Right-Click context menu
  window.addEventListener('contextmenu', e => {
    e.preventDefault();
  });
  
  // Block text selection
  window.addEventListener('selectstart', e => {
    e.preventDefault();
  });
  
  // Block dragging media
  window.addEventListener('dragstart', e => {
    e.preventDefault();
  });

  // Intercept key shortcuts
  window.addEventListener('keydown', e => {
    // Block DevTools shortcuts
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i')) {
      e.preventDefault();
      alert('Developer Tools are disabled for security reasons.');
    }
    
    // Block printing
    if (e.ctrlKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      alert('Printing is disabled.');
    }
    
    // Wreak havoc on clipboard when Print Screen is pressed
    if (e.key === 'PrintScreen') {
      navigator.clipboard.writeText('');
      alert('Screenshots are disabled.');
    }
  });

  // Native focus loss handler (IPC from Main Process)
  api.onFocusChange((isFocused) => {
    if (!isFocused && currentVideoFile && !mainVideo.paused) {
      pauseVideo();
      focusBlurOverlay.classList.add('active');
    } else if (isFocused) {
      focusBlurOverlay.classList.remove('active');
    }
  });
}

// ---------------- LIBRARY MANAGEMENT ----------------

async function loadLibrary() {
  videoList.innerHTML = '<div class="no-videos">Scanning library folder...</div>';
  
  try {
    const res = await api.listVideos();
    if (res.success) {
      if (res.videos.length === 0) {
        videoList.innerHTML = '<div class="no-videos">No encrypted videos found in videos/ directory.<br>Use the Encryptor Tool.</div>';
        return;
      }
      
      videoList.innerHTML = '';
      res.videos.forEach(video => {
        const item = document.createElement('div');
        item.className = 'video-item';
        item.innerHTML = `
          <div class="video-item-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
          <div class="video-item-info">
            <span class="video-item-title">${escapeHTML(video.title)}</span>
            <span class="video-item-meta">${video.quality ? `${escapeHTML(video.quality)} • ` : ''}${formatBytes(video.size)} • ${formatDate(video.addedAt)}</span>
          </div>
        `;
        
        item.addEventListener('click', () => selectVideo(video, item));
        videoList.appendChild(item);
      });
    } else {
      videoList.innerHTML = `<div class="no-videos" style="color:var(--danger)">Error: ${res.error}</div>`;
    }
  } catch (err) {
    videoList.innerHTML = `<div class="no-videos" style="color:var(--danger)">Failed to scan folder.</div>`;
  }
}

function selectVideo(video, selectedItem) {
  // Clear active classes
  document.querySelectorAll('.video-item').forEach(item => item.classList.remove('active'));
  selectedItem.classList.add('active');

  // Reset player state
  stopVideo();
  currentVideoFile = video;
  
  // Switch to Locked Screen state
  switchPlayerState('locked');
  lockedVideoTitle.textContent = video.quality ? `${video.title} (${video.quality})` : video.title;
  unlockPassword.value = '';
  unlockError.textContent = '';
  unlockPassword.focus();
}

// ---------------- DECRYPTION & UNLOCKING ----------------

btnUnlockVideo.addEventListener('click', performUnlock);
unlockPassword.addEventListener('keydown', e => {
  if (e.key === 'Enter') performUnlock();
});

async function performUnlock() {
  const password = unlockPassword.value.trim();
  if (!password) {
    unlockError.textContent = 'Please enter a password.';
    return;
  }
  
  btnUnlockVideo.disabled = true;
  unlockError.textContent = 'Verifying key...';
  
  try {
    const res = await api.verifyPassword({
      filePath: currentVideoFile.path,
      password
    });
    
    if (res.success) {
      unlockError.textContent = '';
      startPlayback(currentVideoFile.path);
    } else {
      unlockError.textContent = res.error || 'Incorrect decryption key.';
    }
  } catch (err) {
    unlockError.textContent = 'An error occurred during verification.';
  } finally {
    btnUnlockVideo.disabled = false;
  }
}

// ---------------- PLAYBACK ENGINE ----------------

function startPlayback(filePath) {
  switchPlayerState('playing');
  
  // Source is custom stream protocol containing the file path as query param
  mainVideo.src = `safe-video://stream?file=${encodeURIComponent(filePath)}&t=${Date.now()}`;
  mainVideo.load();
  
  // Auto-play
  playVideo();
  
  // Initialize floating watermarks
  startWatermarkLoop();
}

function switchPlayerState(state) {
  stateIdle.classList.remove('active');
  stateLocked.classList.remove('active');
  statePlaying.classList.remove('active');
  
  if (state === 'idle') stateIdle.classList.add('active');
  else if (state === 'locked') stateLocked.classList.add('active');
  else if (state === 'playing') statePlaying.classList.add('active');
}

// ---------------- CUSTOM PLAYER CONTROLS ----------------

function setupVideoPlayerControls() {
  // Play/Pause Click Handler
  btnPlayPause.addEventListener('click', togglePlayPause);
  btnRewind10.addEventListener('click', () => seekBy(-10));
  btnForward10.addEventListener('click', () => seekBy(10));
  mainVideo.addEventListener('click', togglePlayPause);
  
  // Keyboard Play/Pause (Space bar)
  window.addEventListener('keydown', e => {
    if (e.key === ' ' && currentVideoFile && statePlaying.classList.contains('active')) {
      // Prevent scrolling page down
      e.preventDefault();
      togglePlayPause();
    }
  });

  // Mute/Unmute
  btnMute.addEventListener('click', toggleMute);
  
  // Volume Slider
  volumeSlider.addEventListener('input', () => {
    mainVideo.volume = volumeSlider.value;
    mainVideo.muted = volumeSlider.value === 0;
    updateVolumeIcon();
  });

  // Time Updates
  mainVideo.addEventListener('timeupdate', updateProgressBar);
  mainVideo.addEventListener('durationchange', () => {
    totalTimeText.textContent = formatTime(mainVideo.duration);
  });
  
  // Buffered progress bar
  mainVideo.addEventListener('progress', updateBufferedBar);

  // Timeline seeking click
  scrubContainer.addEventListener('mousedown', startScrubbing);
  window.addEventListener('mousemove', scrub);
  window.addEventListener('mouseup', stopScrubbing);

  // Speed controls
  btnSpeed.addEventListener('click', (e) => {
    e.stopPropagation();
    speedDropdown.classList.toggle('show');
  });
  
  window.addEventListener('click', () => {
    speedDropdown.classList.remove('show');
  });
  
  speedOptions.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const speed = parseFloat(opt.dataset.speed);
      mainVideo.playbackRate = speed;
      btnSpeed.textContent = opt.textContent;
      
      speedOptions.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      
      speedDropdown.classList.remove('show');
    });
  });

  // Fullscreen
  btnFullscreen.addEventListener('click', toggleFullscreen);
  
  // Auto-hide controls cursor when mouse is idle
  videoContainer.addEventListener('mousemove', showControlsAndCursor);
  videoContainer.addEventListener('mouseleave', () => {
    videoContainer.classList.remove('show-controls');
  });
}

function seekBy(seconds) {
  if (!Number.isFinite(mainVideo.duration)) return;
  mainVideo.currentTime = Math.max(0, Math.min(mainVideo.duration, mainVideo.currentTime + seconds));
  updateProgressBar();
}

function togglePlayPause() {
  if (mainVideo.paused) {
    playVideo();
  } else {
    pauseVideo();
  }
}

function playVideo() {
  mainVideo.play().then(() => {
    iconPlay.classList.add('hidden');
    iconPause.classList.remove('hidden');
  }).catch(err => {
    console.error('Play aborted:', err);
  });
}

function pauseVideo() {
  mainVideo.pause();
  iconPlay.classList.remove('hidden');
  iconPause.classList.add('hidden');
}

function stopVideo() {
  pauseVideo();
  mainVideo.src = '';
  currentVideoFile = null;
  stopWatermarkLoop();
}

function toggleMute() {
  mainVideo.muted = !mainVideo.muted;
  updateVolumeIcon();
}

function updateVolumeIcon() {
  if (mainVideo.muted || mainVideo.volume === 0) {
    iconVolume.classList.add('hidden');
    iconMuted.classList.remove('hidden');
    volumeSlider.value = 0;
  } else {
    iconVolume.classList.remove('hidden');
    iconMuted.classList.add('hidden');
    volumeSlider.value = mainVideo.volume;
  }
}

function updateProgressBar() {
  if (mainVideo.duration && !isScrubbing) {
    const percentage = (mainVideo.currentTime / mainVideo.duration) * 100;
    progressFill.style.width = `${percentage}%`;
    progressHandle.style.left = `${percentage}%`;
    currentTimeText.textContent = formatTime(mainVideo.currentTime);
  }
}

function updateBufferedBar() {
  if (mainVideo.duration && mainVideo.buffered.length > 0) {
    const endBuffer = mainVideo.buffered.end(mainVideo.buffered.length - 1);
    const percentage = (endBuffer / mainVideo.duration) * 100;
    progressBuffer.style.width = `${percentage}%`;
  }
}

function startScrubbing(e) {
  isScrubbing = true;
  scrub(e);
}

function scrub(e) {
  if (!isScrubbing || !mainVideo.duration) return;
  
  const rect = scrubContainer.getBoundingClientRect();
  let clientX = e.clientX;
  
  // Touch support check
  if (e.touches && e.touches[0]) {
    clientX = e.touches[0].clientX;
  }
  
  let percentage = (clientX - rect.left) / rect.width;
  percentage = Math.max(0, Math.min(percentage, 1));
  
  progressFill.style.width = `${percentage * 100}%`;
  progressHandle.style.left = `${percentage * 100}%`;
  currentTimeText.textContent = formatTime(percentage * mainVideo.duration);
  
  mainVideo.currentTime = percentage * mainVideo.duration;
}

function stopScrubbing() {
  isScrubbing = false;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    videoContainer.requestFullscreen().catch(err => {
      console.error(`Error enabling fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}

// Auto-hides controls after 2.5s of mouse inactivity
function showControlsAndCursor() {
  videoContainer.classList.add('show-controls');
  videoContainer.classList.remove('hide-cursor');
  
  clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(() => {
    if (!mainVideo.paused && !isScrubbing) {
      videoContainer.classList.remove('show-controls');
      videoContainer.classList.add('hide-cursor');
    }
  }, 2500);
}

// ---------------- WATERMARK DRIFTER ----------------

function startWatermarkLoop() {
  stopWatermarkLoop();
  
  // Initial position
  moveWatermark();
  
  // Move watermark randomly every 4 seconds
  watermarkInterval = setInterval(() => {
    moveWatermark();
  }, 4000);
}

function stopWatermarkLoop() {
  if (watermarkInterval) {
    clearInterval(watermarkInterval);
    watermarkInterval = null;
  }
}

function moveWatermark() {
  if (!currentVideoFile) return;

  // Update dynamic time inside watermark
  const now = new Date();
  wmTime.textContent = `TIME: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;

  const containerW = videoContainer.clientWidth;
  const containerH = videoContainer.clientHeight;

  // Select all three watermark components
  const items = [wmIp, wmUser, wmTime];
  
  items.forEach(item => {
    // Generate a random position (keeping 15% margins from borders to prevent overflow)
    const maxX = containerW - item.clientWidth - 50;
    const maxY = containerH - item.clientHeight - 50;
    
    const randomX = Math.max(50, Math.floor(Math.random() * maxX));
    const randomY = Math.max(50, Math.floor(Math.random() * maxY));
    
    item.style.left = `${randomX}px`;
    item.style.top = `${randomY}px`;
  });
}

// ---------------- ENCRYPTOR MANAGEMENT ----------------

function setupEncryptor() {
  api.onEncryptionProgress(({ percent, status }) => {
    progressBarFill.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    progressStatus.textContent = status;
  });

  // Input File Picker
  btnSelectInputFile.addEventListener('click', async () => {
    const path = await api.openFileDialog();
    if (path) {
      encInputPath.value = path;
      // Pre-fill title with filename (without ext)
      const filename = path.split(/[\\/]/).pop();
      encVideoTitle.value = filename.replace(/\.[^/.]+$/, "");
    }
  });

  // Output Directory Picker
  btnSelectOutputDir.addEventListener('click', async () => {
    const path = await api.selectDirectoryDialog();
    if (path) {
      encOutputPath.value = path;
    }
  });

  // Password Visibility Toggle
  btnTogglePasswordVisibility.addEventListener('click', () => {
    if (encPassword.type === 'password') {
      encPassword.type = 'text';
    } else {
      encPassword.type = 'password';
    }
  });

  // Start Encryption Trigger
  btnStartEncryption.addEventListener('click', async () => {
    const input = encInputPath.value;
    const title = encVideoTitle.value.trim();
    const password = encPassword.value.trim();
    const output = encOutputPath.value;
    const qualities = [...qualityInputs]
      .filter(input => input.checked)
      .map(input => Number(input.value));
    
    if (!input) {
      alert('Please select an input video file.');
      return;
    }
    if (!password) {
      alert('Please enter a decryption password.');
      return;
    }
    if (qualities.length === 0) {
      alert('Please select at least one output quality.');
      return;
    }
    
    // Disable inputs
    btnStartEncryption.disabled = true;
    btnSelectInputFile.disabled = true;
    btnSelectOutputDir.disabled = true;
    encPassword.disabled = true;
    encVideoTitle.disabled = true;
    qualityInputs.forEach(input => { input.disabled = true; });
    
    // Show Progress
    encryptionProgress.classList.add('active');
    progressBarFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressStatus.textContent = 'Preparing video renditions...';

    try {
      const res = await api.encryptVideo({
        inputPath: input,
        outputPath: output,
        password,
        title,
        qualities
      });
      
      if (res.success) {
        progressBarFill.style.width = '100%';
        progressPercent.textContent = '100%';
        progressStatus.textContent = 'Encryption completed successfully!';
        progressBarFill.style.backgroundColor = 'var(--success)';
        
        alert(`Success! ${res.outputPaths.length} encrypted qualities created:\n${res.outputPaths.join('\n')}`);
        
        // Reset Form
        encInputPath.value = '';
        encVideoTitle.value = '';
        encPassword.value = '';
        
        // Scan library so it registers the new video
        loadLibrary();
      } else {
        throw new Error(res.error || 'Encryption process failed.');
      }
    } catch (err) {
      progressBarFill.style.width = '100%';
      progressPercent.textContent = 'Error';
      progressStatus.textContent = `Error: ${err.message}`;
      progressBarFill.style.backgroundColor = 'var(--danger)';
      alert(`Encryption failed: ${err.message}`);
    } finally {
      // Re-enable inputs
      btnStartEncryption.disabled = false;
      btnSelectInputFile.disabled = false;
      btnSelectOutputDir.disabled = false;
      encPassword.disabled = false;
      encVideoTitle.disabled = false;
      qualityInputs.forEach(input => { input.disabled = false; });
      
      // Auto-hide progress block after 6 seconds
      setTimeout(() => {
        encryptionProgress.classList.remove('active');
        progressBarFill.style.backgroundColor = 'var(--success)'; // Restore default green
      }, 6000);
    }
  });
}

// ---------------- UTILITY HELPERS ----------------

function formatTime(seconds) {
  if (isNaN(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const formattedM = m.toString().padStart(2, '0');
  const formattedS = s.toString().padStart(2, '0');
  
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${formattedM}:${formattedS}`;
  }
  return `${formattedM}:${formattedS}`;
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString();
  } catch(e) {
    return 'Unknown date';
  }
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', init);
