#!/bin/bash
# Run this ENTIRE script in the DigitalOcean web console
# It creates all files and deploys the sandbox

set -e

PROJECT_ROOT="/opt/superroo2"
CLOUD_DIR="${PROJECT_ROOT}/cloud"
SANDBOX_DIR="${CLOUD_DIR}/sandbox"
WORKER_DIR="${CLOUD_DIR}/worker"
LOGS_DIR="${CLOUD_DIR}/logs"

mkdir -p "${SANDBOX_DIR}/jobs"
mkdir -p "${LOGS_DIR}/jobs"
mkdir -p "${WORKER_DIR}"

# ---------------------------------------------------------------------------
# Dockerfile
# ---------------------------------------------------------------------------
cat > "${SANDBOX_DIR}/Dockerfile" << 'DOCKEREOF'
FROM node:20
RUN apt-get update && apt-get install -y git curl bash && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /workspace
CMD ["bash"]
DOCKEREOF

# ---------------------------------------------------------------------------
# sandboxRunner.js
# ---------------------------------------------------------------------------
cat > "${WORKER_DIR}/sandboxRunner.js" << 'RUNEOF'
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = process.env.SUPERROO_ROOT || "/opt/superroo2";
const SANDBOX_DIR = path.join(PROJECT_ROOT, "cloud", "sandbox");
const JOBS_DIR = path.join(SANDBOX_DIR, "jobs");
const LOGS_DIR = path.join(PROJECT_ROOT, "cloud", "logs", "jobs");
const IMAGE_NAME = process.env.SANDBOX_IMAGE || "superroo-sandbox:latest";

function isDangerousCommand(cmd) {
  const lower = cmd.toLowerCase();
  const forbidden = [
    "rm -rf /", "rm -rf /*", "shutdown", "reboot", "halt", "poweroff",
    "mkfs", "dd if=/dev/zero", ":(){ :|:& };:",
  ];
  return forbidden.some((f) => lower.includes(f));
}

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

