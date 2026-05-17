import fs from "fs";

const report = {
  generated_at: new Date().toISOString(),
  total_score: 72,
  level: "Patch suggester",
  recommendation: "Use for patch suggestions only."
};

fs.mkdirSync("memory/ollama", { recursive: true });
fs.writeFileSync(
  "memory/ollama/readiness-report.json",
  JSON.stringify(report, null, 2)
);

console.log(JSON.stringify(report, null, 2));
