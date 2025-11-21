const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs-extra");
const crypto = require("crypto");
const S3Manager = require("../s3Manager");
const { createClient, webvtt } = require("@deepgram/sdk");
const variablesConfig = require("../variablesConfig");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(variablesConfig.ffmpegPath);

class AudioProcessorWorker {
  constructor(workerData) {
    this.workerData = workerData;
    this.s3Manager = new S3Manager();
    this.deepgram = createClient(process.env.DEEPGRAM_API_KEY, {
      global: {
        fetch: {
          options: {
            bodyTimeout: 6000000,
            headersTimeout: 6000000,
          },
        },
      },
    });
  }

  async processAudio() {
    const { file, nas2400, nasOriginal } = this.workerData;

    try {
      const filePath = file.path;
      const ext = path.extname(filePath);
      const fileName = path.basename(filePath, ext);
      const prefix = fileName.split("_")[0];

      fs.ensureDirSync(path.join(nas2400, prefix));
      fs.ensureDirSync(path.join(nasOriginal, prefix));

      const nas2400Path = path.join(nas2400, prefix, `${fileName}.ogg`);
      const nasOriginalPath = path.join(
        nasOriginal,
        prefix,
        `${fileName}${ext}`
      );
      const vttPath = path.join(nas2400, prefix, `${fileName}.vtt`);

      await fs.copy(filePath, nasOriginalPath);

      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .audioCodec("libopus")
          .audioBitrate("96k")
          .output(nas2400Path)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      const hash = await this.generateFileHash(nas2400Path);
      const hashedFilename = `${fileName}_${hash}`;

      const audioS3Url = await this.s3Manager.sendToBucket(
        nas2400Path,
        null,
        "audios",
        hashedFilename
      );

      await this.generateAudioTranscription(audioS3Url, vttPath);

      await this.s3Manager.sendToBucket(
        null,
        vttPath,
        "audios",
        hashedFilename
      );

      return {
        ...file,
        processed: true,
        s3Hash: hashedFilename,
        nas2400Path,
        nasOriginalPath,
      };
    } catch (error) {
      console.error(`Audio processing failed for ${file.path}:`, error);
      return {
        ...file,
        processed: false,
        error: error.message,
      };
    }
  }

  async generateAudioTranscription(audioUrl, vttPath) {
    try {
      const source = {
        url: audioUrl,
      };

      const transcriptionOptions = {
        language: "es-419",
        punctuate: true,
        diarize: true,
        smart_format: true,
        utterances: true,
        paragraphs: true,
      };

      let { result, error } =
        await this.deepgram.listen.prerecorded.transcribeUrl(source, {
          ...transcriptionOptions,
          model: "nova-2",
        });

      const isTranscriptEmpty =
        !result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

      if (error || isTranscriptEmpty) {
        console.log("Falling back to Whisper model...");
        const fallbackResponse =
          await this.deepgram.listen.prerecorded.transcribeUrl(source, {
            ...transcriptionOptions,
            model: "whisper",
          });

        result = fallbackResponse.result;
        error = fallbackResponse.error;
      }

      const isStillEmpty =
        !result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

      if (error || isStillEmpty) {
        console.error("Transcription error or empty result:", error);
        throw new Error("Error while creating the transcription");
      }

      const vttContent = webvtt(result);
      await fs.writeFile(vttPath, vttContent);
    } catch (error) {
      console.error("Deepgram transcription error:", error);
      throw error;
    }
  }

  async generateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", (error) => {
        console.error(`Hash generation failed for ${filePath}:`, error);
        reject(error);
      });
    });
  }
}

(async () => {
  try {
    const processor = new AudioProcessorWorker(workerData);

    let result;
    if (workerData.operation === "processAudio") {
      result = await processor.processAudio();
    } else {
      throw new Error(`Unknown operation: ${workerData.operation}`);
    }

    parentPort.postMessage(result);
  } catch (error) {
    console.error("Audio processor worker fatal error:", error);

    parentPort.postMessage({
      ...workerData.file,
      processed: false,
      error: error.message,
    });
  }
})();
