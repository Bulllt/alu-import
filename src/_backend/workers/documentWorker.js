const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs-extra");
const crypto = require("crypto");
const S3Manager = require("../s3Manager");
const { PDFDocument } = require("pdf-lib");
const { execSync } = require("child_process");

class DocumentProcessorWorker {
  constructor(workerData) {
    this.workerData = workerData;
    this.s3Manager = new S3Manager();
  }

  async processDocument() {
    const { file, collectionPath } = this.workerData;

    try {
      const documentPath = path.dirname(file.path);
      const documentFolder = path.basename(documentPath);
      const [prefix, isInventoryNumber] = documentFolder.split("_");
      const isInCollectionRoot = documentPath === collectionPath;

      let hashedFilename;

      if (/^\d+$/.test(isInventoryNumber) && !isInCollectionRoot) {
        hashedFilename = await this.processMultiPageDocument(
          documentPath,
          documentFolder,
          file
        );
      } else {
        hashedFilename = await this.processSinglePageDocument(file);
      }

      return {
        ...file,
        processed: true,
        s3Hash: hashedFilename,
      };
    } catch (error) {
      return {
        ...file,
        processed: false,
        error: error.message,
        s3Hash: null,
      };
    }
  }

  async processMultiPageDocument(documentPath, documentBase, file) {
    const imageFiles = (await fs.readdir(documentPath))
      .filter((file) =>
        /\.(tiff|tif|jpg|jpeg|png|bmp)$/i.test(path.extname(file))
      )
      .sort((a, b) => {
        const getNumA = parseInt(a.match(/\d+/)?.[0] || 0);
        const getNumB = parseInt(b.match(/\d+/)?.[0] || 0);
        return getNumA - getNumB;
      });

    const prefix = documentBase.split("_")[0];

    fs.ensureDirSync(path.join(this.workerData.nasOriginal, prefix));
    fs.ensureDirSync(path.join(this.workerData.nas2400, prefix));

    const pdfPages = [];
    const textContents = {};

    for (let i = 0; i < imageFiles.length; i++) {
      const imagePath = path.join(documentPath, imageFiles[i]);
      const createThumbnail = i === 0;

      const result = await this.processImageWithOCR(imagePath, createThumbnail);
      if (result) {
        pdfPages.push(result.pdfPath);
        textContents[`page${i + 1}`] = result.textContent;
      }
    }

    if (pdfPages.length === 0) {
      throw new Error("No PDF pages were successfully created");
    }

    const originalPdfPath = path.join(
      this.workerData.nasOriginal,
      prefix,
      `${documentBase}.pdf`
    );
    const compressedPdfPath = path.join(
      this.workerData.nas2400,
      prefix,
      `${documentBase}.pdf`
    );
    const jsonPath = path.join(
      this.workerData.nas2400,
      prefix,
      `${documentBase}.json`
    );

    await this.mergePDFs(pdfPages, originalPdfPath);

    const hashedFilename = await this.compressPdfWithGhostscript(
      originalPdfPath,
      compressedPdfPath
    );

    await this.createTextJSON(textContents, jsonPath);

    await this.cleanupTemporaryFiles(pdfPages);

    return hashedFilename;
  }

  async processSinglePageDocument(file) {
    const documentBase = `${file.code}_${file.n_object}`;
    const prefix = `${file.code}`;

    fs.ensureDirSync(path.join(this.workerData.nasOriginal, prefix));
    fs.ensureDirSync(path.join(this.workerData.nas2400, prefix));

    const originalPdfPath = path.join(
      this.workerData.nasOriginal,
      prefix,
      `${documentBase}.pdf`
    );
    const compressedPdfPath = path.join(
      this.workerData.nas2400,
      prefix,
      `${documentBase}.pdf`
    );
    const jsonPath = path.join(
      this.workerData.nas2400,
      prefix,
      `${documentBase}.json`
    );

    const result = await this.processImageWithOCR(file.path, true);
    if (!result) {
      throw new Error("Failed to process image with OCR");
    }

    await fs.move(result.pdfPath, originalPdfPath);
    const hashedFilename = await this.compressPdfWithGhostscript(
      originalPdfPath,
      compressedPdfPath
    );
    await this.createTextJSON({ page1: result.textContent }, jsonPath);

    return hashedFilename;
  }

