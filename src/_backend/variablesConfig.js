const path = require("path");

class variablesConfig {
  constructor() {
    this.isProduction = process.env.NODE_ENV === "production";

    this.watermarkPath = this.isProduction
      ? path.join(process.resourcesPath, "watermark.png")
      : path.join(__dirname, "..", "..", "src", "assets", "watermark.png");

    this.workerPath = this.isProduction
      ? path.join(process.resourcesPath, "worker", "index.js")
      : path.join(
          __dirname,
          "..",
          "..",
          "src",
          "_backend",
          "thumbnailWorker.js"
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
