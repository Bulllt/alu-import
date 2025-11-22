const fs = require("fs-extra");
const path = require("path");
const { net } = require("electron");
require("dotenv").config();

const crypto = require("crypto");
const S3Manager = require("./s3Manager");
const variablesConfig = require("./variablesConfig");

class FileManager {
  constructor(sendStatusToRenderer, configPath) {
    // Initial file processing
    this.sendStatusToRenderer = sendStatusToRenderer || (() => {});
    this.configPath = configPath;
    this.codePrefix = null;
    this.lastInventoryNumber = 0;
    this.pendingCollections = [];
    this.originalNames = new Map();

    this.baseDir = null;
    this.lastImported = null;

    this.nasOriginal = null;
    this.nas2400 = null;

    this.initializePath();
    this.s3Manager = new S3Manager();
    this.temp400pxDir = path.join(require("os").tmpdir(), "400px");
    fs.ensureDirSync(this.temp400pxDir);
  }

  // Helper functions
  readConfig() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
    } catch (error) {
      return { folderPath: null };
    }
  }

  writeConfig(config) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  initializePath() {
    const config = this.readConfig();

    if (!config.folderPath) return;

    this.baseDir = path.dirname(config.folderPath);
    this.lastImported = path.join(
      this.baseDir,
      `${path.basename(config.folderPath)}_importados`
    );
    fs.ensureDirSync(this.lastImported);

    this.nasOriginal =
      process.env.NODE_ENV === "production"
        ? "\\\\Nasarchivo\\archivo\\original"
        : path.join(this.baseDir, "original");

    this.nas2400 =
      process.env.NODE_ENV === "production"
        ? "\\\\Nasarchivo\\archivo\\2400px"
        : path.join(this.baseDir, "2400px");

    fs.ensureDirSync(this.nasOriginal);
    fs.ensureDirSync(this.nas2400);
  }

  // Process of collections and files
  async createWatcher(rootFolderPath) {
    try {
      this.pendingCollections = [];

      const fileTypes = await fs.readdir(rootFolderPath);
      for (const fileType of fileTypes) {
        const fileTypePath = path.join(rootFolderPath, fileType);
        if (!(await fs.stat(fileTypePath)).isDirectory()) continue;

        const codeFolders = await fs.readdir(fileTypePath);
        for (const codeFolder of codeFolders) {
          const codePath = path.join(fileTypePath, codeFolder);
          if (!(await fs.stat(codePath)).isDirectory()) continue;

          const collectionFolders = await fs.readdir(codePath);
          for (const collectionFolder of collectionFolders) {
            const collectionPath = path.join(codePath, collectionFolder);
            if ((await fs.stat(collectionPath)).isDirectory()) {
              this.pendingCollections.push({
                path: collectionPath,
                code: codeFolder,
                name: collectionFolder,
              });
            }
          }
        }
      }

      return true;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        `Error al encontrar colecciones ${error.message}`
      );
      console.error("Error creating watcher:", error);
      return false;
    }
  }

  async startCollectionProcessing(collectionPath, codePrefix) {
    try {
      const config = this.readConfig();
      this.lastInventoryNumber = config.inventoryNumber;
      this.codePrefix = codePrefix;

      const items = await fs.readdir(collectionPath);
      const processedItems = [];

      let rootCSVData = null;
      const rootCSVFile = items.find(
        (item) => path.extname(item).toLowerCase() === ".csv"
      );
      if (rootCSVFile) {
        const csvPath = path.join(collectionPath, rootCSVFile);
        rootCSVData = await this.parseCSVFile(csvPath);

        if (rootCSVData && this.mainWindow) {
          this.mainWindow.webContents.send("csv-file", {
            data: rootCSVData,
            scope: "collection",
            folderName: collectionPath,
          });
        }
      }

      const sortedItems = items
        .filter((item) => path.extname(item).toLowerCase() !== ".csv")
        .sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
        );

      for (const item of sortedItems) {
        const itemPath = path.join(collectionPath, item);
        const stats = await fs.stat(itemPath);

        let result;
        if (stats.isDirectory()) {
          result = await this.processFolder(itemPath, rootCSVData);
        } else {
          result = await this.processFile(itemPath);
        }

        if (result) {
          if (Array.isArray(result)) {
            processedItems.push(...result);
          } else {
            processedItems.push(result);
          }
        }
      }

      if (processedItems.length > 0 && this.mainWindow) {
        this.mainWindow.webContents.send("file-processed", processedItems);
      }
      return true;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        "Error al procesar (startCollectionProcessing)"
      );
      throw error;
    }
  }

  async parseCSVFile(filePath) {
    try {
      const fileContent = await fs.readFile(filePath, "utf8");
      const lines = fileContent.split("\n");
      if (lines.length < 2) return null;

      const headers = lines[0].split(",").map((h) => h.trim());
      const data = [];

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const row = {};

        headers.forEach((header, index) => {
          let value = values[index] || "";
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
          }
          row[header] = value.trim();
        });

        data.push(row);
      }

      return data;
    } catch (error) {
      console.error("Error parsing CSV file:", error);
      return null;
    }
  }

  async processFile(filePath) {
    const fileName = path.basename(filePath);
    const collectionPath = path.dirname(filePath);

    if (!this.originalNames.has(collectionPath)) {
      this.originalNames.set(collectionPath, []);
    }

    this.lastInventoryNumber++;
    const newBaseName = `${this.codePrefix}_${this.lastInventoryNumber
      .toString()
      .padStart(7, "0")}`;
    const ext = path.extname(filePath);
    const newInventoryCode = `${newBaseName}_01`;
    const newFileName = `${newBaseName}_01${ext}`;
    const newFilePath = path.join(path.dirname(filePath), newFileName);

    this.originalNames.get(collectionPath).push({
      currentName: newFileName,
      originalName: fileName,
      isDirectory: false,
      parentFolder: null,
    });

    try {
      await fs.rename(filePath, newFilePath);
      this.sendStatusToRenderer("success", `Se proceso el archivo ${fileName}`);

      return {
        newName: newFileName,
        inventoryCode: newInventoryCode,
        path: newFilePath,
        csvContext: null,
      };
    } catch (error) {
      this.lastInventoryNumber--;
      this.sendStatusToRenderer("error", "Error al procesar (processFile)");
      return null;
    }
  }

  async processFolder(folderPath, parentCSVData) {
    const folderName = path.basename(folderPath);
    const collectionPath = path.dirname(folderPath);

    if (!this.originalNames.has(collectionPath)) {
      this.originalNames.set(collectionPath, []);
    }

    this.lastInventoryNumber++;
    const newFolderName = `${this.codePrefix}_${this.lastInventoryNumber
      .toString()
      .padStart(7, "0")}`;
    const newFolderPath = path.join(path.dirname(folderPath), newFolderName);

    this.originalNames.get(collectionPath).push({
      currentName: newFolderName,
      originalName: folderName,
      isDirectory: true,
    });

    try {
      await this.retryFolderRename(folderPath, newFolderPath);
      const files = await fs.readdir(newFolderPath);
      const processedFiles = [];

      let folderCSVData = parentCSVData;
      const folderCSVFile = files.find(
        (item) => path.extname(item).toLowerCase() === ".csv"
      );
      if (folderCSVFile) {
        const csvName = path.basename(folderCSVFile);
        this.originalNames.get(collectionPath).push({
          currentName: csvName,
          originalName: csvName,
          parentFolder: newFolderName,
          isDirectory: false,
        });

        const csvPath = path.join(newFolderPath, folderCSVFile);
        const localCSVData = await this.parseCSVFile(csvPath);

        if (localCSVData && this.mainWindow) {
          this.mainWindow.webContents.send("csv-file", {
            data: localCSVData,
            scope: "folder",
            folderName: newFolderName,
          });
        }
        folderCSVData = localCSVData;
      }

      const sortedFiles = files
        .filter((file) => path.extname(file).toLowerCase() !== ".csv")
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      for (let i = 0; i < sortedFiles.length; i++) {
        const file = sortedFiles[i];
        const filePath = path.join(newFolderPath, file);
        const ext = path.extname(filePath);
        const sequenceNum = (i + 1).toString().padStart(2, "0");
        const newInventoryCode = `${newFolderName}_${sequenceNum}`;
        const newFileName = `${newFolderName}_${sequenceNum}${ext}`;
        const newFilePath = path.join(newFolderPath, newFileName);

        this.originalNames.get(collectionPath).push({
          currentName: newFileName,
          originalName: file,
          parentFolder: newFolderName,
          isDirectory: false,
        });

        await fs.rename(filePath, newFilePath);

        processedFiles.push({
          newName: newFileName,
          inventoryCode: newInventoryCode,
          path: newFilePath,
          csvContext: newFolderName,
        });
      }

      this.sendStatusToRenderer(
        "success",
        `Se proceso la carpeta ${folderName}`
      );

      return processedFiles;
    } catch (error) {
      this.lastInventoryNumber--;
      this.sendStatusToRenderer("error", "Error al procesar (processFolder)");
      return null;
    }
  }

  async retryFolderRename(oldPath, newPath, attempts = 3, delay = 300) {
    for (let i = 0; i < attempts; i++) {
      try {
        await fs.rename(oldPath, newPath);
        return;
      } catch (error) {
        if (i === attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }

  // Import helpers
  generateToken() {
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = process.env.IMPORT_APP_SECRET;
    const hmac = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}`)
      .digest("hex");

    return `${timestamp}:${hmac}`;
  }

  async executeRollback(collectionPath) {
    const items = this.originalNames.get(collectionPath);
    if (!items) return;

    const directories = items.filter((item) => item.isDirectory);
    const files = items.filter((item) => !item.isDirectory);

    for (const item of [...files].reverse()) {
      try {
        let currentPath, originalPath;

        if (item.parentFolder) {
          const folderItem = directories.find(
            (dir) => dir.currentName === item.parentFolder
          );
          const originalFolderName =
            folderItem?.originalName || item.parentFolder;

          currentPath = path.join(
            collectionPath,
            item.parentFolder,
            item.currentName
          );
          originalPath = path.join(
            collectionPath,
            originalFolderName,
            item.originalName
          );

          await fs.mkdir(path.dirname(originalPath), {
            recursive: true,
          });
        } else {
          currentPath = path.join(collectionPath, item.currentName);
          originalPath = path.join(collectionPath, item.originalName);
        }

        if (fs.existsSync(currentPath)) {
          await fs.rename(currentPath, originalPath);
        }
      } catch (error) {
        console.error(`Rollback failed for ${item.currentName}:`, error);
      }
    }

    for (const item of [...directories].reverse()) {
      try {
        const currentPath = path.join(collectionPath, item.currentName);

        if (fs.existsSync(currentPath)) {
          const dirContents = await fs.readdir(currentPath);
          if (dirContents.length === 0) {
            await fs.rmdir(currentPath);
          }
        }
      } catch (error) {
        console.error(
          `Rollback failed for directory ${item.currentName}:`,
          error
        );
      }
    }

    this.originalNames.delete(collectionPath);
  }

  async moveToImported(collectionPath) {
    const config = this.readConfig();
    const type = config.lastCollectionType;
    const collectionFolderName = config.lastCollectionName;
    const [prefix, rest] = collectionFolderName.split("_");

    const destinationFolder = path.join(this.lastImported, type, prefix);
    await fs.ensureDir(destinationFolder);

    await fs.move(
      collectionPath,
      path.join(destinationFolder, collectionFolderName),
      {
        overwrite: true,
      }
    );
  }

  async sendToDatabase(files, token) {
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: "POST",
        protocol: variablesConfig.apiConfig.protocol,
        hostname: variablesConfig.apiConfig.hostname,
        path: "/api/insertNewFiles",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
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

      request.write(JSON.stringify(files));
      request.end();
    });
  }

  async cleanLastImport() {
    const config = this.readConfig();
    if (!config.lastImportCode) return;

    const selectedPath = config.folderPath;
    const [prefix, baseNumber] = config.lastImportCode.split("_");
    const collection = config.lastCollectionName;
    const type = config.lastCollectionType;
    const nas2400Path = path.join(this.nas2400, prefix);
    const nasOriginalPath = path.join(this.nasOriginal, prefix);

    await this.s3Manager.cleanLastImportFromS3(prefix, baseNumber, type);

    const nas2400Files = await fs.readdir(nas2400Path);
    for (const file of nas2400Files) {
      const parts = file.split("_");

      if (parts[0] === prefix && parts[1] >= baseNumber) {
        try {
          await fs.remove(path.join(nas2400Path, file));
        } catch (error) {
          console.error("cleanLastImport error:", error);
          await this.sendStatusToRenderer(
            "error",
            `El archivo ${file} está abierto. Ciérralo para evitar errores.`
          );
          throw error;
        }
      }
    }

    const nasOriginalFiles = await fs.readdir(nasOriginalPath);
    for (const file of nasOriginalFiles) {
      const parts = file.split("_");

      if (parts[0] === prefix && parts[1] >= baseNumber) {
        try {
          await fs.remove(path.join(nasOriginalPath, file));
        } catch (error) {
          console.error("cleanLastImport error:", error);
          await this.sendStatusToRenderer(
            "error",
            `El archivo ${file} está abierto. Ciérralo para evitar errores.`
          );
          throw error;
        }
      }
    }

    const sourceFolder = path.join(this.lastImported, type, prefix, collection);
    const destinationFolder = path.join(selectedPath, type, prefix);
    await fs.ensureDir(destinationFolder);

    try {
      await fs.move(sourceFolder, path.join(destinationFolder, collection), {
        overwrite: true,
      });
    } catch (error) {
      console.error("cleanLastImport error:", error);
      await this.sendStatusToRenderer(
        "error",
        `Cierra los archivos dentro de la carpeta ${collection} dentro de la carpeta de importados`
      );
      throw error;
    }
  }
}

module.exports = FileManager;
