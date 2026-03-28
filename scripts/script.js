// scripts/generate-md.js
const fs = require("fs");
const path = require("path");

// Change this to your repo root
const ROOT_DIR = path.resolve(__dirname, ".."); // points to L:\Engine
const OUTPUT_FILE = path.resolve(__dirname, "./", "PROJECT_DOC.md");

// File extensions to include
const INCLUDE_EXTENSIONS = [".ts"];

function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);

    // Skip node_modules
    if (fullPath.includes("node_modules")) continue;

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      walkDir(fullPath, fileList);
    } else if (INCLUDE_EXTENSIONS.includes(path.extname(file))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function generateMarkdown() {
  const files = walkDir(ROOT_DIR);
  let mdContent = "# Project Files Documentation\n\n";

  for (const file of files) {
    const relativePath = path.relative(ROOT_DIR, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf-8");
    const ext = path.extname(file).slice(1); // e.g., ts, js
    mdContent += `### ${relativePath}\n\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
  }

  fs.writeFileSync(OUTPUT_FILE, mdContent, "utf-8");
  console.log(`Markdown file generated at: ${OUTPUT_FILE}`);
}

generateMarkdown();
