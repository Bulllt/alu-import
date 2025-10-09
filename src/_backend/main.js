const IPCHandlers = require("./ipcHandlers");
const { app, BrowserWindow } = require("electron");
const fs = require("fs-extra");
const path = require("path");
const windowStateKeeper = require("electron-window-state");

if (require("electron-squirrel-startup")) {
  app.quit();
}

let mainWindow;
const createWindow = () => {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 800,
    defaultHeight: 600,
  });
  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
    icon: "../assets/icon.png",
  });

  mainWindowState.manage(mainWindow);
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  //mainWindow.webContents.openDevTools();
};

app.whenReady().then(() => {
  createWindow();
  const setupFileHandlers = new IPCHandlers(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  const cleanup = async () => {
    try {
      const tempDir = path.join(require("os").tmpdir(), "alu-thumbnails");
      const tempDirSecond = path.join(require("os").tmpdir(), "400px");
      if (await fs.pathExists(tempDir)) await fs.remove(tempDir);
      if (await fs.pathExists(tempDirSecond)) await fs.remove(tempDirSecond);
      setupFileHandlers.cleanup();
    } catch (error) {
      console.error("Cleanup failed:", error);
    }
  };

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      cleanup().then(() => app.quit());
    }
  });
});
