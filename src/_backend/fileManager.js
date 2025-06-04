const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");

class FileManager {
  constructor(sendStatusToRenderer, configPath) {
    this.watchers = new Map();
    this.sendStatusToRenderer = sendStatusToRenderer || (() => {});
    this.configPath = configPath;
    this.currentCollection = null;
    this.codePrefix = null;
    this.lastInventoryNumber = 0;
    this.pendingCollections = [];
    this.originalNames = new Map();
  }

  // Helper methods for config management
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

  async initializeCodePrefix(collectionPath) {
    const collectionFolder = path.basename(collectionPath);
    this.codePrefix = collectionFolder.split("_")[0];
    this.currentCollection = collectionPath;

    // Simulate database call - replace with actual API call later
    this.lastInventoryNumber = await this.getLastInventoryNumber(
      this.codePrefix
    );
  }

  async getLastInventoryNumber(codePrefix) {
    // Simulated database response
    if (codePrefix === "DC") return 1;
    if (codePrefix === "D") return 5;
    return 0;
  }

  async createWatcher(rootFolderPath) {
    try {
      this.watchers.forEach((watcher) => watcher.close());
      this.watchers.clear();
      this.pendingCollections = [];

      const fileTypes = await fs.promises.readdir(rootFolderPath);
      for (const fileType of fileTypes) {
        const fileTypePath = path.join(rootFolderPath, fileType);
        if (!(await fs.promises.stat(fileTypePath)).isDirectory()) continue;

        const codeFolders = await fs.promises.readdir(fileTypePath);
        for (const codeFolder of codeFolders) {
          const codePath = path.join(fileTypePath, codeFolder);
          if (!(await fs.promises.stat(codePath)).isDirectory()) continue;

          const collectionFolders = await fs.promises.readdir(codePath);
          for (const collectionFolder of collectionFolders) {
            const collectionPath = path.join(codePath, collectionFolder);
            if ((await fs.promises.stat(collectionPath)).isDirectory()) {
              this.pendingCollections.push({
                path: collectionPath,
                type: fileType,
                code: codeFolder,
                name: collectionFolder,
              });
            }
          }
        }
      }

      const config = this.readConfig();
      config.availableCollections = this.pendingCollections.map((c) => ({
        path: c.path,
        name: c.name,
      }));
      this.writeConfig(config);

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

  async startCollectionProcessing(collectionPath) {
    try {
      const initialFiles = await this.processCollection(collectionPath);
      if (initialFiles.length > 0 && this.mainWindow) {
        this.mainWindow.webContents.send("file-processed", initialFiles);
      }

      const watcher = chokidar.watch(collectionPath, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
      });

      watcher
        .on("add", async (filePath) => {
          const processedFile = await this.processFile(filePath);
          if (processedFile && this.mainWindow) {
            this.mainWindow.webContents.send("file-processed", processedFile);
          }
        })
        .on("addDir", async (dirPath) => {
          const processedFiles = await this.processFolder(dirPath);
          if (processedFiles && this.mainWindow) {
            this.mainWindow.webContents.send("file-processed", processedFiles);
          }
        })
        .on("error", (error) => {
          this.sendStatusToRenderer("error", `Watcher error: ${error.message}`);
        });

      this.watchers.set(collectionPath, watcher);
      return true;
    } catch (error) {
      this.sendStatusToRenderer("error", `Error al procesar ${error.message}`);
      return false;
    }
  }
  async processCollection(collectionPath) {
    try {
      await this.initializeCodePrefix(collectionPath);
      const items = await fs.promises.readdir(collectionPath);
      const processedItems = [];

      for (const item of items) {
        const itemPath = path.join(collectionPath, item);
        const stats = await fs.promises.stat(itemPath);

        let result;
        if (stats.isDirectory()) {
          result = await this.processFolder(itemPath);
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

      return processedItems;
    } catch (error) {
      this.sendStatusToRenderer("error", `Error al procesar: ${error.message}`);
      throw error;
    }
  }

  async processFile(filePath) {
    const fileName = path.basename(filePath);
    const collectionPath = path.dirname(filePath);

    if (this.isInventoryFile(fileName)) return null;

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
      await fs.promises.rename(filePath, newFilePath);
      this.sendStatusToRenderer("success", `Se proceso el archivo ${fileName}`);

      return {
        newName: newFileName,
        inventoryCode: newInventoryCode,
        path: newFilePath,
      };
    } catch (error) {
      this.lastInventoryNumber--;
      this.sendStatusToRenderer(
        "error",
        `Error al procesar ${fileName}: ${error.message}`
      );
      return null;
    }
  }
  async processFolder(folderPath) {
    const folderName = path.basename(folderPath);
    const collectionPath = path.dirname(folderPath);

    if (this.isInventoryFolder(folderName)) return null;

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
      await fs.promises.rename(folderPath, newFolderPath);
      const files = await fs.promises.readdir(newFolderPath);
      const processedFiles = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
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

        await fs.promises.rename(filePath, newFilePath);

        processedFiles.push({
          newName: newFileName,
          inventoryCode: newInventoryCode,
          path: newFilePath,
        });
      }

      this.sendStatusToRenderer(
        "success",
        `Se proceso la carpeta ${folderName}`
      );

      return processedFiles;
    } catch (error) {
      this.lastInventoryNumber--;
      this.sendStatusToRenderer(
        "error",
        `Error al procesar ${folderName}: ${error.message}`
      );
      return null;
    }
  }

  isInventoryFolder(folderName) {
    return /^[A-Z]{1,3}_\d{7}$/.test(folderName);
  }
  isInventoryFile(fileName) {
    return /^[A-Z]{1,3}_\d{7}_\d{2}\.\w{3,4}$/.test(fileName);
  }

  async executeRollback(collectionPath) {
    const items = this.originalNames.get(collectionPath);
    if (!items) return;

    for (const item of items) {
      try {
        let currentPath, originalPath;

        if (item.isDirectory) {
          currentPath = path.join(collectionPath, item.currentName);
          originalPath = path.join(collectionPath, item.originalName);
        } else {
          if (item.parentFolder) {
            currentPath = path.join(
              collectionPath,
              item.parentFolder,
              item.currentName
            );
            originalPath = path.join(
              collectionPath,
              item.parentFolder,
              item.originalName
            );
          } else {
            currentPath = path.join(collectionPath, item.currentName);
            originalPath = path.join(collectionPath, item.originalName);
          }
        }

        if (fs.existsSync(currentPath)) {
          await fs.promises.rename(currentPath, originalPath);
        }
      } catch (error) {
        console.error(`Rollback failed for ${item.currentName}:`, error);
      }
    }

    this.originalNames.delete(collectionPath);
  }

  cleanup() {
    try {
      this.watchers.forEach((watcher) => watcher.close());
      this.watchers.clear();
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        "Error al limpiar los monitores de carpeta"
      );
      console.error("Error cleaning up watchers:", error);
    }
  }
}

module.exports = FileManager;
