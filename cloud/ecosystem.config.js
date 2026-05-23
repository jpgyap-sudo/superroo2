/**
 * SuperRoo Cloud — PM2 Ecosystem
 *
 * Crash-resilient PM2 configuration with:
 * - Exponential backoff restart delays
 * - Memory limits to prevent OOM
 * - Max restart limits to avoid crash loops
 * - Graceful shutdown timeouts
 *
 * Usage:
 *   cd /opt/superroo2/cloud
 *   pm2 start ecosystem.config.js
 *   pm2 save
 */

const fs = require("fs")
const path = require("path")

function readEnvValue(name) {
	const envPath = path.join(__dirname, ".env")
	try {
		const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/)
		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith("#")) continue
			const match = trimmed.match(/^([^=]+)=(.*)$/)
			if (match && match[1].trim() === name) {
				return match[2].trim().replace(/^['"]|['"]$/g, "")
			}
		}
	} catch {
		// .env is optional; process.env remains the preferred source.
	}
	return ""
}

module.exports = {
	apps: [
		{
			name: "superroo-mcp-memory",
			script: "server/src/memory/McpMemoryServer.ts",
			interpreter: "/opt/superroo2/node_modules/.bin/tsx",
			cwd: "/opt/superroo2",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "192M",
			exp_backoff_restart_delay: 1000,
			max_restarts: 10,
			restart_delay: 5000,
			min_uptime: 10000,
			kill_timeout: 15000,
			env: {
				NODE_ENV: "production",
				CENTRAL_BRAIN_URL: "http://127.0.0.1:3417",
				REST_API_FALLBACK_URL: "http://127.0.0.1:8787",
				MCP_SERVER_PORT: "3419",
				MCP_SERVER_HOST: "127.0.0.1",
				SUPERROO_ROOT: "/opt/superroo2",
				CODEX_TASK_LOG_PATH: "/opt/superroo2/server/src/memory/codextask.json",
			},
			log_file: "/opt/superroo2/cloud/logs/mcp-memory-combined.log",
			out_file: "/opt/superroo2/cloud/logs/mcp-memory-out.log",
			error_file: "/opt/superroo2/cloud/logs/mcp-memory-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			merge_logs: true,
		},
		{
			name: "superroo-api",
			script: "./api/api.js",
			cwd: "/opt/superroo2/cloud",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "256M",
			exp_backoff_restart_delay: 2000,
			max_restarts: 15,
			restart_delay: 10000,
			min_uptime: 30000,
			kill_timeout: 30000,
			// NOTE: env_file is NOT supported by PM2 v7 — all env vars must be in the env block
			// See: https://github.com/Unitech/PM2/issues/5764
			env: {
				NODE_ENV: "production",
				REDIS_URL: "redis://127.0.0.1:6379",
				SUPERROO_QUEUE_NAME: "superroo-jobs",
				API_PORT: "8787",
				// Telegram Bot — loaded from env; never commit secrets to this file
				TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
				BOSS_TELEGRAM_CHAT_ID: process.env.BOSS_TELEGRAM_CHAT_ID || "8485794779",
				SUPERROO_VAULT_KEY: process.env.SUPERROO_VAULT_KEY || readEnvValue("SUPERROO_VAULT_KEY"),
				SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
				SMTP_PORT: process.env.SMTP_PORT || "587",
				SMTP_USER: process.env.SMTP_USER || "",
				SMTP_FROM: process.env.SMTP_FROM || "",
				// Ollama (Local AI) — FREE, runs on VPS
				OLLAMA_BASE_URL: "http://127.0.0.1:11434",
				OLLAMA_CHAT_MODEL: "qwen2.5:0.5b",
				OLLAMA_SUMMARY_MODEL: "qwen2.5:0.5b",
				OLLAMA_EMBED_MODEL: "nomic-embed-text",
				OLLAMA_NUM_CTX: 2048,
				OLLAMA_TIMEOUT_MS: 120000,
				// PostgreSQL (BugKnowledgeStore)
				PGPASSWORD: process.env.PGPASSWORD || readEnvValue("PGPASSWORD"),
				PGUSER: "superroo",
				PGDATABASE: "superroo",
				PGHOST: "127.0.0.1",
				PGPORT: "5432",
				// OpenHands-style runtime server
				SUPERROO_RUNTIME_URL: "http://127.0.0.1:3418",
				// Cloud Orchestrator
				ORCHESTRATOR_DB_PATH: "/opt/superroo2/cloud/orchestrator/data/orchestrator.db",
				ORCHESTRATOR_MODE: "safe",
				ORCHESTRATOR_SELF_IMPROVE: "false",
				ORCHESTRATOR_LOOP_INTERVAL: "5000",
				ORCHESTRATOR_LEADER: "true",
				CODEX_TASK_LOG_PATH: "/opt/superroo2/server/src/memory/codextask.json",
			},
			log_file: "/opt/superroo2/cloud/logs/api-combined.log",
			out_file: "/opt/superroo2/cloud/logs/api-out.log",
			error_file: "/opt/superroo2/cloud/logs/api-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			merge_logs: true,
		},
		{
			name: "superroo-worker",
			script: "./worker/worker.js",
			cwd: "/opt/superroo2/cloud",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "512M",
			exp_backoff_restart_delay: 2000,
			max_restarts: 10,
			restart_delay: 5000,
			min_uptime: 15000,
			kill_timeout: 30000,
			env_file: "/opt/superroo2/cloud/.env",
			env: {
				NODE_ENV: "production",
				REDIS_URL: "redis://127.0.0.1:6379",
				SUPERROO_QUEUE_NAME: "superroo-jobs",
				WORKER_CONCURRENCY: "2",
				SUPERROO_ROOT: "/opt/superroo2",
				SANDBOX_IMAGE: "superroo-sandbox:latest",
				// Sandbox runner config
				JOB_TIMEOUT_MS: "600000",
				SANDBOX_MAX_RETRIES: "2",
				SANDBOX_MEMORY: "512m",
				SANDBOX_CPUS: "1",
				// Worker resilience config
				WORKER_MAX_REDIS_FAILURES: "5",
				WORKER_HEALTH_CHECK_INTERVAL_MS: "30000",
				SUPERROO_VAULT_KEY: process.env.SUPERROO_VAULT_KEY || readEnvValue("SUPERROO_VAULT_KEY"),
				OLLAMA_BASE_URL: "http://127.0.0.1:11434",
				OLLAMA_CHAT_MODEL: "qwen2.5:0.5b",
				// Central Brain (BrainClient lesson recall in agentRunners)
				CENTRAL_BRAIN_URL: "http://127.0.0.1:3417",
				// Telegram notification config
				API_BASE_URL: "http://127.0.0.1:8787",
			},
			log_file: "/opt/superroo2/cloud/logs/worker-combined.log",
			out_file: "/opt/superroo2/cloud/logs/worker-out.log",
			error_file: "/opt/superroo2/cloud/logs/worker-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			merge_logs: true,
		},
		{
			name: "superroo-dashboard",
			script: "./.next/standalone/server.js",
			cwd: "/opt/superroo2/cloud/dashboard",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "256M",
			exp_backoff_restart_delay: 1000,
			max_restarts: 10,
			restart_delay: 5000,
			min_uptime: 10000,
			kill_timeout: 15000,
			env: {
				NODE_ENV: "production",
				PORT: "3001",
			},
			log_file: "/opt/superroo2/cloud/logs/dashboard-combined.log",
			out_file: "/opt/superroo2/cloud/logs/dashboard-out.log",
			error_file: "/opt/superroo2/cloud/logs/dashboard-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			merge_logs: true,
		},
		{
			name: "superroo-runtime",
			script: "./runtime/server.js",
			cwd: "/opt/superroo2/cloud",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "128M",
			exp_backoff_restart_delay: 1000,
			max_restarts: 10,
			restart_delay: 5000,
			min_uptime: 10000,
			kill_timeout: 15000,
			env: {
				NODE_ENV: "production",
				SUPERROO_RUNTIME_PORT: "3418",
				CENTRAL_BRAIN_URL: "http://127.0.0.1:3417",
			},
			log_file: "/opt/superroo2/cloud/logs/runtime-combined.log",
			out_file: "/opt/superroo2/cloud/logs/runtime-out.log",
			error_file: "/opt/superroo2/cloud/logs/runtime-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			merge_logs: true,
		},
		// NOTE: superroo-mini-ide is managed by Docker Compose
		// (cloud/docker/docker-compose.yml) — do NOT add to PM2.
		{
			name: "superroo-auto-deployer",
			script: "./worker/autoDeployer.js",
			cwd: "/opt/superroo2/cloud",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "128M",
			exp_backoff_restart_delay: 2000,
			max_restarts: 10,
			restart_delay: 5000,
			min_uptime: 10000,
			kill_timeout: 15000,
			env: {
				NODE_ENV: "production",
				AUTO_DEPLOYER_PORT: "8790",
			},
			log_file: "/opt/superroo2/cloud/logs/auto-deployer-combined.log",
			out_file: "/opt/superroo2/cloud/logs/auto-deployer-out.log",
			error_file: "/opt/superroo2/cloud/logs/auto-deployer-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			merge_logs: true,
		},
		{
			name: "superroo-ram-orchestrator",
			script: "./worker/vpsRamOrchestratorWorker.js",
			cwd: "/opt/superroo2/cloud",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "128M",
			exp_backoff_restart_delay: 2000,
			max_restarts: 10,
			restart_delay: 5000,
			min_uptime: 10000,
			kill_timeout: 15000,
			env: {
				NODE_ENV: "production",
				RAM_WARNING_PERCENT: "70",
				RAM_CRITICAL_PERCENT: "80",
				RAM_DANGER_PERCENT: "90",
				RAM_RECOVERY_PERCENT: "60",
				RAM_CHECK_INTERVAL_MS: "5000",
				RAM_ORCHESTRATOR_PORT: "3456",
				REDIS_URL: "redis://127.0.0.1:6379",
				SUPERROO_QUEUE_NAME: "superroo-jobs",
				API_BASE_URL: "http://127.0.0.1:8787",
				// GAP 10: Cluster mode — set to "true" to enable cluster awareness
				RAM_CLUSTER_MODE: "false",
				RAM_ENABLE_ALERTS: "true",
				RAM_ENABLE_HISTORY: "true",
				RAM_ENABLE_AUTO_SCALE: "false",
				RAM_ALERT_COOLDOWN_MS: "300000",
				RAM_HISTORY_MAX_SAMPLES: "720",
			},
			log_file: "/opt/superroo2/cloud/logs/ram-orchestrator-combined.log",
			out_file: "/opt/superroo2/cloud/logs/ram-orchestrator-out.log",
			error_file: "/opt/superroo2/cloud/logs/ram-orchestrator-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			merge_logs: true,
		},
		// GAP 10: Cluster mode entry (uncomment and set RAM_CLUSTER_MODE=true to enable)
		// {
		// 	name: "superroo-ram-orchestrator-cluster",
		// 	script: "./worker/vpsRamOrchestratorWorker.js",
		// 	cwd: "/opt/superroo2/cloud",
		// 	instances: 0,
		// 	exec_mode: "cluster",
		// 	autorestart: true,
		// 	watch: false,
		// 	max_memory_restart: "256M",
		// 	exp_backoff_restart_delay: 2000,
		// 	max_restarts: 10,
		// 	restart_delay: 5000,
		// 	min_uptime: 10000,
		// 	kill_timeout: 15000,
		// 	env: {
		// 		NODE_ENV: "production",
		// 		RAM_WARNING_PERCENT: "70",
		// 		RAM_CRITICAL_PERCENT: "80",
		// 		RAM_DANGER_PERCENT: "90",
		// 		RAM_RECOVERY_PERCENT: "60",
		// 		RAM_CHECK_INTERVAL_MS: "5000",
		// 		RAM_ORCHESTRATOR_PORT: "3456",
		// 		REDIS_URL: "redis://127.0.0.1:6379",
		// 		SUPERROO_QUEUE_NAME: "superroo-jobs",
		// 		API_BASE_URL: "http://127.0.0.1:8787",
		// 		RAM_CLUSTER_MODE: "true",
		// 		RAM_ENABLE_ALERTS: "true",
		// 		RAM_ENABLE_HISTORY: "true",
		// 		RAM_ENABLE_AUTO_SCALE: "false",
		// 		RAM_ALERT_COOLDOWN_MS: "300000",
		// 		RAM_HISTORY_MAX_SAMPLES: "720",
		// 	},
		// 	log_file: "/opt/superroo2/cloud/logs/ram-orchestrator-cluster-combined.log",
		// 	out_file: "/opt/superroo2/cloud/logs/ram-orchestrator-cluster-out.log",
		// 	error_file: "/opt/superroo2/cloud/logs/ram-orchestrator-cluster-error.log",
		// 	log_date_format: "YYYY-MM-DD HH:mm:ss Z",
		// 	merge_logs: true,
		// },
	],
}
