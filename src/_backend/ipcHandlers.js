const FileManager = require("./fileManager");
const { ipcMain, dialog, net, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

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

    // API Calls
    ipcMain.handle("fetch-collections", this.handleFetchCollections.bind(this));
    ipcMain.handle(
      "fetch-foreign-tables",
      this.handleFetchForeignTables.bind(this)
    );

    // Extra
    ipcMain.handle("open-image", this.handleOpenImage.bind(this));
    ipcMain.handle(
      "get-image-thumbnail",
      this.handleGetImageThumbnail.bind(this)
    );

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
      const collectionFolder = path.basename(collectionPath);
      const codePrefix = collectionFolder.split("_")[0];
      const lastInventoryNumber = await this.handleFetchLastInventoryNumber(
        codePrefix
      );

      const currentConfig = this.readConfig();
      const updatedConfig = {
        ...currentConfig,
        inventoryNumber: lastInventoryNumber.data,
      };
      this.writeConfig(updatedConfig);

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

  handleFetchCollections() {
    return this.makeGETRequest("/api/collections");
  }

  handleFetchForeignTables() {
    return this.makeGETRequest("/api/foreignTables");
  }

  handleFetchLastInventoryNumber(codePrefix) {
    return this.makeGETRequest(`/api/lastInventoryNumber/${codePrefix}`);
  }

  async handleGetImageThumbnail(_, path) {
    try {
      const buffer = await sharp(path)
        .resize(100, 100, { fit: "inside" })
        .toBuffer();

      return `data:image/png;base64,${buffer.toString("base64")}`;
    } catch (error) {
      console.error("Error generating thumbnail:", error);
      return null;
    }
  }

  handleOpenImage(_, path) {
    shell.openPath(path);
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
  makeGETRequest(path) {
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: "GET",
        protocol: "http:",
        hostname: "alu.test",
        path,
      });

      let responseData = "";

      request.on("response", (response) => {
        response.on("data", (chunk) => {
          responseData += chunk.toString();
        });

        response.on("end", () => {
          try {
            const parsedData = JSON.parse(responseData);
            resolve({
              statusCode: response.statusCode,
              headers: response.headers,
              status: parsedData.status,
              data: parsedData.data,
            });
          } catch (error) {
            console.error("[NET] JSON parse error:", error);
            resolve({
              statusCode: response.statusCode,
              status: "error",
              error: "Invalid JSON response",
              rawData: responseData,
            });
          }
        });
      });

      request.on("error", (error) => {
        console.error("[NET] Request error:", error);
        reject(new Error(`Request failed: ${error.message}`));
      });

      request.end();
    });
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
