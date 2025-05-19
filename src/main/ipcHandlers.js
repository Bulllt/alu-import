const FileManager = require("./fileManager");
const { ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

class IPCHandlers {
  constructor() {
    this.fileManager = new FileManager(this.sendStatusToRenderer.bind(this));
    this.configPath = path.join(
      require("electron").app.getPath("userData"),
      "config.json"
    );
  }

  init(mainWindow) {
    this.mainWindow = mainWindow;
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

    // File operations
    ipcMain.handle("watch-folder", this.handleWatchFolder.bind(this));
    ipcMain.handle(
      "get-processed-files",
      this.handleGetProcessedFiles.bind(this)
    );
    ipcMain.handle(
      "delete-processed-files",
      this.handleDeleteProcessedFiles.bind(this)
    );

    // Cleanup on exit
    ipcMain.on("app-closing", () => {
      this.fileManager.cleanup();
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

  async handleWatchFolder(_, folderPath) {
    try {
      if (!(await this.handleGetFolderPath())) {
        this.sendStatusToRenderer("error", "La carpeta seleccionada no existe");
        return false;
      }

      const processedPath = await this.fileManager.setupSubfolder(folderPath);

      this.fileManager.createWatcher(folderPath, {
        onAdd: async (filePath) => {
          try {
            const result = await this.fileManager.processNewFile(
              filePath,
              processedPath
            );
            this.mainWindow.webContents.send("file-processed", result);
            this.sendStatusToRenderer(
              "success",
              `Archivo procesado: ${path.basename(filePath)}`
            );
          } catch (error) {
            this.sendStatusToRenderer(
              "error",
              `Error al procesar el archivo: ${path.basename(filePath)}`
            );
            this.mainWindow.webContents.send("file-error", {
              file: path.basename(filePath),
              error: error.message,
            });
          }
        },
      });
      return true;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        "Error al configurar el monitoreo de la carpeta"
      );
      console.error("Error setting up folder watcher:", error);
      return false;
    }
  }

  async handleGetProcessedFiles(_, folderPath) {
    try {
      const processedPath = path.join(folderPath, "processedFiles");
      const fileNames = await fs.promises.readdir(processedPath);

      return fileNames
        .filter(
          (file) => !fs.lstatSync(path.join(processedPath, file)).isDirectory()
        )
        .map((fileName) => ({
          id: fileName.split(".")[0],
          name: fileName,
          path: path.join(processedPath, fileName),
        }));
    } catch (error) {
      this.sendStatusToRenderer("error", "No se pudo extraer los archivos");
      console.error("Error getting processed files:", error);
      return [];
    }
  }

  async handleDeleteProcessedFiles() {
    try {
      const folderPath = await this.handleGetFolderPath();

      const deletedCount = await this.fileManager.deleteProcessedFiles(
        folderPath
      );
      console.log("files deleted:", deletedCount);
      return true;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        `Error deleting files: ${error.message}`
      );
      console.error("Error deleting processed files:", error);
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
