const FileManager = require("./fileManager");
const { ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

class IPCHandlers {
  constructor() {
    this.configPath = path.join(
      require("electron").app.getPath("userData"),
      "config.json"
    );
    this.fileManager = new FileManager(
      this.sendStatusToRenderer.bind(this),
      this.configPath
    );
  }

  init(mainWindow) {
    this.mainWindow = mainWindow;
    this.fileManager.mainWindow = mainWindow;
    this.setupHandlers();
  }

  sendStatusToRenderer(type, message) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("status-message", { type, message });
    }
  }

  setupHandlers() {
    // Config handlers
    ipcMain.handle(
      "open-folder-dialog",
      this.handleOpenFolderDialog.bind(this)
    );
    ipcMain.handle("save-folder-path", this.handleSaveFolderPath.bind(this));
    ipcMain.handle("get-folder-path", this.handleGetFolderPath.bind(this));

    // Collection operations
    ipcMain.handle("scan-collections", this.handleScanCollections.bind(this));
    ipcMain.handle(
      "start-collection-processing",
      this.handleStartCollectionProcessing.bind(this)
    );
    ipcMain.handle("execute-rollback", this.handleExecuteRollback.bind(this));

    // Cleanup on exit
    ipcMain.on("close-app", () => {
      this.fileManager.cleanup();
      app.quit();
    });
  }

  async handleOpenFolderDialog() {
    try {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ["openDirectory"],
        title: "Seleccionar carpeta de archivos",
        buttonLabel: "Seleccionar",
      });
      return result;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        "No se pudo abrir el selector de carpetas"
      );
      console.error("Error opening folder dialog:", error);
      throw error;
    }
  }

  async handleSaveFolderPath(_, folderPath) {
    try {
      const config = this.readConfig();
      config.folderPath = folderPath;
      this.writeConfig(config);
      this.sendStatusToRenderer("success", "Carpeta guardada correctamente");
      return true;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        "No se pudo guardar la ruta de la carpeta"
      );
      console.error("Error saving folder path:", error);
      return false;
    }
  }

  handleGetFolderPath() {
    try {
      return this.readConfig().folderPath || null;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        "No se pudo obtener la ruta de la carpeta"
      );
      console.error("Error getting folder path:", error);
      return null;
    }
  }

  async handleScanCollections(_, folderPath) {
    try {
      await this.fileManager.createWatcher(folderPath);
      return this.fileManager.pendingCollections;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        `Error escaneando colecciones: ${error.message}`
      );
      return [];
    }
  }

  async handleStartCollectionProcessing(_, collectionPath) {
    try {
      const success = await this.fileManager.startCollectionProcessing(
        collectionPath
      );

      if (!success) {
        this.sendStatusToRenderer("error", "Error al comenzar el proceso");
        throw new Error("Failed to start collection processing");
      }

      return true;
    } catch (error) {
      this.sendStatusToRenderer("error", "Error al comenzar el proceso");
      return false;
    }
  }

  async handleExecuteRollback(_, collectionPath) {
    try {
      await this.fileManager.executeRollback(collectionPath);
      return true;
    } catch (error) {
      console.error("Rollback failed:", error);
      return false;
    }
  }

  // Helpers functions
  readConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        return JSON.parse(fs.readFileSync(this.configPath, "utf8"));
      }
      return { folderPath: null };
    } catch (error) {
      this.sendStatusToRenderer("error", "Error al leer el path de la carpeta");
      console.error("Error reading path:", error);
      return { folderPath: null };
    }
  }
  writeConfig(config) {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      this.sendStatusToRenderer("error", "Error al guardar la configuración");
      console.error("Error writing config:", error);
      throw error;
    }
  }
}

function setupFileHandlers(mainWindow) {
  if (!mainWindow) {
    console.error("MainWindow is undefined in setupFileHandlers");
    return;
  }
  const ipcHandlers = new IPCHandlers();
  ipcHandlers.init(mainWindow);
}

module.exports = { setupFileHandlers };
