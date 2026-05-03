# SuperRoo Dashboard

A Next.js-based dashboard for monitoring and managing the SuperRoo Cloud infrastructure.

## Features

- **Overview**: System health and metrics
- **Jobs**: View and manage job execution
- **Queue**: Monitor the BullMQ job queue
- **Agents**: Browse available agents
- **Skill Generator**: Generate new skills
- **Logs**: View system logs
- **Docker**: Monitor Docker sandbox status

## Prerequisites

- Node.js 18+ installed
- Redis running on `localhost:6379`
- SuperRoo API running on port `8787`

## Development

```bash
cd cloud/dashboard
npm install
npm run dev
```

The dashboard will be available at `http://localhost:3001`

## Production Build

```bash
cd cloud/dashboard
npm run build
npm start
```

## PM2 Deployment

The dashboard is configured in `cloud/ecosystem.config.js` as `superroo-dashboard`.

### Start all services (including dashboard):

```bash
cd /opt/superroo2/cloud
pm2 start ecosystem.config.js
pm2 save
```

### Start only the dashboard:

```bash
pm2 start ecosystem.config.js --only superroo-dashboard
```

### View dashboard logs:

```bash
pm2 logs superroo-dashboard
```

### Restart dashboard:

```bash
pm2 restart superroo-dashboard
```

## Configuration

The dashboard proxies API requests to `http://localhost:8787` via Next.js rewrites (configured in `next.config.js`).

## Troubleshooting

### Dashboard won't start

1. Check if port 3001 is available: `netstat -ano | findstr :3001` (Windows) or `lsof -i :3001` (Linux/Mac)
2. Ensure dependencies are installed: `npm install`
3. Check if the build exists: `npm run build`

### API connection issues

1. Verify the API is running: `curl http://localhost:8787/health`
2. Check PM2 status: `pm2 status`
3. Review API logs: `pm2 logs superroo-api`

### Redis connection issues

1. Verify Redis is running: `redis-cli ping`
2. Check Redis connection in API logs
