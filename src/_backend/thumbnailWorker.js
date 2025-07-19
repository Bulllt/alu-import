const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs-extra");
const crypto = require("crypto");
const { execSync } = require("child_process");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(require("ffmpeg-static"));

async function generateThumbnail(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const videoExtensions = [".mp4", ".avi", ".mov", ".mkv", ".webm"];
    const audioExtensions = [".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a"];

    if (audioExtensions.includes(ext)) {
      return "audio";
    }

    const tempDir = path.join(require("os").tmpdir(), "alu-thumbnails");
    await fs.ensureDir(tempDir);
    const fileHash = crypto.createHash("md5").update(filePath).digest("hex");
    const thumbnailFilename = `${fileHash}.png`;
    const thumbnailPath = path.join(tempDir, thumbnailFilename);

    if (await fs.pathExists(thumbnailPath)) {
      const thumbBuffer = await fs.readFile(thumbnailPath);
      return `data:image/png;base64,${thumbBuffer.toString("base64")}`;
    }

    if (videoExtensions.includes(ext)) {
      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .screenshots({
            timestamps: ["1"],
            filename: thumbnailFilename,
            folder: tempDir,
            size: "100x?",
          })
          .on("end", resolve)
          .on("error", reject);
      });
    } else {
      const command = [
        "magick convert",
        `"${filePath}"`,
        "-resize 100x100^>",
        `"${thumbnailPath}"`,
      ].join(" ");

      execSync(command, { stdio: "pipe" });
    }

    const thumbBuffer = await fs.readFile(thumbnailPath);
    return `data:image/png;base64,${thumbBuffer.toString("base64")}`;
  } catch (error) {
    console.error(`Thumbnail generation failed for ${filePath}:`, error);
    return null;
  }
}

(async () => {
  try {
    const result = await generateThumbnail(workerData.filePath);
    parentPort.postMessage(result);
  } catch (error) {
    console.error("Worker fatal error:", error);
    process.exit(1);
  }
})();
