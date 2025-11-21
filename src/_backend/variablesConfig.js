const path = require("path");

class variablesConfig {
  constructor() {
    this.isProduction = process.env.NODE_ENV === "production";

    this.watermarkPath = this.isProduction
      ? path.join(process.resourcesPath, "watermark.png")
      : path.join(__dirname, "..", "..", "src", "assets", "watermark.png");

    this.thumbnailWorkerPath = this.isProduction
      ? path.join(process.resourcesPath, "dist", "thumbnailWorker", "index.js")
      : path.join(
          __dirname,
          "..",
          "..",
          "src",
          "_backend",
          "workers",
          "thumbnailWorker.js"
        );

    this.imageWorkerPath = this.isProduction
      ? path.join(process.resourcesPath, "dist", "imageWorker", "index.js")
      : path.join(
          __dirname,
          "..",
          "..",
          "src",
          "_backend",
          "workers",
          "imageWorker.js"
        );

    this.movieWorkerPath = this.isProduction
      ? path.join(process.resourcesPath, "dist", "movieWorker", "index.js")
      : path.join(
          __dirname,
          "..",
          "..",
          "src",
          "_backend",
          "workers",
          "movieWorker.js"
        );

    this.ffmpegPath = this.isProduction
      ? path.join(process.resourcesPath, "ffmpeg.exe")
      : require("ffmpeg-static");

    this.ffmpegOutputOptions = this.isProduction
      ? [
          "-c:v hevc_nvenc",
          "-cq 1",
          "-preset slow",
          "-profile:v main10",
          "-rc vbr_hq",
          "-b:v 5000K",
          "-maxrate 7M",
          "-refs 4",
          "-an",
        ]
      : ["-c:v hevc_nvenc", "-preset medium", "-cq 23", "-an"];

    this.audioWorkerPath = this.isProduction
      ? path.join(process.resourcesPath, "dist", "audioWorker", "index.js")
      : path.join(
          __dirname,
          "..",
          "..",
          "src",
          "_backend",
          "workers",
          "audioWorker.js"
        );

    this.documentWorkerPath = this.isProduction
      ? path.join(process.resourcesPath, "dist", "documentWorker", "index.js")
      : path.join(
          __dirname,
          "..",
          "..",
          "src",
          "_backend",
          "workers",
          "documentWorker.js"
        );

    this.ffmpegPath = this.isProduction
      ? path.join(process.resourcesPath, "ffmpeg.exe")
      : require("ffmpeg-static");

    this.apiConfig = this.isProduction
      ? { protocol: "https:", hostname: "archivolaunion.cl" }
      : { protocol: "http:", hostname: "alu.test" };

    this.AWS_URL = this.isProduction
      ? process.env.AWS_URL_PROD
      : process.env.AWS_URL_DEV;

    this.AWS_ACCESS_KEY_ID = this.isProduction
      ? process.env.AWS_ACCESS_KEY_ID_PROD
      : process.env.AWS_ACCESS_KEY_ID_DEV;

    this.AWS_SECRET_ACCESS_KEY = this.isProduction
      ? process.env.AWS_SECRET_ACCESS_KEY_PROD
      : process.env.AWS_SECRET_ACCESS_KEY_DEV;
  }
}

module.exports = new variablesConfig();
