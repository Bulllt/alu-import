const FileManager = require("./fileManager");
const { ipcMain, dialog, net, shell } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const sharp = require("sharp");
const crypto = require("crypto");
require("dotenv").config();
const ffmpeg = require("fluent-ffmpeg");

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

    // File operations
    ipcMain.handle("open-image", this.handleOpenImage.bind(this));
    ipcMain.handle(
      "get-image-thumbnail",
      this.handleGetImageThumbnail.bind(this)
    );
    ipcMain.handle(
      "import-processed-files",
      this.handleImportProcessedFiles.bind(this)
    );
    ipcMain.handle("has-last-import", this.handleHasLastImport.bind(this));
    ipcMain.handle("import-rollback", this.handleImportRollback.bind(this));

    // API Calls
    ipcMain.handle("fetch-collections", this.handleFetchCollections.bind(this));
    ipcMain.handle(
      "fetch-foreign-tables",
      this.handleFetchForeignTables.bind(this)
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

  async handleImportProcessedFiles(_, files, collectionPath, fileType) {
    try {
      if (fileType === "imagenes") {
        await this.fileManager.processImageImport(files, collectionPath);
      } else if (fileType === "peliculas") {
        await this.fileManager.processMovieImport(files, collectionPath);
      } else if (fileType === "audios") {
        await this.fileManager.processAudioImport(files, collectionPath);
      } else if (fileType === "documentos") {
        await this.fileManager.processDocumentImport(files, collectionPath);
      }

      return true;
    } catch (error) {
      console.error("Error with the import:", error);
      throw error;
    }
  }

  async handleHasLastImport() {
    const config = this.readConfig();
    return !!config.lastImportCode;
  }
  async handleImportRollback() {
    try {
      const config = this.readConfig();
      if (!config.lastImportCode) {
        throw new Error("No last import found");
      }

      await this.fileManager.cleanLastImport();

      const timestamp = Math.floor(Date.now() / 1000);
      const secret = process.env.APP_SECRET;
      const hmac = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}`)
        .digest("hex");
      const token = `${timestamp}:${hmac}`;

      await this.makeGETRequest(
        `/api/deleteLastImport/${config.lastImportCode}`,
        token
      );

      const updatedConfig = {
        ...config,
        lastImportCode: null,
        lastCollectionName: null,
        lastCollectionType: null,
      };
      this.writeConfig(updatedConfig);
      this.sendStatusToRenderer(
        "success",
        "Se ha eliminado la última importación"
      );
      return true;
    } catch (error) {
      console.error("import rollback failed:", error);
      throw error;
    }
  }

  async handleGetImageThumbnail(_, filePath) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const videoExtensions = [".mp4", ".avi", ".mov", ".mkv", ".webm"];
      const audioExtensions = [".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a"];

      if (audioExtensions.includes(ext)) {
        return "audio";
      }

      if (videoExtensions.includes(ext)) {
        const tempDir = path.join(__dirname, "alu-thumbnails");
        await fs.ensureDir(tempDir);
        const thumbnailFilename = `${path.basename(
          filePath,
          ext
        )}-${Date.now()}.png`;
        const thumbnailPath = path.join(tempDir, thumbnailFilename);

        await new Promise((resolve, reject) => {
          ffmpeg(filePath)
            .screenshots({
              timestamps: ["1"],
              filename: thumbnailFilename,
              folder: tempDir,
              size: "100x?",
            })
            .on("end", resolve)
            .on("error", reject);
        });

        const thumbBuffer = await fs.readFile(thumbnailPath);
        await fs.remove(thumbnailPath);

        return `data:image/png;base64,${thumbBuffer.toString("base64")}`;
      }

      const buffer = await sharp(filePath)
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

  handleFetchCollections() {
    return this.makeGETRequest("/api/collections", "null");
  }

  handleFetchForeignTables() {
    return this.makeGETRequest("/api/foreignTables", "null");
  }

  handleFetchLastInventoryNumber(codePrefix) {
    return this.makeGETRequest(
      `/api/lastInventoryNumber/${codePrefix}`,
      "null"
    );
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
  makeGETRequest(path, token) {
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: "GET",
        protocol: "http:",
        hostname: "alu.test",
        path,
        headers: {
          Authorization: token,
        },
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
              message: parsedData.message,
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
