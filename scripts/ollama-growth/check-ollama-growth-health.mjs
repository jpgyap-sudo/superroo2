import fs from "fs";

const files = [
  "memory/ollama/growth-events.jsonl",
  "memory/ollama/readiness-checks.jsonl",
  "memory/ollama/readiness-report.json"
];

for (const file of files) {
  console.log(`${fs.existsSync(file) ? "✅" : "⚠️"} ${file}`);
}
