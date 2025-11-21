const { Worker } = require("worker_threads");
const path = require("path");
const fs = require("fs-extra");
const variablesConfig = require("./variablesConfig");

class WorkerManager {
  constructor(mainWindow, fileManager) {
    this.mainWindow = mainWindow;
    this.fileManager = fileManager;
    this.currentCollectionPath = null;
    this.processedFolders = new Set();

    this.thumbnailWorkerPool = [];
    this.workerPool = [];
    this.maxWorkers = Math.max(
      2,
      Math.floor(require("os").cpus().length * 0.7)
    );

    this.progressState = {
      totalFiles: 0,
      processedFiles: 0,
    };
  }

  // IMAGE PROCESS SECTION
  async processImages(files, collectionPath) {
    this.progressState = {
      totalFiles: files.length,
      processedFiles: 0,
    };

    const lastInventoryCode = `${files[0].code}_${files[0].n_object}_${files[0].n_ic}`;
    const lastCollection = path.basename(collectionPath);
    const pathParts = collectionPath.split(path.sep);
    const lastType = pathParts[pathParts.length - 3];

    const config = this.fileManager.readConfig();
    const updatedConfig = {
      ...config,
      lastImportCode: lastInventoryCode,
      lastCollectionName: lastCollection,
      lastCollectionType: lastType,
    };
    this.fileManager.writeConfig(updatedConfig);

    this.updateProgress(10, "Preparando procesamiento...");

    const processedFiles = await this.processFilesInParallel(
      files,
      "imagenes",
      10,
      50
    );

    await this.fileManager.executeRollback(collectionPath);
    await this.fileManager.moveToImported(collectionPath);

    this.updateProgress(70, "Generando descripciones...");

    const filesWithAI = await this.generateAIDescriptionsInParallel(
      processedFiles,
      lastInventoryCode
    );

    this.updateProgress(90, "Actualizando base de datos...");

    const token = this.fileManager.generateToken();
    await this.fileManager.sendToDatabase(filesWithAI, token);

    this.updateProgress(100, "¡Completado!");
    return true;
  }

  async generateAIDescriptionsInParallel(files, lastInventoryCode) {
    const [prefix, baseNumber] = lastInventoryCode.split("_");

    const importedFiles = await fs.readdir(
      path.join(this.fileManager.nas2400, prefix)
    );

    const filesMap = new Map();
    files.forEach((file) => {
      const fileName = path.basename(file.path, path.extname(file.path));
      filesMap.set(fileName, file);
    });

    const imageFiles = importedFiles.filter((file) => {
      const fileParts = path.basename(file, path.extname(file)).split("_");
      return fileParts[0] === prefix && fileParts[1] >= baseNumber;
    });

    const aiResultsMap = new Map();
    const pendingPromises = [];

    for (let i = 0; i < imageFiles.length; i++) {
      while (this.workerPool.length >= this.maxWorkers) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const imageFile = imageFiles[i];
      const fileName = path.basename(imageFile, path.extname(imageFile));

      const promise = this.processAIDescriptionWithWorker(imageFile, prefix);
      pendingPromises.push(promise);

      promise.then((result) => {
        aiResultsMap.set(fileName, result);
        this.updateProgress(
          70 + (aiResultsMap.size / imageFiles.length) * 20,
          `Generando descripciones... (${aiResultsMap.size}/${imageFiles.length})`
        );
      });
    }

    await Promise.all(pendingPromises);

    return files.map((file) => {
      const fileName = path.basename(file.path, path.extname(file.path));
      const aiResult = aiResultsMap.get(fileName) || {
        description: "",
        elements: "",
      };

      return {
        ...file,
        ai_description: aiResult.description || "",
        ai_elements: aiResult.elements || "",
        path: null,
      };
    });
  }

  async processAIDescriptionWithWorker(imageFile, prefix) {
    if (this.workerPool.length < this.maxWorkers) {
      return new Promise((resolve, reject) => {
        const worker = new Worker(variablesConfig.imageWorkerPath, {
          workerData: {
            imageFile,
            prefix,
            operation: "generateAIDescription",
            nas2400: this.fileManager.nas2400,
          },
        });

        this.workerPool.push(worker);

        worker.on("message", (result) => {
          this.removeWorkerFromPool(worker, this.workerPool);
          resolve(result);
        });

        worker.on("error", (error) => {
          console.error("AI worker error:", error);
          this.removeWorkerFromPool(worker, this.workerPool);
          resolve({ description: "", elements: "" });
        });

        worker.on("exit", (code) => {
          if (code !== 0) {
            console.warn(`AI worker stopped with exit code ${code}`);
          }
          this.removeWorkerFromPool(worker, this.workerPool);
        });
      });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return this.processAIDescriptionWithWorker(imageFile, prefix);
    }
  }

