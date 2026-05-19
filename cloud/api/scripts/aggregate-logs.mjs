#!/usr/bin/env node
// VPS Log Aggregation Script
//
// Collects logs from Docker containers and PM2 processes on the VPS,
// stores them in structured JSONL files, and optionally syncs to pgvector.
//
// Run manually:  node /opt/superroo2/cloud/api/scripts/aggregate-logs.mjs
// Run via cron:  node /opt/superroo2/cloud/api/scripts/aggregate-logs.mjs --cron
//
// Options:
//   --cron       Silent mode (no stdout, errors only)
//   --tail N     Number of recent lines per source (default: 50)
//   --pgvector   Also store in pgvector for searchable history
//   --since      ISO timestamp to fetch logs since (default: 5 min ago)

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -- Configuration --------------------------------------------------------------

const LOGS_DIR = process.env.LOGS_DIR || "/opt/superroo2/cloud/logs";
const AGG_LOG_DIR = path.join(LOGS_DIR, "aggregated");
const CRON_MODE = process.argv.includes("--cron");
const TAIL_LINES = parseInt(
  process.argv.find((a) => a.startsWith("--tail="))?.split("=")[1] || "50",
  10
);
const SYNC_PGVECTOR = process.argv.includes("--pgvector");
const SINCE_ARG = process.argv.find((a) => a.startsWith("--since="));
const SINCE = SINCE_ARG
  ? new Date(SINCE_ARG.split("=")[1]).getTime()
  : Date.now() - 5 * 60 * 1000; // default: last 5 min

const DB_CONTAINER = "d2081035b419";

// Docker containers to collect logs from
const DOCKER_CONTAINERS = [
  { name: "superroo-api", container: "docker-superroo-api-1" },
  { name: "superroo-postgres", container: "superroo-postgres" },
  { name: "superroo-ollama", container: "superroo-ollama" },
  { name: "qdrant", container: "qdrant" },
  { name: "superroo-mini-ide", container: "docker-superroo-mini-ide-1" },
  { name: "qas-api", container: "qas_api" },
  { name: "qas-telegram-bot", container: "qas_telegram_bot" },
  { name: "qas-n8n", container: "qas_n8n" },
  { name: "qas-dashboard", container: "qas_dashboard" },
  { name: "qas-postgres", container: "qas_postgres" },
  { name: "qas-redis", container: "qas_redis" },
  { name: "product-studio", container: "product-studio-backend" },
  { name: "supabase-mcp", container: "supabase-mcp-server" },
];

// PM2 process names to collect logs from
const PM2_PROCESSES = [
  "superroo-api",
  "superroo-auto-deployer",
  "superroo-dashboard",
  "superroo-mcp-memory",
  "superroo-worker",
];

// -- Helpers -------------------------------------------------------------------

function log(...args) {
  if (!CRON_MODE) console.log(...args);
}

function logError(...args) {
  console.error(...args);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeExec(cmd, timeout = 15000) {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout }).trim();
  } catch (err) {
    return null;
  }
}

function parseDockerTimestamp(line) {
  // Docker log format: "2026-05-19T12:22:22.731102573Z [GIN] ..."
  // or just plain text
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (match) return new Date(match[1]).getTime();
  return Date.now();
}

function parsePm2Timestamp(line) {
  // PM2 log format: "2026-05-19T12:22:22.731Z - message"
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (match) return new Date(match[1]).getTime();
  return Date.now();
}

function detectLogLevel(line) {
  const lower = line.toLowerCase();
  if (lower.includes("error") || lower.includes("fatal") || lower.includes("exception") || lower.includes("traceback"))
    return "error";
  if (lower.includes("warn") || lower.includes("warning")) return "warn";
  if (lower.includes("debug") || lower.includes("trace")) return "debug";
  if (lower.includes("info") || lower.includes("ok") || lower.includes("success")) return "info";
  return "info";
}

