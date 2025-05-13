const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openFolderDialog: () => ipcRenderer.invoke("open-folder-dialog"),
  saveFolderPath: (path) => ipcRenderer.invoke("save-folder-path", path),
  getFolderPath: () => ipcRenderer.invoke("get-folder-path"),
});