  // MOVIE PROCESS SECTION
  async processMovies(files, collectionPath) {
    this.progressState = {
      totalFiles: files.length,
      processedFiles: 0,
    };

    const lastInventoryCode = `${files[0].code}_${files[0].n_object}_${files[0].n_ic}`;
    const lastCollection = path.basename(collectionPath);
    const pathParts = collectionPath.split(path.sep);
    const lastType = pathParts[pathParts.length - 3];

    const config = this.fileManager.readConfig();
    const updatedConfig = {
      ...config,
      lastImportCode: lastInventoryCode,
      lastCollectionName: lastCollection,
      lastCollectionType: lastType,
    };
    this.fileManager.writeConfig(updatedConfig);

    this.updateProgress(10, "Preparando procesamiento...");

    this.updateProgress(20, "Convirtiendo a formato MOV...");
    await this.convertToMovAndBackup(files, collectionPath);

    this.updateProgress(40, "Procesando películas...");
    const processedFiles = await this.processFilesInParallel(
      files,
      "peliculas",
      40,
      50
    );

    this.updateProgress(90, "Finalizando operaciones...");
    await fs.remove(collectionPath);

    const updatedFiles = processedFiles.map((file) => ({
      ...file,
      path: `/original/dm/${file.s3Hash}`,
    }));

    const token = this.fileManager.generateToken();
    await this.fileManager.sendToDatabase(updatedFiles, token);

    this.updateProgress(100, "¡Completado!");
    return true;
  }

  async convertToMovAndBackup(files, collectionPath) {
    const collectionFolderName = path.basename(collectionPath);
    const [codePrefix, rest] = collectionFolderName.split("_");
    const moviesPath = path.join(
      this.fileManager.lastImported,
      "peliculas",
      codePrefix
    );
    const destinationFolder = path.join(moviesPath, collectionFolderName);

    fs.ensureDirSync(path.join(this.fileManager.nasOriginal, codePrefix));
    fs.ensureDirSync(destinationFolder);

    let processedFiles = 0;
    const totalFiles = files.length;

    for (const file of files) {
      processedFiles++;
      this.updateProgress(
        20 + (processedFiles / totalFiles) * 20,
        `Convirtiendo archivos... (${processedFiles}/${totalFiles})`
      );

      const inputPath = file.path;
      const ext = path.extname(inputPath).toLowerCase();
      const baseName = path.basename(inputPath, ext);
      const outputFilename = `${collectionFolderName}-file${processedFiles}.mov`;
      const importedPath = path.join(destinationFolder, outputFilename);
      const nasOriginalPath = path.join(
        this.fileManager.nasOriginal,
        codePrefix,
        `${baseName}.mov`
      );

      if (ext !== ".mov") {
        await new Promise((resolve, reject) => {
          const ffmpeg = require("fluent-ffmpeg");
          ffmpeg(inputPath)
            .format("mov")
            .outputOptions(["-c:v copy", "-c:a copy"])
            .on("end", () => {
              resolve();
            })
            .on("error", reject)
            .save(importedPath);
        });

        await fs.copy(importedPath, nasOriginalPath);
      } else {
        await fs.copy(inputPath, importedPath);
        await fs.copy(inputPath, nasOriginalPath);
      }
    }
  }

