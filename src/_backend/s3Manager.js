const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const fs = require("fs-extra");
const path = require("path");
const mime = require("mime-types");

class S3Manager {
  constructor() {
    const s3Config = {
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    };

    s3Config.endpoint = process.env.AWS_URL;

    this.s3 = new S3Client(s3Config);

    this.buckets = {
      MAIN: process.env.S3_MAIN_BUCKET,
    };

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
        Bucket: this.buckets.MAIN,
        Key: fullKey,
        Body: fileBuffer,
        ContentType: contentType,
        ACL: "public-read",
      });

      await this.s3.send(command);
      return true;
    } catch (error) {
      console.error(`Error uploading to ${this.buckets.MAIN}:`, error.message);
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
      }

      return true;
    } catch (error) {
      console.error("Error in sendToBucket:", error);
      throw error;
    }
  }

  async deleteFromBucket(bucketName, key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      await this.s3.send(command);
      return { success: true, bucket: bucketName, key: key };
    } catch (error) {
      console.error(`Error deleting from ${bucketName}:`, error.message);
      throw error;
    }
  }

  async listBucketFiles(folderPath, prefix, baseNumber) {
    try {
      const startKey = `${folderPath}/${prefix}_${baseNumber}`;

      const command = new ListObjectsV2Command({
        Bucket: this.buckets.MAIN,
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
      let filesToDelete = [];

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

        filesToDelete = [
          ...images2400.map((file) => ({
            bucket: this.buckets.MAIN,
            key: file,
            type: "2400px",
          })),
          ...images400.map((file) => ({
            bucket: this.buckets.MAIN,
            key: file,
            type: "400px",
          })),
        ];
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

        filesToDelete = [
          ...thumbnails.map((file) => ({
            bucket: this.buckets.MAIN,
            key: file,
            type: "thumbnail",
          })),
          ...videos.map((file) => ({
            bucket: this.buckets.MAIN,
            key: file,
            type: "video",
          })),
        ];
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

        filesToDelete = [
          ...thumbnails.map((file) => ({
            bucket: this.buckets.MAIN,
            key: file,
            type: "thumbnail",
          })),
          ...documents.map((file) => ({
            bucket: this.buckets.MAIN,
            key: file,
            type: "document",
          })),
        ];
      } else if (fileType === "audios") {
        const audios = await this.listBucketFiles(
          this.folders.FILES,
          prefix,
          baseNumber
        );

        filesToDelete = [
          ...audios.map((file) => ({
            bucket: this.buckets.MAIN,
            key: file,
            type: "audio",
          })),
        ];
      }

      const deleteResults = [];
      for (const file of filesToDelete) {
        try {
          const result = await this.deleteFromBucket(file.bucket, file.key);
          deleteResults.push({ ...result, type: file.type });
        } catch (error) {
          console.error(`Failed to delete ${file.key}:`, error.message);
          deleteResults.push({
            success: false,
            key: file.key,
            error: error.message,
          });
        }
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
