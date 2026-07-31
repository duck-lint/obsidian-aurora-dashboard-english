import { readFileSync } from "node:fs";

// Scan only source modules that emit user-visible interface text. Core word
// counting and its multilingual fixtures are intentionally excluded.
const interfaceFiles = [
  "src/dashboard-view.ts",
  "src/detail-modal.ts",
  "src/main.ts",
  "src/quick-plugin-modal.ts",
  "src/settings.ts"
];
const cjkPattern = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const failures = [];

for (const file of interfaceFiles) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (cjkPattern.test(line)) failures.push(`${file}:${index + 1}: ${line.trim()}`);
  });
}

if (failures.length > 0) {
  console.error("Untranslated CJK interface text found:");
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Interface translation check passed (${interfaceFiles.length} files scanned).`);
