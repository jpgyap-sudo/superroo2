/**
 * SuperRoo Cloud — PM2 Ecosystem
 *
 * Crash-resilient PM2 configuration with:
 * - Exponential backoff restart delays
 * - Memory limits to prevent OOM
 * - Max restart limits to avoid crash loops
 * - Graceful shutdown timeouts
 *
 * SECURITY: All secrets are loaded from cloud/.env (not hardcoded here).
 * The .env file is in .gitignore and NEVER committed to git.
 *
 * Usage:
 *   cd /opt/superroo2/cloud
 *   pm2 start ecosystem.config.js
 *   pm2 save
 */

module.exports = {
	apps: [
		{
			name: "superroo-api",
			script: "./api/api.js",
			cwd: "/opt/superroo2/cloud",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "256M",
			// Crash resilience: exponential backoff restart
			// Increased min_uptime to 30s so PM2 doesn't restart too aggressively
			// when the process takes time to acquire the port after a crash
			exp_backoff_restart_delay: 2000,
			max_restarts: 15,
			restart_delay: 10000,
			min_uptime: 30000,
			// Graceful shutdown
			kill_timeout: 30000,
			// All secrets loaded from .env file — NEVER hardcode secrets here
			env_file: "./.env",
			env: {
				NODE_ENV: "production",
				// Non-secret config only — secrets go in .env
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
			// Crash resilience: exponential backoff restart
			exp_backoff_restart_delay: 2000,
			max_restarts: 10,
			restart_delay: 5000,
			min_uptime: 15000,
			// Graceful shutdown (matches worker.js shutdown handler)
			kill_timeout: 30000,
			env_file: "./.env",
			env: {
				NODE_ENV: "production",
				// Non-secret config only — secrets go in .env
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
			max_memory_restart: "512M",
			exp_backoff_restart_delay: 1000,
			max_restarts: 10,
			restart_delay: 5000,
			min_uptime: 30000,
			kill_timeout: 30000,
			kill_retry_time: 5000,
			listen_timeout: 10000,
			env_file: "./.env",
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
			name: "superroo-mini-ide",
			script: "./mini-ide/server.js",
			cwd: "/opt/superroo2/cloud",
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
			env_file: "./.env",
			env: {
				NODE_ENV: "production",
				MINI_IDE_PORT: "8081",
				CORS_ORIGIN: "https://dev.abcx124.xyz",
			},
			log_file: "/opt/superroo2/cloud/logs/mini-ide-combined.log",
			out_file: "/opt/superroo2/cloud/logs/mini-ide-out.log",
			error_file: "/opt/superroo2/cloud/logs/mini-ide-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			merge_logs: true,
		},
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
			env_file: "./.env",
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
			name: "superroo-indexer",
			script: "src/worker.js",
			cwd: "/opt/superroo2/apps/indexer-worker",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "512M",
			exp_backoff_restart_delay: 2000,
			max_restarts: 10,
			restart_delay: 5000,
			min_uptime: 15000,
			kill_timeout: 15000,
			env_file: "./.env",
			env: {
				NODE_ENV: "production",
				OLLAMA_URL: "http://localhost:11434",
				QDRANT_URL: "http://localhost:6333",
				OLLAMA_EMBED_MODEL: "nomic-embed-text",
				WATCHER_PORT: "3418",
				REPO_PATH: "/opt/superroo2",
			},
			log_file: "/opt/superroo2/cloud/logs/indexer-combined.log",
			out_file: "/opt/superroo2/cloud/logs/indexer-out.log",
			error_file: "/opt/superroo2/cloud/logs/indexer-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			merge_logs: true,
		},
	],
}
