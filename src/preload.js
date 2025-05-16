const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onStatusMessage: (callback) => {
    ipcRenderer.on("status-message", (_, statusData) => callback(statusData));
    return () => ipcRenderer.removeAllListeners("status-message");
  },

  openFolderDialog: () => ipcRenderer.invoke("open-folder-dialog"),
  saveFolderPath: (path) => ipcRenderer.invoke("save-folder-path", path),
  getFolderPath: () => ipcRenderer.invoke("get-folder-path"),

  watchFolder: (path) => ipcRenderer.invoke("watch-folder", path),

  onFileProcessed: (callback) => {
    ipcRenderer.on("file-processed", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("file-processed");
  },
  offFileProcessed: (callback) => {
    ipcRenderer.removeListener("file-processed", callback);
  },
  onFileError: (callback) => {
    ipcRenderer.on("file-error", (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("file-error");
  },

  getProcessedFiles: (folderPath) =>
    ipcRenderer.invoke("get-processed-files", folderPath),
  onFileProcessed: (callback) => {
    ipcRenderer.on("file-processed", callback);
    return () => ipcRenderer.removeListener("file-processed", callback);
  },
});
