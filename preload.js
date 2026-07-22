const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listVideos: () => ipcRenderer.invoke('list-videos'),
  encryptVideo: (data) => ipcRenderer.invoke('encrypt-video', data),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  selectDirectoryDialog: () => ipcRenderer.invoke('select-directory-dialog'),
  verifyPassword: (data) => ipcRenderer.invoke('verify-password', data),
  onEncryptionProgress: (callback) => {
    ipcRenderer.on('encryption-progress', (event, progress) => callback(progress));
  },
  onFocusChange: (callback) => {
    ipcRenderer.on('focus-changed', (event, isFocused) => callback(isFocused));
  }
});
