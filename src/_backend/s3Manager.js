const {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const fs = require("fs-extra");
const path = require("path");
const mime = require("mime-types");
const variablesConfig = require("./variablesConfig");

class S3Manager {
  constructor() {
    const s3Config = {
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: variablesConfig.AWS_ACCESS_KEY_ID,
        secretAccessKey: variablesConfig.AWS_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    };

    s3Config.endpoint = variablesConfig.AWS_URL;

    this.s3 = new S3Client(s3Config);

    this.bucket = process.env.S3_BUCKET;

    this.folders = {
      IMAGES_2400: process.env.S3_2400_FOLDER,
      IMAGES_400: process.env.S3_400_FOLDER,
      FILES: process.env.S3_FILES_FOLDER,
    };
  }

  async uploadToBucket(filePath, folder, key) {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const contentType = mime.lookup(filePath) || "application/octet-stream";
      const fullKey = `${folder}/${key}`;

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: fullKey,
        Body: fileBuffer,
        ContentType: contentType,
        ACL: "public-read",
      });

      await this.s3.send(command);
      return true;
    } catch (error) {
      console.error(`Error uploading to ${this.bucket}:`, error.message);
      throw error;
    }
  }

  async sendToBucket(largeFilePath, smallFilePath, fileType, hash = null) {
    try {
      if (fileType === "imagenes") {
        await this.uploadToBucket(
          largeFilePath,
          this.folders.IMAGES_2400,
          path.basename(largeFilePath)
        );
        await this.uploadToBucket(
          smallFilePath,
          this.folders.IMAGES_400,
          path.basename(smallFilePath)
        );
      } else if (fileType === "peliculas") {
        await this.uploadToBucket(largeFilePath, this.folders.FILES, hash);
        await this.uploadToBucket(
          smallFilePath,
          this.folders.IMAGES_400,
          path.basename(smallFilePath)
        );
      } else if (fileType === "documentos") {
        if (largeFilePath) {
          await this.uploadToBucket(largeFilePath, this.folders.FILES, hash);
        }

        if (smallFilePath) {
          await this.uploadToBucket(
            smallFilePath,
            this.folders.IMAGES_400,
            path.basename(smallFilePath)
          );
        }
      } else if (fileType === "audios") {
        await this.uploadToBucket(largeFilePath, this.folders.FILES, hash);

        await this.uploadToBucket(
          smallFilePath,
          this.folders.FILES,
          `${hash}.vtt`
        );
      }

      return true;
    } catch (error) {
      console.error("Error in sendToBucket:", error);
      throw error;
    }
  }

  async deleteFromBucket(keys) {
    try {
      const command = new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: keys.map((key) => ({ Key: key })),
          Quiet: false,
        },
      });

      const response = await this.s3.send(command);

      const results = [];

      if (response.Deleted) {
        response.Deleted.forEach((deleted) => {
          results.push({
            success: true,
            bucket: this.bucket,
            key: deleted.Key,
          });
        });
      }

      if (response.Errors) {
        response.Errors.forEach((error) => {
          results.push({
            success: false,
            bucket: this.bucket,
            key: error.Key,
            error: error.Message,
            code: error.Code,
          });
        });
      }

      return results;
    } catch (error) {
      console.error(`Error deleting from ${this.bucket}:`, error.message);
      throw error;
    }
  }

  async listBucketFiles(folderPath, prefix, baseNumber) {
    try {
      const startKey = `${folderPath}/${prefix}_${baseNumber}`;

      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${folderPath}/${prefix}_`,
        StartAfter: startKey,
      });

      const data = await this.s3.send(command);
      return data.Contents.map((item) => item.Key);
    } catch (error) {
      console.error(`Error listing files in ${folderPath}:`, error.message);
      throw error;
    }
  }

  async cleanLastImportFromS3(prefix, baseNumber, fileType) {
    try {
      let deleteResults = [];

      if (fileType === "imagenes") {
        const images2400 = await this.listBucketFiles(
          this.folders.IMAGES_2400,
          prefix,
          baseNumber
        );
        const images400 = await this.listBucketFiles(
          this.folders.IMAGES_400,
          prefix,
          baseNumber
        );

        const results = await this.deleteFromBucket(images2400);
        const results2 = await this.deleteFromBucket(images400);
        deleteResults = [...results, ...results2];
      } else if (fileType === "peliculas") {
        const thumbnails = await this.listBucketFiles(
          this.folders.IMAGES_400,
          prefix,
          baseNumber
        );

        const videos = await this.listBucketFiles(
          this.folders.FILES,
          prefix,
          baseNumber
        );

        const results = await this.deleteFromBucket(thumbnails);
        const results2 = await this.deleteFromBucket(videos);

        deleteResults = [...results, ...results2];
      } else if (fileType === "documentos") {
        const thumbnails = await this.listBucketFiles(
          this.folders.IMAGES_400,
          prefix,
          baseNumber
        );

        const documents = await this.listBucketFiles(
          this.folders.FILES,
          prefix,
          baseNumber
        );

        const results = await this.deleteFromBucket(thumbnails);
        const results2 = await this.deleteFromBucket(documents);
        deleteResults = [...results, ...results2];
      } else if (fileType === "audios") {
        const audios = await this.listBucketFiles(
          this.folders.FILES,
          prefix,
          baseNumber
        );

        const results = await this.deleteFromBucket(audios);
        deleteResults = results;
      }

      const successfulDeletes = deleteResults.filter((r) => r.success).length;
      console.log(
        `✅ S3 cleanup completed. Deleted ${successfulDeletes} files`,
        "details:",
        deleteResults
      );

      return true;
    } catch (error) {
      console.error("Error in cleanLastImportFromS3:", error);
      throw error;
    }
  }
}

module.exports = S3Manager;