function detectSource(line) {
  const lower = line.toLowerCase();
  if (lower.includes("[api]") || lower.includes("api.js") || lower.includes("/api/")) return "cloud-api";
  if (lower.includes("[worker]") || lower.includes("worker.js")) return "cloud-worker";
  if (lower.includes("[dashboard]") || lower.includes("dashboard")) return "dashboard";
  if (lower.includes("[healing]") || lower.includes("healing")) return "healing";
  if (lower.includes("[ml]") || lower.includes("ml engine") || lower.includes("tensor")) return "ml";
  if (lower.includes("[agent]") || lower.includes("agent") || lower.includes("orchestrator")) return "agent";
  if (lower.includes("[ollama]") || lower.includes("ollama") || lower.includes("nomic-embed")) return "ollama";
  if (lower.includes("[postgres]") || lower.includes("postgres") || lower.includes("psql")) return "database";
  if (lower.includes("[telegram]") || lower.includes("telegram")) return "telegram";
  if (lower.includes("[gin]") || lower.includes("http")) return "http";
  return "system";
}

// -- Collectors ----------------------------------------------------------------

function collectDockerLogs(containerName, serviceName) {
  const lines = safeExec(
    `docker logs --tail ${TAIL_LINES} ${containerName} 2>&1`,
    10000
  );
  if (!lines) return [];

  return lines
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line) => ({
      timestamp: parseDockerTimestamp(line),
      source: detectSource(line),
      level: detectLogLevel(line),
      message: line.trim(),
      service: serviceName,
      container: containerName,
      type: "docker",
    }));
}

function collectPm2Logs(processName) {
  const pm2Home = process.env.HOME || "/root";
  const outLog = `${pm2Home}/.pm2/logs/${processName}-out.log`;
  const errLog = `${pm2Home}/.pm2/logs/${processName}-error.log`;

  const entries = [];

  for (const [logPath, logType] of [
    [outLog, "out"],
    [errLog, "error"],
  ]) {
    try {
      const content = fs.readFileSync(logPath, "utf-8");
      const lines = content
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .slice(-TAIL_LINES);

      for (const line of lines) {
        entries.push({
          timestamp: parsePm2Timestamp(line),
          source: detectSource(line),
          level: logType === "error" ? "error" : detectLogLevel(line),
          message: line.trim(),
          service: processName,
          type: "pm2",
        });
      }
    } catch {
      // File may not exist yet
    }
  }

  return entries;
}

function collectSystemStats() {
  const entries = [];

  // CPU load
  try {
    const loadAvg = safeExec("cat /proc/loadavg");
    if (loadAvg) {
      const parts = loadAvg.split(" ");
      entries.push({
        timestamp: Date.now(),
        source: "system",
        level: "info",
        message: `CPU load: 1min=${parts[0]}, 5min=${parts[1]}, 15min=${parts[2]}`,
        service: "system",
        type: "metric",
        metric: "cpu_load",
        value: parseFloat(parts[0]),
      });
    }
  } catch {}

  // Memory
  try {
    const memInfo = safeExec("free -m | grep Mem");
    if (memInfo) {
      const parts = memInfo.split(/\s+/);
      const total = parseInt(parts[1]);
      const used = parseInt(parts[2]);
      const pct = total > 0 ? Math.round((used / total) * 100) : 0;
      entries.push({
        timestamp: Date.now(),
        source: "system",
        level: pct > 90 ? "warn" : "info",
        message: `Memory: ${used}MB / ${total}MB (${pct}%)`,
        service: "system",
        type: "metric",
        metric: "memory_usage",
        value: pct,
      });
    }
  } catch {}

  // Disk
  try {
    const diskInfo = safeExec("df -h / | tail -1");
    if (diskInfo) {
      const parts = diskInfo.split(/\s+/);
      const pct = parseInt(parts[4]?.replace("%", "") || "0");
      entries.push({
        timestamp: Date.now(),
        source: "system",
        level: pct > 90 ? "warn" : "info",
        message: `Disk: ${parts[2]} / ${parts[1]} (${pct}%)`,
        service: "system",
        type: "metric",
        metric: "disk_usage",
        value: pct,
      });
    }
  } catch {}

  // Docker container status
  try {
    const dockerPs = safeExec(
      `docker ps --format '{{.Names}}\t{{.Status}}' --filter 'name=superroo'`,
      10000
    );
    if (dockerPs) {
      const lines = dockerPs.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const [name, status] = line.split("\t");
        const isUp = status?.includes("Up") || status?.includes("healthy");
        entries.push({
          timestamp: Date.now(),
          source: "system",
          level: isUp ? "info" : "error",
          message: `Container ${name}: ${status || "unknown"}`,
          service: name,
          type: "docker_status",
          metric: "container_status",
          value: isUp ? 1 : 0,
        });
      }
    }
  } catch {}
  // PM2 status
  try {
    const pm2List = safeExec("pm2 jlist", 10000);
    if (pm2List) {
      const processes = JSON.parse(pm2List);
      for (const proc of processes) {
        const status = proc.pm2_env?.status || "unknown";
        const isOnline = status === "online";
        entries.push({
          timestamp: Date.now(),
          source: "system",
          level: isOnline ? "info" : "error",
          message: `PM2 ${proc.name}: ${status} (restarts: ${proc.pm2_env?.restart_time || 0})`,
          service: proc.name,
          type: "pm2_status",
          metric: "pm2_status",
          value: isOnline ? 1 : 0,
        });
      }
    }
  } catch {}

  return entries;
}

