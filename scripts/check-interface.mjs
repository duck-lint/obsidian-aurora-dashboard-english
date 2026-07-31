import { readFileSync } from "node:fs";

// These are the source files that emit user-facing interface text. Core
// counting code and multilingual fixtures are intentionally outside this set.
const interfaceFiles = [
  "src/dashboard-view.ts",
  "src/detail-modal.ts",
  "src/main.ts",
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
