const fs = require("fs-extra");
const path = require("path");
const chokidar = require("chokidar");
const { net } = require("electron");
require("dotenv").config({
  path: path.join(process.resourcesPath, ".env"),
});
const crypto = require("crypto");
const { OpenAI } = require("openai");
const { createClient } = require("@deepgram/sdk");
const ffmpeg = require("fluent-ffmpeg");
const { execSync } = require("child_process");
const { PDFDocument } = require("pdf-lib");
const S3Manager = require("./s3Manager");
const variablesConfig = require("./variablesConfig");

class FileManager {
  constructor(sendStatusToRenderer, configPath) {
    // Initial file processing
    this.watchers = new Map();
    this.sendStatusToRenderer = sendStatusToRenderer || (() => {});
    this.configPath = configPath;
    this.codePrefix = null;
    this.lastInventoryNumber = 0;
    this.pendingCollections = [];
    this.originalNames = new Map();

    // Import of the files
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.deepgram = createClient(process.env.DEEPGRAM_API_KEY);

    this.baseDir = null;
    this.lastImported = null;

    this.nasOriginal = null;
    this.nas2400 = null;

    this.initializePath();
    //this.nasOriginal = "\\\\Nasarchivo\\archivo\\2400px\\DC\\archivos";
    //this.nas2400 = "\\\\Nasarchivo\\archivo\\original\\DC\\archivos";
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
    this.lastImported = path.join(this.baseDir, "buzon_importados");
    fs.ensureDirSync(this.lastImported);

    this.nasOriginal = path.join(this.baseDir, "original");
    this.nas2400 = path.join(this.baseDir, "2400px");
    fs.ensureDirSync(this.nasOriginal);
    fs.ensureDirSync(this.nas2400);
  }

  initializeCodePrefix(collectionPath) {
    const collectionFolder = path.basename(collectionPath);
    this.codePrefix = collectionFolder.split("_")[0];

    const config = this.readConfig();
    this.lastInventoryNumber = config.inventoryNumber;
  }

  // Process of collections and files
  async createWatcher(rootFolderPath) {
    try {
      this.watchers.forEach((watcher) => watcher.close());
      this.watchers.clear();
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
        awaitWriteFinish: {
          stabilityThreshold: 1000,
          pollInterval: 100,
        },
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
      this.sendStatusToRenderer(
        "error",
        "Error al procesar (startCollectionProcessing)"
      );
      return false;
    }
  }