// -- Storage -------------------------------------------------------------------

function writeAggregatedLogs(entries) {
  if (entries.length === 0) {
    log("No new log entries to write.");
    return;
  }

  ensureDir(AGG_LOG_DIR);

  const dateStr = new Date().toISOString().slice(0, 10);
  const filePath = path.join(AGG_LOG_DIR, `superroo-aggregated-${dateStr}.jsonl`);

  let written = 0;
  for (const entry of entries) {
    try {
      fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
      written++;
    } catch (err) {
      logError(`[aggregate-logs] Failed to write entry: ${err.message}`);
    }
  }

  log(`Wrote ${written}/${entries.length} entries to ${filePath}`);

  // Rotate: keep only last 7 days
  rotateLogs();
}

function rotateLogs() {
  try {
    const files = fs
      .readdirSync(AGG_LOG_DIR)
      .filter((f) => f.startsWith("superroo-aggregated-") && f.endsWith(".jsonl"))
      .sort();

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      // Extract date from filename: superroo-aggregated-2026-05-19.jsonl
      const dateMatch = file.match(/superroo-aggregated-(\d{4}-\d{2}-\d{2})\.jsonl/);
      if (dateMatch) {
        const fileDate = new Date(dateMatch[1]).getTime();
        if (fileDate < sevenDaysAgo) {
          fs.unlinkSync(path.join(AGG_LOG_DIR, file));
          log(`Rotated out old log file: ${file}`);
        }
      }
    }
  } catch (err) {
    logError(`[aggregate-logs] Rotation error: ${err.message}`);
  }
}

// -- pgvector Sync -------------------------------------------------------------