async function runSandboxJob(job) {
  const jobId = job.id || `job-${Date.now()}`;
  const taskName = job.task || "untitled";
  const commands = Array.isArray(job.commands) ? job.commands : [];

  for (const cmd of commands) {
    if (isDangerousCommand(cmd)) {
      throw new Error(`Dangerous command blocked: ${cmd}`);
    }
  }

  const jobFolder = path.join(JOBS_DIR, jobId);
  if (!fs.existsSync(jobFolder)) {
    fs.mkdirSync(jobFolder, { recursive: true });
  }

  ensureLogsDir();
  const logPath = path.join(LOGS_DIR, `${jobId}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  const timestamp = () => new Date().toISOString();
  const log = (line) => {
    const text = `[${timestamp()}] ${line}\n`;
    logStream.write(text);
    process.stdout.write(text);
  };

  log(`=== Job ${jobId} started | task: ${taskName} ===`);

  const dockerArgs = [
    "run", "--rm", "--network=none",
    "-v", `${jobFolder}:/workspace`,
    "-w", "/workspace",
    "--cpus=1", "--memory=512m",
    "--name", `superroo-sandbox-${jobId}`,
    IMAGE_NAME, "bash", "-c", commands.join(" && "),
  ];

  log(`Docker command: docker ${dockerArgs.join(" ")}`);

  return new Promise((resolve, reject) => {
    const proc = spawn("docker", dockerArgs, { detached: false });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      log(`[stdout] ${chunk.trimEnd()}`);
    });

    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      log(`[stderr] ${chunk.trimEnd()}`);
    });

    proc.on("error", (err) => {
      log(`[error] ${err.message}`);
      logStream.end();
      reject(err);
    });

    proc.on("close", (code) => {
      const success = code === 0;
      log(`=== Job ${jobId} finished | exit code: ${code} | success: ${success} ===`);
      logStream.end();
      resolve({ success, logPath, stdout, stderr, exitCode: code });
    });
  });
}

module.exports = { runSandboxJob };
RUNEOF

# ---------------------------------------------------------------------------
# worker.js
# ---------------------------------------------------------------------------
cat > "${WORKER_DIR}/worker.js" << 'WORKEREOF'
const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const { runSandboxJob } = require("./sandboxRunner");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const QUEUE_NAME = process.env.SUPERROO_QUEUE_NAME || "superroo-jobs";
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

async function processJob(job) {
  console.log(`[worker] Received job ${job.id} — task: ${job.data.task || "n/a"}`);
  try {
    const result = await runSandboxJob({
      id: job.id,
      task: job.data.task,
      commands: job.data.commands,
    });
    console.log(`[worker] Job ${job.id} completed | success=${result.success} | log=${result.logPath}`);
    return result;
  } catch (error) {
    console.error(`[worker] Job ${job.id} failed:`, error.message);
    throw error;
  }
}

const worker = new Worker(QUEUE_NAME, processJob, { connection, concurrency: CONCURRENCY });

worker.on("completed", (job) => console.log(`[worker] completed event — job ${job.id}`));
worker.on("failed", (job, err) => console.error(`[worker] failed event — job ${job.id}: ${err.message}`));
worker.on("error", (err) => console.error("[worker] Worker error:", err.message));

console.log(`[worker] Started | queue=${QUEUE_NAME} | redis=${REDIS_URL} | concurrency=${CONCURRENCY}`);
WORKEREOF

# ---------------------------------------------------------------------------
# ecosystem.config.js
# ---------------------------------------------------------------------------
cat > "${CLOUD_DIR}/ecosystem.config.js" << 'PM2EOF'
module.exports = {
  apps: [{
    name: "superroo-worker",
    script: "./worker/worker.js",
    cwd: "/opt/superroo2/cloud",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "512M",
    env: {
      NODE_ENV: "production",
      REDIS_URL: "redis://127.0.0.1:6379",
      SUPERROO_QUEUE_NAME: "superroo-jobs",
      WORKER_CONCURRENCY: "2",
      SUPERROO_ROOT: "/opt/superroo2",
      SANDBOX_IMAGE: "superroo-sandbox:latest",
    },
    log_file: "/opt/superroo2/cloud/logs/worker-combined.log",
    out_file: "/opt/superroo2/cloud/logs/worker-out.log",
    error_file: "/opt/superroo2/cloud/logs/worker-error.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  }],
};
PM2EOF

# ---------------------------------------------------------------------------
# test-job.js
# ---------------------------------------------------------------------------
cat > "${CLOUD_DIR}/test-job.js" << 'TESTEOF'
const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const QUEUE_NAME = process.env.SUPERROO_QUEUE_NAME || "superroo-jobs";

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(QUEUE_NAME, { connection });

async function publish() {
  const job = await queue.add("sandbox-test", {
    task: "sandbox test",
    commands: ["node -v", "npm -v", "pnpm -v", "git --version"],
  });
  console.log(`Test job published: ${job.id}`);
  await queue.close();
  process.exit(0);
}

publish().catch((err) => { console.error("Failed:", err); process.exit(1); });
TESTEOF

# ---------------------------------------------------------------------------
# deploy-sandbox.sh
# ---------------------------------------------------------------------------
cat > "${CLOUD_DIR}/deploy-sandbox.sh" << 'DEPL EOF'
#!/bin/bash
set -euo pipefail

PROJECT_ROOT="/opt/superroo2"
CLOUD_DIR="${PROJECT_ROOT}/cloud"
SANDBOX_DIR="${CLOUD_DIR}/sandbox"
IMAGE_NAME="superroo-sandbox:latest"

echo "========================================"
echo "SuperRoo Cloud Sandbox Deploy"
echo "========================================"

echo ""
echo "[1/7] Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker not installed."
    exit 1
fi
if ! sudo systemctl is-active --quiet docker; then
    echo "Starting Docker..."
    sudo systemctl start docker
fi
echo "Docker OK: $(docker --version)"

echo ""
echo "[2/7] Directories OK."

echo ""
echo "[3/7] Building Docker image..."
cd "${SANDBOX_DIR}"
docker build -t "${IMAGE_NAME}" .
echo "Image built."

echo ""
echo "[4/7] Installing dependencies..."
cd "${CLOUD_DIR}"
if [ ! -d "node_modules/bullmq" ] || [ ! -d "node_modules/ioredis" ]; then
    npm install bullmq ioredis
else
    echo "Dependencies already present."
fi

echo ""
echo "[5/7] Starting worker with PM2..."
cd "${CLOUD_DIR}"
if pm2 describe superroo-worker &> /dev/null; then
    pm2 restart ecosystem.config.js
else
    pm2 start ecosystem.config.js
fi
echo "Worker started."

echo ""
echo "[6/7] Publishing test job..."
node test-job.js

echo ""
echo "[7/7] Tailing logs..."
sleep 2
pm2 logs superroo-worker --lines 50
DEPL EOF

chmod +x "${CLOUD_DIR}/deploy-sandbox.sh"

echo ""
echo "========================================"
echo "All files created. Now deploying..."
echo "========================================"
"${CLOUD_DIR}/deploy-sandbox.sh"
