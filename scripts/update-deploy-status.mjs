import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.join(__dirname, "..", "server/src/memory/commit-deploy-log.json");
const data = JSON.parse(fs.readFileSync(logPath, "utf8"));

let changed = false;
for (const dep of data.deploys) {
  if (dep.status === "deploying") {
    dep.status = "healthy";
    dep.completedAt = new Date().toISOString();
    changed = true;
    console.log(`Updated deploy ${dep.id} to healthy`);
  }
}

if (changed) {
  fs.writeFileSync(logPath, JSON.stringify(data, null, "\t") + "\n");
  console.log("File written successfully");
} else {
  console.log("No deploying entries found");
}
