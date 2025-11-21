const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs-extra");
const crypto = require("crypto");
const S3Manager = require("../s3Manager");
const variablesConfig = require("../variablesConfig");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(variablesConfig.ffmpegPath);

class MovieProcessorWorker {
  constructor(workerData) {
    this.workerData = workerData;
    this.s3Manager = new S3Manager();
  }

  async processMovie() {
    const { file, nas2400, temp400pxDir, watermarkPath } = this.workerData;

    try {
      const filePath = file.path;
      const ext = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath, ext);
      const prefix = fileName.split("_")[0];

      fs.ensureDirSync(path.join(nas2400, prefix));

      const outputPath = path.join(nas2400, prefix, `${fileName}.mp4`);
      const tempThumbnailPath = path.join(temp400pxDir, `${fileName}.jpg`);

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
          .outputOptions(variablesConfig.ffmpegOutputOptions)
          .on("end", resolve)
          .on("error", (err) => {
            console.error(`Error processing ${path.basename(filePath)}:`, err);
            reject(err);
          })
          .save(outputPath);
      });

      await new Promise((resolve, reject) => {
        ffmpeg(outputPath)
          .screenshots({
            timestamps: ["1"],
            filename: `${fileName}.jpg`,
            folder: temp400pxDir,
            size: "400x?",
          })
          .on("end", resolve)
          .on("error", reject);
      });

      const hash = await this.generateFileHash(outputPath);
      const hashedFilename = `${fileName}_${hash}`;

      await this.s3Manager.sendToBucket(
        outputPath,
        tempThumbnailPath,
        "peliculas",
        hashedFilename
      );

      await fs.remove(tempThumbnailPath);

      return {
        ...file,
        processed: true,
        s3Hash: hashedFilename,
        outputPath,
      };
    } catch (error) {
      console.error(`Movie processing failed for ${file.path}:`, error);
      return {
        ...file,
        processed: false,
        error: error.message,
      };
    }
  }

  async generateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }
}

(async () => {
  try {
    const processor = new MovieProcessorWorker(workerData);

    let result;
    if (workerData.operation === "processMovie") {
      result = await processor.processMovie();
    } else {
      throw new Error(`Unknown operation: ${workerData.operation}`);
    }

    parentPort.postMessage(result);
  } catch (error) {
    console.error("Movie processor worker fatal error:", error);

    parentPort.postMessage({
      ...workerData.file,
      processed: false,
      error: error.message,
    });
  }
})();
