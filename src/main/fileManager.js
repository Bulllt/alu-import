const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");

class FileManager {
  constructor(sendStatusToRenderer) {
    this.watchers = new Map();
    this.mockInventory = this.generateMockInventory(100);
    this.usedIds = new Set();
    this.sendStatusToRenderer = sendStatusToRenderer || (() => {});
  }
  generateMockInventory(count) {
    return Array.from({ length: count }, (_, i) => `INV-${1000 + i}`);
  }
  getNextAvailableId() {
    for (const id of this.mockInventory) {
      if (!this.usedIds.has(id)) {
        this.usedIds.add(id);
        return id;
      }
    }
    throw new Error("No available inventory codes");
  }

  createWatcher(folderPath, { onAdd }) {
    try {
      if (this.watchers.has(folderPath)) {
        this.watchers.get(folderPath).close();
      }

      const watcher = chokidar.watch(folderPath, {
        ignored: /(^|[/\\])\../,
        persistent: true,
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 100,
        },
      });

      watcher.on("add", (filePath) => {
        if (this.isValidFileType(filePath)) {
          onAdd(filePath);
        } else {
          this.sendStatusToRenderer(
            "error",
            `Tipo de archivo no soportado: ${path.basename(filePath)}`
          );
        }
      });

      watcher.on("error", (error) => {
        this.sendStatusToRenderer(
          "error",
          `Error en el monitoreo de carpeta: ${error.message}`
        );
        console.error("Watcher error:", error);
      });

      this.watchers.set(folderPath, watcher);
      return watcher;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        `Error al iniciar el monitoreo: ${error.message}`
      );
      console.error("Error creating watcher:", error);
      throw error;
    }
  }

  isValidFileType(filePath) {
    const validExtensions = [".jpg", ".png", ".pdf", ".mp4", ".mp3"];
    const ext = path.extname(filePath).toLowerCase();
    return validExtensions.includes(ext);
  }

  async processNewFile(filePath, processedFolder) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe: ${filePath}`);
      }

      const ext = path.extname(filePath);
      const id = this.getNextAvailableId();
      const newName = `${id}${ext}`;
      const newPath = path.join(processedFolder, newName);

      await fs.promises.rename(filePath, newPath);

      return {
        original: path.basename(filePath),
        renamed: newName,
        inventoryId: id,
        filePath: newPath,
      };
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        `Error al procesar archivo: ${error.message}`
      );
      console.error(`Error processing file ${filePath}:`, error);
      throw error;
    }
  }

  async deleteProcessedFiles(basePath) {
    const processedPath = path.join(basePath, "processedFiles");

    try {
      const files = await fs.promises.readdir(processedPath);
      const fileDeletions = files.map(async (file) => {
        const filePath = path.join(processedPath, file);
        const stats = await fs.promises.stat(filePath);

        if (stats.isFile()) {
          await fs.promises.unlink(filePath);
          return 1;
        }
        return 0;
      });

      const results = await Promise.allSettled(fileDeletions);
      const deletedCount = results.reduce(
        (count, result) =>
          result.status === "fulfilled" ? count + result.value : count,
        0
      );

      return deletedCount;
    } catch (error) {
      this.sendStatusToRenderer(
        "error",
        `Error deleting processed files: ${error.message}`
      );
      console.error("Error in deleteProcessedFiles:", error);
      throw error;
    }
  }

  async setupSubfolder(basePath) {
    const processedPath = path.join(basePath, "processedFiles");

    try {
      await this.ensureDirectoryExists(processedPath);
      return processedPath;
    } catch (error) {
      this.sendStatusToRenderer("error", "Error al crear la subcarpeta");
    }
  }

  async ensureDirectoryExists(dirPath) {
    try {
      await fs.promises.access(dirPath);
    } catch {
      try {
        await fs.promises.mkdir(dirPath, { recursive: true });
      } catch (error) {
        this.sendStatusToRenderer(
          "error",
          `No se pudo crear el directorio: ${dirPath}`
        );
        throw error;
      }
    }
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
