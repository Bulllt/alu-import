const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs-extra");
const { execSync } = require("child_process");
const { OpenAI } = require("openai");
const S3Manager = require("../s3Manager");

class ImageProcessorWorker {
  constructor(workerData) {
    this.workerData = workerData;
    this.s3Manager = new S3Manager();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async processImage() {
    const { file, nasOriginal, nas2400, temp400pxDir } = this.workerData;

    try {
      const filePath = file.path;
      const ext = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath, ext);
      const prefix = fileName.split("_")[0];

      fs.ensureDirSync(path.join(nasOriginal, prefix));
      fs.ensureDirSync(path.join(nas2400, prefix));

      const nasOriginalPath = path.join(
        nasOriginal,
        prefix,
        `${fileName}${ext}`
      );
      const nas2400Path = path.join(nas2400, prefix, `${fileName}.jpg`);
      const temp400pxPath = path.join(temp400pxDir, `${fileName}.jpg`);

      await fs.copy(filePath, nasOriginalPath);

      const convert2400Command = [
        "magick",
        `"${filePath}"`,
        "-auto-level",
        "-auto-gamma",
        "-sharpen 0x1",
        "-gravity center",
        "-crop 85%x85%+0+0 +repage",
        "-contrast-stretch 0.2%x0.2%",
        "-resize 2400x2400",
        "-quality 85%",
        `"${nas2400Path}"`,
      ].join(" ");

      const convert400Command = [
        "magick",
        `"${filePath}"`,
        "-resize 400x400",
        "-quality 70%",
        `"${temp400pxPath}"`,
      ].join(" ");

      execSync(convert2400Command, { stdio: "pipe" });
      execSync(convert400Command, { stdio: "pipe" });

      await this.s3Manager.sendToBucket(nas2400Path, temp400pxPath, "imagenes");

      await fs.remove(temp400pxPath);

      return {
        ...file,
        processed: true,
        nas2400Path,
        nasOriginalPath,
      };
    } catch (error) {
      console.error(`Image processing failed for ${file.path}:`, error);
      return {
        ...file,
        processed: false,
        error: error.message,
      };
    }
  }

  async generateAIDescription() {
    const { imageFile, prefix, nas2400 } = this.workerData;

    try {
      const imagePath = path.join(nas2400, prefix, imageFile);
      const imageBase64 = await fs.readFile(imagePath, { encoding: "base64" });

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

      return {
        description: descriptionMatch ? cleanText(descriptionMatch[1]) : "",
        elements: elementsMatch
          ? JSON.stringify(
              cleanText(elementsMatch[1])
                .split(",")
                .map((item) => item.trim())
                .filter((item) => item !== "")
            )
          : "",
      };
    } catch (error) {
      console.error(`AI description failed for ${imageFile}:`, error);
      return {
        description: "",
        elements: "",
      };
    }
  }
}

(async () => {
  try {
    const processor = new ImageProcessorWorker(workerData);

    let result;
    if (workerData.operation === "processImage") {
      result = await processor.processImage();
    } else if (workerData.operation === "generateAIDescription") {
      result = await processor.generateAIDescription();
    }

    parentPort.postMessage(result);
  } catch (error) {
    console.error("Image processor worker fatal error:", error);

    if (workerData.operation === "processImage") {
      parentPort.postMessage({
        ...workerData.file,
        processed: false,
        error: error.message,
      });
    } else {
      parentPort.postMessage({
        description: "",
        elements: "",
      });
    }
  }
})();