  // AUDIO PROCESS SECTION
  async processAudios(files, collectionPath) {
    this.progressState = {
      totalFiles: files.length,
      processedFiles: 0,
    };

    const lastInventoryCode = `${files[0].code}_${files[0].n_object}_${files[0].n_ic}`;
    const lastCollection = path.basename(collectionPath);
    const pathParts = collectionPath.split(path.sep);
    const lastType = pathParts[pathParts.length - 3];

    const config = this.fileManager.readConfig();
    const updatedConfig = {
      ...config,
      lastImportCode: lastInventoryCode,
      lastCollectionName: lastCollection,
      lastCollectionType: lastType,
    };
    this.fileManager.writeConfig(updatedConfig);

    this.updateProgress(10, "Preparando procesamiento...");

    const processedFiles = await this.processFilesInParallel(
      files,
      "audios",
      10,
      60
    );

    const successfulFiles = processedFiles.filter(
      (f) => f.processed && f.s3Hash
    );

    this.updateProgress(80, "Finalizando operaciones de archivo...");
    await this.fileManager.executeRollback(collectionPath);
    await this.fileManager.moveToImported(collectionPath);

    this.updateProgress(90, "Actualizando base de datos...");
    const updatedFiles = successfulFiles.map((file) => ({
      ...file,
      path: `/original/dm/${file.s3Hash}`,
    }));

    const token = this.fileManager.generateToken();
    await this.fileManager.sendToDatabase(updatedFiles, token);

    this.updateProgress(100, "¡Completado!");
    return true;
  }

  // DOCUMENTS PROCESS SECTION
  async processDocuments(files, collectionPath) {
    this.currentCollectionPath = collectionPath;
    this.progressState = {
      totalFiles: files.length,
      processedFiles: 0,
    };

    const lastInventoryCode = `${files[0].code}_${files[0].n_object}_${files[0].n_ic}`;
    const lastCollection = path.basename(collectionPath);
    const pathParts = collectionPath.split(path.sep);
    const lastType = pathParts[pathParts.length - 3];

    const config = this.fileManager.readConfig();
    const updatedConfig = {
      ...config,
      lastImportCode: lastInventoryCode,
      lastCollectionName: lastCollection,
      lastCollectionType: lastType,
    };
    this.fileManager.writeConfig(updatedConfig);

    this.updateProgress(10, "Preparando procesamiento paralelo...");

    const deduplicatedFiles = this.deduplicateDocumentFiles(
      files,
      collectionPath
    );
    const processedFiles = await this.processFilesInParallel(
      deduplicatedFiles,
      "documentos",
      10,
      70
    );

    this.updateProgress(85, "Finalizando operaciones de archivo...");
    await this.fileManager.executeRollback(collectionPath);
    await this.fileManager.moveToImported(collectionPath);

    this.updateProgress(95, "Actualizando base de datos...");
    const updatedFiles = processedFiles
      .filter((file) => file.n_ic == "01")
      .map((file) => ({
        ...file,
        path: `/original/dm/${file.s3Hash}`,
      }));

    const token = this.fileManager.generateToken();
    await this.fileManager.sendToDatabase(updatedFiles, token);

    this.updateProgress(100, "¡Completado!");
    return true;
  }

  deduplicateDocumentFiles(files, collectionPath) {
    const folderMap = new Map();
    const singleFiles = [];

    for (const file of files) {
      const documentPath = path.dirname(file.path);
      const documentFolder = path.basename(documentPath);
      const [prefix, isInventoryNumber] = documentFolder.split("_");
      const isInCollectionRoot = documentPath === collectionPath;

      // Check if this is a multi-page document folder
      if (/^\d+$/.test(isInventoryNumber) && !isInCollectionRoot) {
        // Multi-page document - group by folder
        if (!folderMap.has(documentPath)) {
          folderMap.set(documentPath, file);
        }
        // Ignore other files from the same folder
      } else {
        // Single-page document - process individually
        singleFiles.push(file);
      }
    }

    // Combine: one file per multi-page folder + all single files
    const deduplicatedFiles = [...folderMap.values(), ...singleFiles];

    return deduplicatedFiles;
  }

  // THUMBNAIL PROCESS SECTION
  async getThumbnails(filePath) {
    if (this.thumbnailWorkerPool.length < this.maxWorkers) {
      return new Promise((resolve) => {
        const worker = new Worker(variablesConfig.thumbnailWorkerPath, {
          workerData: { filePath },
        });

        this.thumbnailWorkerPool.push(worker);

        worker.on("message", (result) => {
          this.removeWorkerFromPool(worker, this.thumbnailWorkerPool);
          resolve(result);
        });

        worker.on("error", (error) => {
          console.error("Thumbnail worker error:", error);
          this.removeWorkerFromPool(worker, this.thumbnailWorkerPool);
          resolve(null);
        });

        worker.on("exit", (code) => {
          if (code !== 0) {
            console.warn(`Thumbnail worker stopped with exit code ${code}`);
          }
          this.removeWorkerFromPool(worker, this.thumbnailWorkerPool);
        });
      });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return this.getThumbnails(filePath);
    }
  }

