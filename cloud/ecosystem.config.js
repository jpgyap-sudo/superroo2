/**
 * SuperRoo Cloud — PM2 Ecosystem
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
			env: {
				NODE_ENV: "production",
				REDIS_URL: "redis://127.0.0.1:6379",
				SUPERROO_QUEUE_NAME: "superroo-jobs",
				API_PORT: "8787",
			},
			log_file: "/opt/superroo2/cloud/logs/api-combined.log",
			out_file: "/opt/superroo2/cloud/logs/api-out.log",
			error_file: "/opt/superroo2/cloud/logs/api-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
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
		},
		{
			name: "superroo-dashboard",
			script: "npm",
			args: "start",
			cwd: "/opt/superroo2/cloud/dashboard",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "256M",
			env: {
				NODE_ENV: "production",
				PORT: "3001",
			},
			log_file: "/opt/superroo2/cloud/logs/dashboard-combined.log",
			out_file: "/opt/superroo2/cloud/logs/dashboard-out.log",
			error_file: "/opt/superroo2/cloud/logs/dashboard-error.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
		},
	],
}