  async processImageWithOCR(imagePath, createThumbnail = true) {
    const directory = path.dirname(imagePath);
    const baseName = path.basename(imagePath, path.extname(imagePath));
    const outputBase = path.join(directory, baseName);
    const temp400pxPath = path.join(
      this.workerData.temp400pxDir,
      `${baseName}.jpg`
    );

    fs.ensureDirSync(this.workerData.temp400pxDir);

    const tesseractCommand = [
      "tesseract",
      `"${imagePath}"`,
      `"${outputBase}"`,
      "-l spa",
      "pdf txt",
    ].join(" ");

    try {
      try {
        execSync(tesseractCommand, {
          stdio: "pipe",
          encoding: "utf8",
        });
      } catch (tesseractError) {
        console.warn(
          `Tesseract warning for ${baseName}:`,
          tesseractError.message
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      const pdfPath = `${outputBase}.pdf`;
      if (!(await fs.pathExists(pdfPath))) {
        throw new Error(`PDF not created by Tesseract: ${pdfPath}`);
      }

      if (createThumbnail) {
        await this.createThumbnail(imagePath, temp400pxPath);
      }

      const textContent = await this.extractTextContent(outputBase);

      return {
        pdfPath,
        textContent,
      };
    } catch (error) {
      console.error(`OCR failed for ${imagePath}:`, error.message);
      await this.cleanupPartialFiles(outputBase, temp400pxPath);
      return null;
    }
  }

  async createThumbnail(imagePath, temp400pxPath) {
    try {
      const createThumbnailCommand = [
        "magick",
        `"${imagePath}"`,
        "-resize 400x400",
        "-quality 70%",
        `"${temp400pxPath}"`,
      ].join(" ");

      execSync(createThumbnailCommand, { stdio: "pipe" });

      if (await fs.pathExists(temp400pxPath)) {
        await this.s3Manager.sendToBucket(null, temp400pxPath, "documentos");
        await fs.remove(temp400pxPath);
      }
    } catch (thumbnailError) {
      console.warn(`Thumbnail creation failed:`, thumbnailError.message);
    }
  }

  async extractTextContent(outputBase) {
    const txtFilePath = `${outputBase}.txt`;
    let textContent = "";

    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (await fs.pathExists(txtFilePath)) {
          await new Promise((resolve) =>
            setTimeout(resolve, 200 * (attempt + 1))
          );

          textContent = await fs.readFile(txtFilePath, "utf8");
          textContent = this.normalizeText(textContent);

          await this.removeFileWithRetry(txtFilePath);
          break;
        } else {
          if (attempt === maxRetries - 1) {
            console.warn(
              `Text file not found after ${maxRetries} attempts: ${txtFilePath}`
            );
          }
        }
      } catch (error) {
        if (attempt === maxRetries - 1) {
          console.warn(
            `Could not read text file after ${maxRetries} attempts:`,
            error.message
          );
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 200 * (attempt + 1))
        );
      }
    }

