const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const windowStateKeeper = require("electron-window-state");
const path = require("path");
const fs = require("fs");

if (require("electron-squirrel-startup")) {
  app.quit();
}

const createWindow = () => {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 800,
    defaultHeight: 600,
  });

  const mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
    autoHideMenuBar: true,
  });

  mainWindowState.manage(mainWindow);
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  mainWindow.webContents.openDevTools();
};

const getConfigPath = () => {
  return path.join(app.getPath("userData"), "config.json");
};
const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath()));
  } catch {
    return { folderPath: null };
  }
};
const writeConfig = (config) => {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config));
};

app.whenReady().then(() => {
  ipcMain.handle("open-folder-dialog", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Seleccionar carpeta de archivos",
      buttonLabel: "Seleccionar",
    });
    return result;
  });
  ipcMain.handle("save-folder-path", (event, folderPath) => {
    const config = readConfig();
    config.folderPath = folderPath;
    writeConfig(config);
  });
  ipcMain.handle("get-folder-path", () => {
    return readConfig().folderPath;
  });

  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