  async processCollection(collectionPath) {
    try {
      await this.initializeCodePrefix(collectionPath);
      const items = await fs.readdir(collectionPath);
      const processedItems = [];

      const csvFile = items.find(
        (item) => path.extname(item).toLowerCase() === ".csv"
      );
      if (csvFile) {
        const csvPath = path.join(collectionPath, csvFile);
        const csvData = await this.parseCSVFile(csvPath);

        if (csvData && this.mainWindow) {
          this.mainWindow.webContents.send("csv-file", csvData);
        }
      }

      for (const item of items) {
        if (path.extname(item).toLowerCase() === ".csv") continue;

        const itemPath = path.join(collectionPath, item);
        const stats = await fs.stat(itemPath);

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
      this.sendStatusToRenderer(
        "error",
        "Error al procesar (processCollection)"
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
      await fs.rename(filePath, newFilePath);
      this.sendStatusToRenderer("success", `Se proceso el archivo ${fileName}`);

      return {
        newName: newFileName,
        inventoryCode: newInventoryCode,
        path: newFilePath,
      };
    } catch (error) {
      this.lastInventoryNumber--;
      this.sendStatusToRenderer("error", "Error al procesar (processFile)");
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
      await this.retryFolderRename(folderPath, newFolderPath);
      const files = await fs.readdir(newFolderPath);
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

        await fs.rename(filePath, newFilePath);

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

  isInventoryFolder(folderName) {
    return /^[A-Z]{1,3}_\d{7}$/.test(folderName);
  }
  isInventoryFile(fileName) {
    return /^[A-Z]{1,3}_\d{7}_\d{2}\.\w{3,4}$/.test(fileName);
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

  // IMAGE PROCESS SECTION
  async processImageImport(files, collectionPath) {
    const lastInventoryCode = `${files[0].code}_${files[0].n_object}_${files[0].n_ic}`;
    const lastCollection = path.basename(collectionPath);
    const pathParts = collectionPath.split(path.sep);
    const lastType = pathParts[pathParts.length - 3];

    const config = this.readConfig();
    const updatedConfig = {
      ...config,
      lastImportCode: lastInventoryCode,
      lastCollectionName: lastCollection,
      lastCollectionType: lastType,
    };
    this.writeConfig(updatedConfig);

    const updateProgress = (percent) => {
      this.mainWindow.webContents.send("import-progress", Math.round(percent));
    };

    try {
      const watcher = this.watchers.get(collectionPath);
      await watcher.close();
      this.watchers.delete(collectionPath);
      updateProgress(10);

      await this.processAndConvertImages(files, (fraction) => {
        updateProgress(10 + fraction * 50);
      });

      await this.executeRollback(collectionPath);
      updateProgress(70);

      await this.moveToImported(collectionPath);
      updateProgress(80);

      // Generate AI description for the last processed collection
      const [prefix, baseNumber] = lastInventoryCode.split("_");
      const importedFiles = await fs.readdir(path.join(this.nas2400, prefix));
      const imageFiles = importedFiles.filter((file) => {
        const fileParts = path.basename(file, path.extname(file)).split("_");
        return fileParts[0] === prefix && fileParts[1] >= baseNumber;
      });

      const aiResults = await this.generateAIDescriptions(imageFiles, prefix);

      // Update files with AI descriptions
      const updatedFiles = files.map((file, index) => ({
        ...file,
        ai_description: aiResults[index]?.description || "",
        ai_elements:
          JSON.stringify(
            aiResults[index]?.elements
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item !== "")
          ) || "",
        path: null,
      }));
      updateProgress(90);

      const token = this.generateToken();
      await this.sendToDatabase(updatedFiles, token);
      updateProgress(100);
      return true;
    } catch (error) {
      updateProgress(100);
      console.error("Error inside processImageImport:", error);
      throw error;
    }
  }

  async processAndConvertImages(files, progressCallback) {
    const totalFiles = files.length;
    let processedFiles = 0;

    for (const file of files) {
      const filePath = file.path;
      const ext = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath, ext);
      const prefix = fileName.split("_")[0];

      fs.ensureDirSync(path.join(this.nasOriginal, prefix));
      fs.ensureDirSync(path.join(this.nas2400, prefix));

      const nasOriginalPath = path.join(
        this.nasOriginal,
        prefix,
        `${fileName}${ext}`
      );
      const nas2400Path = path.join(this.nas2400, prefix, `${fileName}.jpg`);
      const temp400pxPath = path.join(this.temp400pxDir, `${fileName}.jpg`);

      await fs.copy(filePath, nasOriginalPath);

      const convert2400Command = [
        "magick convert",
        `"${filePath}"`,
        "-auto-level",
        "-auto-gamma",
        "-sharpen 0x1",
        "-gravity center",
        "-crop 85%x85%+0+0 +repage",
        "-contrast-stretch 0.2%x0.2%",
        "-resize 2400x2400^>",
        "-quality 85%",
        `"${nas2400Path}"`,
      ].join(" ");

      const convert400Command = [
        "magick convert",
        `"${filePath}"`,
        "-resize 400x400^>",
        "-quality 70%",
        `"${temp400pxPath}"`,
      ].join(" ");

      try {
        execSync(convert2400Command, { stdio: "pipe" });
        execSync(convert400Command, { stdio: "pipe" });
        await this.s3Manager.sendToBucket(
          nas2400Path,
          temp400pxPath,
          "imagenes"
        );
        await fs.remove(temp400pxPath);

        processedFiles++;
        progressCallback(processedFiles / totalFiles);
      } catch (convertError) {
        console.error(
          `processAndConvertImages error ${filePath}:`,
          convertError
        );
        throw error;
      }
    }
  }

  async generateAIDescriptions(imageFiles, prefix) {
    const results = [];
    const prompt = `Necesito dos textos del contenido de esta fotografía que es parte de nuestro archivo histórico:
    1. description: [descripción absolutamente objetiva del contenido visual, sin inferencias. Describe personas, objetos, paisajes, gestos faciales visibles, disposición espacial y cualquier texto legible]
    2. elements: [listado exacto de objetos materiales visibles, separados por comas, los elementos deben estar formados por una sola palabra. Solo incluir elementos claramente visibles]

    Reglas:
    - Sé absolutamente objetivo, sin interpretar ni especular
    - Nunca mencionar lo que no es claramente visible
    - Usar caracteres UTF-8 válidos
    - Formato exacto de respuesta:
    """
    description: [texto aquí]
    elements: [texto aquí]
    """`;

    for (const file of imageFiles) {
      try {
        const imagePath = path.join(this.nas2400, prefix, file);
        const imageBase64 = await fs.readFile(imagePath, {
          encoding: "base64",
        });

        const response = await this.openai.chat.completions.create({
          model: "gpt-4-turbo",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpg;base64,${imageBase64}` },
                },
              ],
            },
          ],
          max_tokens: 300,
        });

        const responseText = response.choices[0].message.content;
        const cleanText = (text) => {
          return text
            .replace(/^\[|\]$/g, "")
            .replace(/\s+/g, " ")
            .trim();
        };

        const descriptionMatch = responseText.match(
          /description:\s*(.*?)(?=\nelements:|$)/s
        );
        const elementsMatch = responseText.match(/elements:\s*(.*)/);

        results.push({
          description: descriptionMatch ? cleanText(descriptionMatch[1]) : "",
          elements: elementsMatch ? cleanText(elementsMatch[1]) : "",
        });
      } catch (error) {
        console.error(`Error generating description for ${file}:`, error);
        results.push({
          description: "",
          elements: "",
        });
      }
    }

    return results;
  }

  // MOVIE PROCESS SECTION
  async processMovieImport(files, collectionPath) {
    const lastInventoryCode = `${files[0].code}_${files[0].n_object}_${files[0].n_ic}`;
    const lastCollection = path.basename(collectionPath);
    const pathParts = collectionPath.split(path.sep);
    const lastType = pathParts[pathParts.length - 3];

    const config = this.readConfig();
    const updatedConfig = {
      ...config,
      lastImportCode: lastInventoryCode,
      lastCollectionName: lastCollection,
      lastCollectionType: lastType,
    };
    this.writeConfig(updatedConfig);

    const updateProgress = (percent) => {
      this.mainWindow.webContents.send("import-progress", Math.round(percent));
    };

    try {
      const watcher = this.watchers.get(collectionPath);
      await watcher.close();
      this.watchers.delete(collectionPath);
      updateProgress(5);

      await this.convertToMovAndBackup(files, collectionPath, (fraction) => {
        updateProgress(5 + fraction * 25);
      });

      await this.processAndConvertMovies(files, (fraction) => {
        updateProgress(30 + fraction * 60);
      });

      await fs.remove(collectionPath);
      updateProgress(95);

      const updatedFiles = files.map((file) => ({
        ...file,
        path: `/storage/original/dm/${file.s3Hash}`,
      }));

      const token = this.generateToken();
      await this.sendToDatabase(updatedFiles, token);
      updateProgress(100);

      return true;
    } catch (error) {
      updateProgress(100);
      console.error("Error inside processMovieImport:", error);
      throw error;
    }
  }

  async convertToMovAndBackup(files, collectionPath, progressCallback) {
    const collectionFolderName = path.basename(collectionPath);
    const [codePrefix, rest] = collectionFolderName.split("_");
    const moviesPath = path.join(this.lastImported, "peliculas", codePrefix);
    const destinationFolder = path.join(moviesPath, collectionFolderName);

    fs.ensureDirSync(path.join(this.nasOriginal, codePrefix));
    fs.ensureDirSync(destinationFolder);

    const totalFiles = files.length;
    let processedFiles = 0;

    for (const file of files) {
      processedFiles++;
      const currentProgress = processedFiles / totalFiles;
      progressCallback(currentProgress * 0.8);

      const inputPath = file.path;
      const ext = path.extname(inputPath).toLowerCase();
      const baseName = path.basename(inputPath, ext);
      const outputFilename = `${collectionFolderName}-file${processedFiles}.mov`;
      const importedPath = path.join(destinationFolder, outputFilename);
      const nasOriginalPath = path.join(
        this.nasOriginal,
        codePrefix,
        `${baseName}.mov`
      );

      if (ext !== ".mov") {
        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .format("mov")
            .outputOptions(["-c:v copy", "-c:a copy"])
            .on("end", () => {
              progressCallback(currentProgress * 0.8 + 0.2);
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
      progressCallback(currentProgress);
    }
  }

  async processAndConvertMovies(files, progressCallback) {
    const watermarkPath = variablesConfig.watermarkPath;

    const totalFiles = files.length;
    let processedFiles = 0;

    for (const file of files) {
      processedFiles++;
      const currentProgress = processedFiles / totalFiles;
      progressCallback(currentProgress * 0.7);

      const filePath = file.path;
      const ext = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath, ext);
      const prefix = fileName.split("_")[0];

      fs.ensureDirSync(path.join(this.nas2400, prefix));

      const outputPath = path.join(this.nas2400, prefix, `${fileName}.mp4`);
      const tempThumbnailPath = path.join(this.temp400pxDir, `${fileName}.jpg`);

      try {
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(filePath)
            .input(watermarkPath)
            .complexFilter(
              [
                {
                  filter: "scale",
                  options: { w: -1, h: 1080 },
                  inputs: "[0:v]",
                  outputs: "scaled",
                },
                {
                  filter: "overlay",
                  options: {
                    x: "(main_w-overlay_w)/2",
                    y: "(main_h-overlay_h)/2",
                  },
                  inputs: ["scaled", "[1:v]"],
                  outputs: "watermarked",
                },
              ],
              "watermarked"
            )
            .outputOptions([
              "-c:v hevc_nvenc",
              "-cq 1",
              "-preset slow",
              "-profile:v main10",
              "-rc vbr_hq",
              "-b:v 5000K",
              "-maxrate 7M",
              "-refs 4",
              "-an",
            ])
            .on("end", resolve)
            .on("error", (err) => {
              console.error(
                `Error processing ${path.basename(filePath)}:`,
                err
              );
              reject(err);
            })
            .save(outputPath);
        });

        await new Promise((resolve, reject) => {
          ffmpeg(outputPath)
            .screenshots({
              timestamps: ["1"],
              filename: `${fileName}.jpg`,
              folder: this.temp400pxDir,
              size: "400x?",
            })
            .on("end", resolve)
            .on("error", reject);
        });

        const hash = await this.generateFileHash(outputPath);
        const hashedFilename = `${fileName}_${hash}`;
        file.s3Hash = hashedFilename;

        await this.s3Manager.sendToBucket(
          outputPath,
          tempThumbnailPath,
          "peliculas",
          hashedFilename
        );

        await fs.remove(tempThumbnailPath);
      } catch (error) {
        console.error(`Fatal error processing ${file.path}:`, error);
        throw error;
      }
      progressCallback(currentProgress);
    }
  }

  // AUDIO PROCESS SECTION
  async processAudioImport(files, collectionPath) {
    const lastInventoryCode = `${files[0].code}_${files[0].n_object}_${files[0].n_ic}`;
    const lastCollection = path.basename(collectionPath);
    const pathParts = collectionPath.split(path.sep);
    const lastType = pathParts[pathParts.length - 3];

    const config = this.readConfig();
    const updatedConfig = {
      ...config,
      lastImportCode: lastInventoryCode,
      lastCollectionName: lastCollection,
      lastCollectionType: lastType,
    };
    this.writeConfig(updatedConfig);

    const updateProgress = (percent) => {
      this.mainWindow.webContents.send("import-progress", Math.round(percent));
    };

    try {
      const watcher = this.watchers.get(collectionPath);
      await watcher.close();
      this.watchers.delete(collectionPath);
      updateProgress(10);

      await this.processAndConvertAudios(files, (fraction) => {
        updateProgress(10 + fraction * 70);
      });

      await this.executeRollback(collectionPath);
      updateProgress(80);

      await this.moveToImported(collectionPath);
      updateProgress(90);

      const updatedFiles = files.map((file) => ({
        ...file,
        path: `/storage/original/dm/${file.s3Hash}`,
      }));

      const token = this.generateToken();
      await this.sendToDatabase(updatedFiles, token);
      updateProgress(100);
      return true;
    } catch (error) {
      updateProgress(100);
      console.error("Error inside processAudioImport:", error);
      throw error;
    }
  }

  async processAndConvertAudios(files, progressCallback) {
    const totalFiles = files.length;
    let processedFiles = 0;

    for (const file of files) {
      const filePath = file.path;
      const ext = path.extname(filePath);
      const fileName = path.basename(filePath, ext);
      const prefix = fileName.split("_")[0];

      fs.ensureDirSync(path.join(this.nas2400, prefix));
      fs.ensureDirSync(path.join(this.nasOriginal, prefix));

      const nas2400Path = path.join(this.nas2400, prefix, `${fileName}.ogg`);
      const nasOriginalPath = path.join(
        this.nasOriginal,
        prefix,
        `${fileName}${ext}`
      );

      await fs.copy(filePath, nasOriginalPath);
      progressCallback((processedFiles + 0.1) / totalFiles);

      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .audioCodec("libopus")
          .audioBitrate("96k")
          .output(nas2400Path)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      const vttPath = path.join(this.nas2400, prefix, `${fileName}.vtt`);
      await this.generateAudioTranscription(filePath, vttPath);

      const hash = await this.generateFileHash(nas2400Path);
      const hashedFilename = `${fileName}_${hash}`;
      file.s3Hash = hashedFilename;

      await this.s3Manager.sendToBucket(
        nas2400Path,
        vttPath,
        "audios",
        hashedFilename
      );

      progressCallback((processedFiles + 0.8) / totalFiles);
      processedFiles++;
      progressCallback(processedFiles / totalFiles);
    }
  }

  async generateAudioTranscription(audioPath, vttPath) {
    try {
      const audioFile = fs.readFileSync(audioPath);

      const { result, error } =
        await this.deepgram.listen.prerecorded.transcribeFile(audioFile, {
          model: "nova-3",
          language: "multi",
          translation: "es",
          punctuate: true,
          diarize: true,
          smart_format: true,
          filler_words: true,
          utterances: true,
        });

      if (error) {
        console.error("Deepgram error:", error);
        throw error;
      }

      const vttContent = this.formatDeepgramToVtt(result);

      await fs.writeFile(vttPath, vttContent);
    } catch (error) {
      console.error("Deepgram transcription error:", error);
      throw error;
    }
  }

  formatDeepgramToVtt(transcription) {
    let vttContent = "WEBVTT\n\n";

    transcription.results.channels[0].alternatives[0].words.forEach(
      (word, index) => {
        if (
          index === 0 ||
          word.speaker !==
            transcription.results.channels[0].alternatives[0].words[index - 1]
              .speaker
        ) {
          vttContent += `\n${word.speaker}:\n`;
        }

        const startTime = new Date(word.start * 1000)
          .toISOString()
          .slice(11, 23);
        const endTime = new Date(word.end * 1000).toISOString().slice(11, 23);

        vttContent += `${startTime} --> ${endTime}\n`;
        vttContent += `${word.punctuated_word || word.word}\n\n`;
      }
    );

    return vttContent;
  }

  // DOCUMENT PROCESS SECTION
  async processDocumentImport(files, collectionPath) {
    const lastInventoryCode = `${files[0].code}_${files[0].n_object}_${files[0].n_ic}`;
    const lastCollection = path.basename(collectionPath);
    const pathParts = collectionPath.split(path.sep);
    const lastType = pathParts[pathParts.length - 3];

    const config = this.readConfig();
    const updatedConfig = {
      ...config,
      lastImportCode: lastInventoryCode,
      lastCollectionName: lastCollection,
      lastCollectionType: lastType,
    };
    this.writeConfig(updatedConfig);

    const updateProgress = (percent) => {
      this.mainWindow.webContents.send("import-progress", Math.round(percent));
    };

    try {
      const watcher = this.watchers.get(collectionPath);
      await watcher.close();
      this.watchers.delete(collectionPath);
      updateProgress(10);

      await this.processAndConvertDocuments(files, collectionPath, (fraction) =>
        updateProgress(10 + fraction * 80)
      );

      await this.executeRollback(collectionPath);
      updateProgress(90);

      await this.moveToImported(collectionPath);
      updateProgress(95);

      const updatedFiles = files.map((file) => ({
        ...file,
        path: `/storage/original/dm/${file.s3Hash}`,
      }));

      const token = this.generateToken();
      await this.sendToDatabase(updatedFiles, token);
      updateProgress(100);
      return true;
    } catch (error) {
      updateProgress(100);
      console.error("processDocumentImport error:", error);
      throw error;
    }
  }

  async processAndConvertDocuments(files, collectionPath, progressCallback) {
    const processedFolders = new Set();
    const totalFiles = files.length;
    let processedFiles = 0;
    let hashedFilename = null;

    for (const file of files) {
      try {
        const documentPath = path.dirname(file.path);
        const documentFolder = path.basename(documentPath);
        const [prefix, isInventoryNumber] = documentFolder.split("_");
        const isInCollectionRoot = documentPath === collectionPath;

        if (/^\d+$/.test(isInventoryNumber) && !isInCollectionRoot) {
          if (!processedFolders.has(documentPath)) {
            const filesInsideFolder = await fs.readdir(documentPath);

            hashedFilename = await this.processMultiPageDocument(
              documentPath,
              documentFolder
            );

            processedFolders.add(documentPath);
            processedFiles += filesInsideFolder.length;
            progressCallback((processedFiles / totalFiles) * 0.8);
          }

          file.s3Hash = hashedFilename;
        } else {
          const hashedFilename = await this.processSinglePageDocument(file);

          file.s3Hash = hashedFilename;

          processedFiles++;
          progressCallback((processedFiles / totalFiles) * 0.8);
        }
      } catch (error) {
        console.error(`processAndConvertDocuments error ${file.path}:`, error);
        throw error;
      }
    }
  }

  async processMultiPageDocument(documentPath, documentBase) {
    const imageFiles = await fs.readdir(documentPath);
    const prefix = documentBase.split("_")[0];

    fs.ensureDirSync(path.join(this.nasOriginal, prefix));
    fs.ensureDirSync(path.join(this.nas2400, prefix));

    const pdfPages = [];
    const textContents = {};

    for (let i = 0; i < imageFiles.length; i++) {
      const imagePath = path.join(documentPath, imageFiles[i]);

      const { pdfPath, textContent } = await this.processImageWithOCR(
        imagePath
      );
      pdfPages.push(pdfPath);
      textContents[`page${i + 1}`] = textContent;
    }

    const originalPdfPath = path.join(
      this.nasOriginal,
      prefix,
      `${documentBase}.pdf`
    );
    const compressedPdfPath = path.join(
      this.nas2400,
      prefix,
      `${documentBase}.pdf`
    );
    const jsonPath = path.join(this.nas2400, prefix, `${documentBase}.json`);

    await this.mergePDFs(pdfPages, originalPdfPath);

    const hashedFilename = await this.compressPdfWithGhostscript(
      originalPdfPath,
      compressedPdfPath
    );

    await this.createTextJSON(textContents, jsonPath);

    await Promise.all(pdfPages.map((page) => fs.remove(page)));

    return hashedFilename;
  }

  async processSinglePageDocument(file) {
    try {
      const documentBase = `${file.code}_${file.n_object}`;
      const prefix = `${file.code}`;
      fs.ensureDirSync(path.join(this.nasOriginal, prefix));
      fs.ensureDirSync(path.join(this.nas2400, prefix));

      const originalPdfPath = path.join(
        this.nasOriginal,
        prefix,
        `${documentBase}.pdf`
      );
      const compressedPdfPath = path.join(
        this.nas2400,
        prefix,
        `${documentBase}.pdf`
      );
      const jsonPath = path.join(this.nas2400, prefix, `${documentBase}.json`);

      const { pdfPath, textContent } = await this.processImageWithOCR(
        file.path
      );

      await fs.move(pdfPath, originalPdfPath);

      const hashedFilename = await this.compressPdfWithGhostscript(
        originalPdfPath,
        compressedPdfPath
      );

      await this.createTextJSON({ page1: textContent }, jsonPath);

      return hashedFilename;
    } catch (error) {
      console.error("Error inside processingSinglePageDocument", error);
      throw error;
    }
  }

  async processImageWithOCR(imagePath) {
    const directory = path.dirname(imagePath);
    const baseName = path.basename(imagePath, path.extname(imagePath));
    const outputBase = path.join(directory, baseName);
    const temp400pxPath = path.join(this.temp400pxDir, `${baseName}.jpg`);

    const tesseractCommand = [
      "tesseract",
      `"${imagePath}"`,
      `"${outputBase}"`,
      "-l spa",
      "-c tessedit_create_pdf=1",
      "-c textonly_pdf=0",
      "-c thresholding_window_size=0.1",
      "-c user_defined_dpi=72",
      "pdf txt",
    ].join(" ");

    const createThumbnail = [
      "magick convert",
      `"${imagePath}"`,
      "-resize 400x400^>",
      "-quality 70%",
      `"${temp400pxPath}"`,
    ].join(" ");

    try {
      execSync(tesseractCommand, { stdio: "pipe" });
      execSync(createThumbnail, { stdio: "pipe" });

      await this.s3Manager.sendToBucket(null, temp400pxPath, "documentos");
      await fs.remove(temp400pxPath);

      let textContent = "";
      try {
        textContent = await fs.readFile(`${outputBase}.txt`, "utf8");
        textContent = await this.normalizeText(textContent);
        await fs.remove(`${outputBase}.txt`);
      } catch (readError) {
        console.warn(`Could not read text file ${outputBase}.txt:`, readError);
        textContent = "";
      }

      return {
        pdfPath: `${outputBase}.pdf`,
        textContent,
      };
    } catch (error) {
      console.error(`processImageWithOCR error ${imagePath}:`, error);
      throw new Error(`Failed to process image with OCR: ${imagePath}`);
    }
  }

  normalizeText(text) {
    let normalized = text
      .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9.,;:!?¡¿'\-_/°()$€£¥¢\s]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    normalized = normalized.replace(/["]/g, "'");
    return normalized;
  }

  async createTextJSON(textContent, outputPath) {
    try {
      const sortedEntries = Object.entries(textContent).sort(
        (a, b) =>
          parseInt(a[0].replace("page", "")) -
          parseInt(b[0].replace("page", ""))
      );

      const jsonObject = {};
      for (const [page, text] of sortedEntries) {
        const formattedText = text.replace(/\n/g, "");
        jsonObject[page] = formattedText;
      }

      const jsonContent = JSON.stringify(jsonObject, null, 2);
      await fs.writeFile(outputPath, jsonContent, "utf8");
    } catch (error) {
      console.error("Error creating text JSON:", error);
      throw new Error(`Failed to create text JSON: ${error.message}`);
    }
  }

  async mergePDFs(pdfPaths, outputPath) {
    try {
      const mergedPdf = await PDFDocument.create();
      for (const pdfPath of pdfPaths) {
        const pdfBytes = await fs.readFile(pdfPath);
        const pdf = await PDFDocument.load(pdfBytes);

        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedPdfBytes = await mergedPdf.save();
      await fs.writeFile(outputPath, mergedPdfBytes);
    } catch (error) {
      console.error("mergePDFs error:", error);
      throw new Error(`Failed to merge PDFs: ${error.message}`);
    }
  }

  async compressPdfWithGhostscript(inputPath, outputPath) {
    const gsCommand = [
      "gswin64c",
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      "-dPDFSETTINGS=/ebook",
      "-dNOPAUSE",
      "-dBATCH",
      "-dJPEGQ=85",
      `-sOutputFile="${outputPath}"`,
      `"${inputPath}"`,
    ].join(" ");

    try {
      execSync(gsCommand, { stdio: "pipe" });

      const hash = await this.generateFileHash(outputPath);
      const baseName = path.basename(outputPath, path.extname(outputPath));
      const hashedFilename = `${baseName}_${hash}`;

      await this.s3Manager.sendToBucket(
        outputPath,
        null,
        "documentos",
        hashedFilename
      );

      return hashedFilename;
    } catch (error) {
      console.error(`Ghostscript compression failed for ${inputPath}:`, error);
      throw new Error("PDF compression failed", error);
    }
  }

  // Import helpers
  generateToken() {
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = process.env.APP_SECRET;
    const hmac = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}`)
      .digest("hex");

    return `${timestamp}:${hmac}`;
  }

  generateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
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
        `Cierra los archivos dentro de la carpeta ${collection} dentro de buzon_importados`
      );
      throw error;
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
