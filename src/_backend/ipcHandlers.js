const FileManager = require("./fileManager");
const WorkerManager = require("./workerManager");
const { ipcMain, dialog, net, shell } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const crypto = require("crypto");
const XLSX = require("xlsx");
require("dotenv").config({
  path: path.join(process.resourcesPath, ".env"),
});
const variablesConfig = require("./variablesConfig");

class IPCHandlers {
  constructor(mainWindow) {
    this.configPath = path.join(
      require("electron").app.getPath("userData"),
      "config.json"
    );

    this.fileManager = new FileManager(
      this.sendStatusToRenderer.bind(this),
      this.configPath
    );
    this.workerManager = new WorkerManager(mainWindow, this.fileManager);
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

    // Excel file handlers
    ipcMain.handle("open-file-dialog", this.handleOpenFileDialog.bind(this));
    ipcMain.handle(
      "read-file-as-buffer",
      this.handleReadFileAsBuffer.bind(this)
    );
    ipcMain.handle(
      "process-excel-file-buffer",
      this.handleProcessExcelFileBuffer.bind(this)
    );

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
      this.fileManager.initializePath();
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
      const pathLength = collectionPath.split("\\").length;
      const codePrefix = collectionPath.split("\\")[pathLength - 2];
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
        collectionPath,
        codePrefix
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

  async handleOpenFileDialog() {
    try {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ["openFile"],
        title: "Seleccionar archivo Excel",
        buttonLabel: "Seleccionar",
        filters: [
          {
            name: "Archivos Excel",
            extensions: ["xlsx", "xls", "xlsm"],
          },
        ],
      });
      return result;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        "No se pudo abrir el selector de archivos"
      );
      console.error("Error opening file dialog:", error);
      throw error;
    }
  }

  async handleReadFileAsBuffer(_, filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe: ${filePath}`);
      }

      const fileBuffer = fs.readFileSync(filePath);

      return Array.from(fileBuffer);
    } catch (error) {
      console.error("Error reading file as buffer:", error);
      throw new Error(`Error al leer el archivo: ${error.message}`);
    }
  }

  async handleProcessExcelFileBuffer(_, fileBuffer, inventoryCodes) {
    try {
      const buffer = Buffer.from(fileBuffer);

      const workbook = XLSX.read(buffer, { type: "buffer" });

      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        this.sendStatusToRenderer(
          "error",
          "El archivo Excel no contiene hojas de cálculo."
        );
        throw new Error("El archivo Excel no contiene hojas de cálculo.");
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      if (!worksheet) {
        this.sendStatusToRenderer(
          "error",
          "La primera hoja del archivo Excel está vacía o corrupta."
        );
        throw new Error(
          "La primera hoja del archivo Excel está vacía o corrupta."
        );
      }

      let data;
      try {
        data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      } catch (convertError) {
        this.sendStatusToRenderer(
          "error",
          "Error al convertir los datos del Excel."
        );
        throw new Error("Error al convertir los datos del Excel.");
      }

      if (!data || data.length === 0) {
        this.sendStatusToRenderer("error", "El archivo Excel está vacío");
        throw new Error("El archivo Excel está vacío");
      }

      let headerRow = data[0];

      if (!headerRow || headerRow.every((cell) => !cell)) {
        headerRow = data.find((row) => row && row.some((cell) => cell));
        if (!headerRow) {
          this.sendStatusToRenderer(
            "error",
            "No se encontraron datos en el archivo Excel"
          );
          throw new Error("No se encontraron datos en el archivo Excel");
        }
      }

      const inventoryColIndex = headerRow.findIndex((cell) =>
        String(cell).toLowerCase().includes("inventario")
      );

      if (inventoryColIndex === -1) {
        this.sendStatusToRenderer(
          "error",
          "No se encontró la columna 'Inventario' en el archivo Excel"
        );
        throw new Error(
          "No se encontró la columna 'Inventario' en el archivo Excel"
        );
      }

      const validColumns = [
        "description",
        "elements",
        "object_annotations",
        "container_annotations",
        "day",
        "month",
        "year",
        "CA",
        "ubicacion_id",
        "communes_id",
        "ubications_id",
        "censored",
        "censored_reason",
        "published",
        "author",
        "container_type",
        "container_number",
        "old_id",
        "title",
        "history",
        "information",
        "peoples",
        "tags",
        "streets",
      ];

      const columnMappings = {};
      headerRow.forEach((header, index) => {
        if (!header) return;

        const headerStr = String(header).toLowerCase().trim();
        const matchedColumn = validColumns.find((col) =>
          headerStr.includes(col)
        );
        if (matchedColumn && index !== inventoryColIndex) {
          columnMappings[index] = matchedColumn;
        }
      });

      if (Object.keys(columnMappings).length === 0) {
        this.sendStatusToRenderer(
          "error",
          "No se encontraron columnas válidas en el archivo Excel"
        );
        throw new Error(
          "No se encontraron columnas válidas en el archivo Excel"
        );
      }

      const updates = [];
      let matchedCodes = 0;

      const dataStartIndex = data.findIndex((row) => row === headerRow) + 1;

      for (let i = dataStartIndex; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;

        const inventoryCode = row[inventoryColIndex];
        if (!inventoryCode) continue;

        const inventoryCodeStr = String(inventoryCode).trim();

        if (
          inventoryCodes.some(
            (code) =>
              String(code).trim().toLowerCase() ===
              inventoryCodeStr.toLowerCase()
          )
        ) {
          matchedCodes++;
          const rowUpdates = {};

          Object.entries(columnMappings).forEach(([colIndex, columnId]) => {
            const value = row[parseInt(colIndex)];
            if (value !== undefined && value !== null && value !== "") {
              if (columnId === "censored" || columnId === "published") {
                if (
                  String(value).toLowerCase() === "true" ||
                  String(value).toLowerCase() === "1" ||
                  String(value).toLowerCase() === "sí"
                ) {
                  rowUpdates[columnId] = true;
                } else if (
                  String(value).toLowerCase() === "false" ||
                  String(value).toLowerCase() === "0" ||
                  String(value).toLowerCase() === "no"
                ) {
                  rowUpdates[columnId] = false;
                } else {
                  rowUpdates[columnId] = value;
                }
              } else {
                rowUpdates[columnId] = value;
              }
            }
          });

          if (Object.keys(rowUpdates).length > 0) {
            updates.push({
              inventoryCode: inventoryCodeStr,
              updates: rowUpdates,
            });
          }
        }
      }

      if (matchedCodes === 0) {
        this.sendStatusToRenderer(
          "error",
          "No se encontraron códigos de inventario coincidentes"
        );
        throw new Error("No se encontraron códigos de inventario coincidentes");
      }

      return {
        success: true,
        totalRows: data.length - dataStartIndex,
        matchedCodes,
        updates,
        columnsFound: Object.values(columnMappings),
      };
    } catch (error) {
      console.error("Error processing Excel file:", error);
      this.sendStatusToRenderer(
        "error",
        `Error procesando archivo Excel: ${error.message}`
      );
      throw error;
    }
  }

  async handleImportProcessedFiles(_, files, collectionPath, fileType) {
    try {
      if (fileType === "imagenes") {
        return await this.workerManager.processImages(files, collectionPath);
      } else if (fileType === "peliculas") {
        return await this.workerManager.processMovies(files, collectionPath);
      } else if (fileType === "audios") {
        return await this.workerManager.processAudios(files, collectionPath);
      } else if (fileType === "documentos") {
        return await this.workerManager.processDocuments(files, collectionPath);
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
      const secret = process.env.IMPORT_APP_SECRET;
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
      return await this.workerManager.getThumbnails(filePath);
    } catch (error) {
      console.error("Error getting thumbnail:", error);
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
        protocol: variablesConfig.apiConfig.protocol,
        hostname: variablesConfig.apiConfig.hostname,
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

  cleanup() {
    this.workerManager.cleanup();
  }
}

module.exports = IPCHandlers;
