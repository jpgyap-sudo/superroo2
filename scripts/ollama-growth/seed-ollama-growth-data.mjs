import fs from "fs";

fs.mkdirSync("memory/ollama", { recursive: true });

fs.appendFileSync(
  "memory/ollama/growth-events.jsonl",
  JSON.stringify({
    id: "growth_seed",
    created_at: new Date().toISOString(),
    event_type: "compliance",
    task: "Audit Claude workflow",
    quality_score: 4
  }) + "\n"
);

console.log("Seeded Ollama growth data.");
