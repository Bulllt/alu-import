const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onStatusMessage: (callback) => {
    ipcRenderer.on("status-message", (_, statusData) => callback(statusData));
    return () => ipcRenderer.removeAllListeners("status-message");
  },

  // Folder selection APIs
  openFolderDialog: () => ipcRenderer.invoke("open-folder-dialog"),
  saveFolderPath: (path) => ipcRenderer.invoke("save-folder-path", path),
  getFolderPath: () => ipcRenderer.invoke("get-folder-path"),

  // Collection APIs
  scanCollections: (folderPath) =>
    ipcRenderer.invoke("scan-collections", folderPath),
  startCollectionProcessing: (collectionPath) =>
    ipcRenderer.invoke("start-collection-processing", collectionPath),
  executeRollback: (collectionPath) =>
    ipcRenderer.invoke("execute-rollback", collectionPath),

  // File APIs
  onFileProcessed: (callback) => {
    const wrappedCallback = (event, data) => {
      const files = Array.isArray(data) ? data : [data];
      callback(event, files.filter(Boolean));
    };
    ipcRenderer.on("file-processed", wrappedCallback);
    return () => ipcRenderer.removeListener("file-processed", wrappedCallback);
  },
  offFileProcessed: (callback) => {
    ipcRenderer.removeListener("file-processed", callback);
  },
});