  // Workers calls
  async processFilesInParallel(
    files,
    fileType,
    progressStart = 10,
    progressRange = 50
  ) {
    const processedFiles = [];
    const pendingPromises = [];

    for (let i = 0; i < files.length; i++) {
      while (this.workerPool.length >= this.maxWorkers) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const promise = this.processSingleFileWithWorker(files[i], fileType);
      pendingPromises.push(promise);

      promise.then((result) => {
        processedFiles.push(result);
        this.progressState.processedFiles++;

        const progressMessage = this.getProgressMessage(fileType);
        this.updateProgress(
          progressStart +
            (this.progressState.processedFiles /
              this.progressState.totalFiles) *
              progressRange,
          `${progressMessage} (${this.progressState.processedFiles}/${this.progressState.totalFiles})`
        );
      });
    }

    await Promise.all(pendingPromises);
    return processedFiles;
  }

  async processSingleFileWithWorker(file, fileType) {
    const workerConfig = this.getWorkerConfig(fileType, file);
    if (this.workerPool.length < this.maxWorkers) {
      return new Promise((resolve, reject) => {
        const worker = new Worker(workerConfig.workerPath, {
          workerData: workerConfig.workerData,
        });

        this.workerPool.push(worker);

        worker.on("message", (result) => {
          this.removeWorkerFromPool(worker, this.workerPool);
          resolve(result);
        });

        worker.on("error", (error) => {
          console.error("File processing worker error:", error);
          this.removeWorkerFromPool(worker, this.workerPool);
          reject(error);
        });

        worker.on("exit", (code) => {
          if (code !== 0) {
            console.warn(
              `File processing worker stopped with exit code ${code}`
            );
          }
          this.removeWorkerFromPool(worker, this.workerPool);
        });
      });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return this.processSingleFileWithWorker(file, fileType);
    }
  }

  // helper functions
  removeWorkerFromPool(worker, pool) {
    worker.terminate();
    const index = pool.indexOf(worker);
    if (index !== -1) {
      pool.splice(index, 1);
    }
  }

  updateProgress(percent, stage = "") {
    this.mainWindow.webContents.send("import-progress", {
      percent: Math.round(percent),
      stage: stage,
    });
  }

  getWorkerConfig(fileType, file) {
    const baseConfig = {
      nasOriginal: this.fileManager.nasOriginal,
      nas2400: this.fileManager.nas2400,
      temp400pxDir: this.fileManager.temp400pxDir,
    };

    switch (fileType) {
      case "imagenes":
        return {
          workerPath: variablesConfig.imageWorkerPath,
          workerData: {
            file,
            operation: "processImage",
            ...baseConfig,
          },
        };

      case "peliculas":
        return {
          workerPath: variablesConfig.movieWorkerPath,
          workerData: {
            file,
            operation: "processMovie",
            watermarkPath: variablesConfig.watermarkPath,
            ...baseConfig,
          },
        };

      case "audios":
        return {
          workerPath: variablesConfig.audioWorkerPath,
          workerData: {
            file,
            operation: "processAudio",
            nasOriginal: this.fileManager.nasOriginal,
            nas2400: this.fileManager.nas2400,
          },
        };

      case "documentos":
        return {
          workerPath: variablesConfig.documentWorkerPath,
          workerData: {
            file,
            operation: "processDocument",
            collectionPath: this.currentCollectionPath,
            ...baseConfig,
          },
        };

      default:
        throw new Error(`Tipo de archivo no soportado: ${fileType}`);
    }
  }

  getProgressMessage(fileType) {
    const messages = {
      imagenes: "Procesando imágenes",
      peliculas: "Procesando películas",
      audios: "Procesando audios",
      documentos: "Procesando documentos",
    };

    return messages[fileType] || "Procesando archivos";
  }

  cleanup() {
    [...this.thumbnailWorkerPool, ...this.workerPool].forEach((worker) => {
      try {
        worker.terminate();
      } catch (error) {
        console.error("Error terminating worker:", error);
      }
    });

    this.thumbnailWorkerPool = [];
    this.fileProcessingPool = [];
  }
}

module.exports = WorkerManager;