    return textContent;
  }

  async removeFileWithRetry(filePath, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
          return true;
        }
        return true;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          console.warn(
            `Could not remove ${filePath} after ${maxRetries} attempts:`,
            error.message
          );
          return false;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * Math.pow(2, attempt))
        );
      }
    }
    return false;
  }

  async cleanupPartialFiles(outputBase, temp400pxPath) {
    const filesToClean = [
      `${outputBase}.pdf`,
      `${outputBase}.txt`,
      temp400pxPath,
    ];

    for (const file of filesToClean) {
      await this.removeFileWithRetry(file);
    }
  }

  async cleanupTemporaryFiles(pdfPages) {
    for (const page of pdfPages) {
      await this.removeFileWithRetry(page);
    }
  }

  normalizeText(text) {
    if (!text) return "";

    return text
      .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9.,;:!?¡¿'\-_/°()$€£¥¢\s]/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/["]/g, "'")
      .trim();
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
        jsonObject[page] = text ? text.replace(/\n+/g, " ").trim() : "";
      }

      await fs.writeFile(
        outputPath,
        JSON.stringify(jsonObject, null, 2),
        "utf8"
      );
    } catch (error) {
      console.error("Error creating text JSON:", error);
      throw new Error(`Failed to create text JSON: ${error.message}`);
    }
  }

  async mergePDFs(pdfPaths, outputPath) {
    try {
      const mergedPdf = await PDFDocument.create();

      for (const pdfPath of pdfPaths) {
        let pdfBytes = null;
        const maxRetries = 3;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            if (!(await fs.pathExists(pdfPath))) {
              console.error(`PDF file not found: ${pdfPath}`);
              break;
            }

            pdfBytes = await fs.readFile(pdfPath);
            break;
          } catch (readError) {
            if (attempt === maxRetries - 1) {
              console.error(
                `Error reading ${pdfPath} after ${maxRetries} attempts:`,
                readError.message
              );
            } else {
              await new Promise((resolve) =>
                setTimeout(resolve, 200 * (attempt + 1))
              );
            }
          }
        }

        if (!pdfBytes) {
          console.error(`Skipping ${pdfPath} - could not read file`);
          continue;
        }

        try {
          const pdf = await PDFDocument.load(pdfBytes);

          const pageCount = pdf.getPageCount();

          for (let i = 0; i < pageCount; i++) {
            try {
              const [copiedPage] = await mergedPdf.copyPages(pdf, [i]);
              mergedPdf.addPage(copiedPage);
            } catch (pageError) {
              console.error(`Error copying page ${i}:`, pageError.message);
            }
          }
        } catch (pdfError) {
          console.error(`Error processing ${pdfPath}:`, pdfError.message);
        }
      }

      if (mergedPdf.getPageCount() === 0) {
        throw new Error("No valid pages to merge");
      }

      const mergedPdfBytes = await mergedPdf.save();
      await fs.writeFile(outputPath, mergedPdfBytes);
    } catch (error) {
      console.error("PDF merge error:", error);
      throw new Error(`Failed to merge PDFs: ${error.message}`);
    }
  }

  async compressPdfWithGhostscript(inputPath, outputPath) {
    if (await fs.pathExists(outputPath)) {
      const hash = await this.generateFileHash(outputPath);
      const baseName = path.basename(outputPath, path.extname(outputPath));
      return `${baseName}_01_${hash}`;
    }

    const gsCommand = [
      "gswin64c",
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      "-dPDFSETTINGS=/ebook",
      "-dNOPAUSE",
      "-dBATCH",
      "-dQUIET",
      `-sOutputFile="${outputPath}"`,
      `"${inputPath}"`,
    ].join(" ");

    try {
      execSync(gsCommand, { stdio: "pipe" });

      if (!(await fs.pathExists(outputPath))) {
        throw new Error("Ghostscript output file was not created");
      }

      const hash = await this.generateFileHash(outputPath);
      const baseName = path.basename(outputPath, path.extname(outputPath));
      const hashedFilename = `${baseName}_01_${hash}`;

      await this.s3Manager.sendToBucket(
        outputPath,
        null,
        "documentos",
        hashedFilename
      );

      return hashedFilename;
    } catch (error) {
      console.error(`Ghostscript failed:`, error);
      throw new Error(`PDF compression failed: ${error.message}`);
    }
  }

  async generateFileHash(filePath) {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const hash = crypto.createHash("sha256");
      hash.update(fileBuffer);
      return hash.digest("hex").substring(0, 16);
    } catch (error) {
      console.error("Error generating file hash:", error);
      return "unknown_hash";
    }
  }
}

(async () => {
  try {
    const processor = new DocumentProcessorWorker(workerData);

    let result;
    if (workerData.operation === "processDocument") {
      result = await processor.processDocument();
    } else {
      throw new Error(`Unknown operation: ${workerData.operation}`);
    }

    parentPort.postMessage(result);
  } catch (error) {
    console.error("Document processor worker fatal error:", error);

    parentPort.postMessage({
      ...workerData.file,
      processed: false,
      error: error.message,
      s3Hash: null,
    });
  }
})();
