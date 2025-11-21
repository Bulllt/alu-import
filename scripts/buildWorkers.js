const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const workersDir = path.join(__dirname, "..", "src", "_backend", "workers");
const distDir = path.join(__dirname, "..", "dist");

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

const files = fs.readdirSync(workersDir).filter((f) => f.endsWith(".js"));

for (const file of files) {
  const workerName = path.parse(file).name;
  const input = path.join(workersDir, file);
  const output = path.join(distDir, workerName);

  console.log(`Building worker: ${workerName}`);

  execSync(`ncc build ${input} -o ${output} --minify`, { stdio: "inherit" });
}