async function syncToPgvector(entries) {
  if (entries.length === 0) return;

  log(`Syncing ${entries.length} entries to pgvector...`);

  // Create table if not exists
  safeExec(
    `docker exec -i ${DB_CONTAINER} psql -U superroo -d superroo -c "
      CREATE TABLE IF NOT EXISTS aggregated_logs (
        id BIGSERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source TEXT,
        level TEXT,
        message TEXT,
        service TEXT,
        type TEXT,
        metric TEXT,
        value DOUBLE PRECISION,
        container TEXT,
        embedding vector(768),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_agg_logs_timestamp ON aggregated_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_agg_logs_level ON aggregated_logs(level);
      CREATE INDEX IF NOT EXISTS idx_agg_logs_source ON aggregated_logs(source);
      CREATE INDEX IF NOT EXISTS idx_agg_logs_service ON aggregated_logs(service);
    "`,
    10000
  );

  // Use COPY from STDIN via shell redirect.
  // Write a tab-separated file with actual tab characters (not escape sequences),
  // then pipe it via shell redirect (<) so docker exec reads from host STDIN.
  // The COPY command is sent first, then the data, then the end-of-data marker.
  const BATCH_SIZE = 500;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    // Build a tab-separated COPY data stream with actual tab chars.
    // Format: timestamp TAB source TAB level TAB message TAB service TAB type TAB metric TAB value TAB container NEWLINE
    // NULL is represented as backslash-N for PostgreSQL text format.
    const TAB = "\t";
    const NULL_MARKER = "\\N";
    const lines = batch.map((e) => {
      const ts = new Date(e.timestamp).toISOString();
      const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/\n/g, " ").replace(/\r/g, " ");
      const src = esc(e.source || "system");
      const lvl = esc(e.level || "info");
      const msg = esc(e.message || "").slice(0, 2000);
      const svc = esc(e.service || "");
      const typ = esc(e.type || "log");
      const met = e.metric ? esc(e.metric) : NULL_MARKER;
      const val = e.value !== undefined ? String(e.value) : NULL_MARKER;
      const con = e.container ? esc(e.container) : NULL_MARKER;
      return [ts, src, lvl, msg, svc, typ, met, val, con].join(TAB);
    }).join("\n");

    // Build the full SQL: COPY command + data + end-of-data marker.
    // Use actual tab delimiter in the COPY command (no E'' syntax needed).
    // The end-of-data marker is backslash-dot on its own line.
    const copyCmd = "COPY aggregated_logs (timestamp, source, level, message, service, type, metric, value, container) FROM STDIN WITH (FORMAT text, DELIMITER '" + TAB + "', NULL '" + NULL_MARKER + "');";
    const eodMarker = "\\.";
    const copySql = copyCmd + "\n" + lines + "\n" + eodMarker + "\n";

    const tmpFile = "/tmp/agg-logs-copy-" + i + ".sql";
    fs.writeFileSync(tmpFile, copySql, "utf-8");

    // Use shell redirect (<) to pipe the file from the host into docker exec's STDIN.
    // docker exec -f looks for the file INSIDE the container, which doesn't exist.
    // Shell redirect reads the file on the HOST and pipes it via STDIN to psql.
    const result = safeExec(
      "docker exec -i " + DB_CONTAINER + " psql -U superroo -d superroo < " + tmpFile,
      60000
    );

    try { fs.unlinkSync(tmpFile); } catch {}

    if (result === null) {
      logError("[aggregate-logs] Batch " + (Math.floor(i / BATCH_SIZE) + 1) + " FAILED");
    } else {
      log("  Batch " + (Math.floor(i / BATCH_SIZE) + 1) + ": " + batch.length + " entries OK");
    }
  }

  log("Synced " + entries.length + " entries to pgvector.");

  // Cleanup old entries (keep 7 days)
  safeExec(
    "docker exec -i " + DB_CONTAINER + " psql -U superroo -d superroo -c \"DELETE FROM aggregated_logs WHERE timestamp < NOW() - INTERVAL '7 days';\"",
    10000
  );
}

// -- Main ----------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  log("[aggregate-logs] Starting collection at " + new Date().toISOString());
  log("  Tail lines: " + TAIL_LINES);
  log("  Since: " + new Date(SINCE).toISOString());
  log("  Sync pgvector: " + SYNC_PGVECTOR);

  const allEntries = [];

  // 1. Collect Docker logs
  log("\n-- Docker Containers --");
  for (const { name, container } of DOCKER_CONTAINERS) {
    const entries = collectDockerLogs(container, name);
    log("  " + name + " (" + container + "): " + entries.length + " lines");
    allEntries.push(...entries);
  }

  // 2. Collect PM2 logs
  log("\n-- PM2 Processes --");
  for (const proc of PM2_PROCESSES) {
    const entries = collectPm2Logs(proc);
    log("  " + proc + ": " + entries.length + " lines");
    allEntries.push(...entries);
  }

  // 3. Collect system metrics
  log("\n-- System Metrics --");
  const sysEntries = collectSystemStats();
  log("  system: " + sysEntries.length + " metrics");
  allEntries.push(...sysEntries);

  // 4. Sort by timestamp
  allEntries.sort((a, b) => a.timestamp - b.timestamp);

  // 5. Write to JSONL
  log("\n-- Storage --");
  writeAggregatedLogs(allEntries);

  // 6. Optionally sync to pgvector
  if (SYNC_PGVECTOR) {
    await syncToPgvector(allEntries);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log("\n[aggregate-logs] Done in " + elapsed + "s -- " + allEntries.length + " total entries.");
}

main().catch((err) => {
  logError("[aggregate-logs] Fatal: " + err.message);
  process.exit(1);
});
