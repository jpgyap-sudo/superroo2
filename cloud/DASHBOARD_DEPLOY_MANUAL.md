# Manual Dashboard Deployment Guide

If automated deployment scripts are having SSH issues, follow these manual steps.

## Prerequisites

- SSH access to your VPS: `superroo@104.248.225.250`
- The VPS should have the project at `/opt/superroo2`

## Deployment Steps

### 1. Connect to your VPS

```bash
ssh superroo@104.248.225.250
```

### 2. Navigate to project directory

```bash
cd /opt/superroo2
```

### 3. Pull latest changes

```bash
git pull origin main
```

### 4. Install dashboard dependencies

```bash
cd cloud/dashboard
npm install
```

### 5. Build the dashboard

```bash
npm run build
```

This will create the production build in `.next` directory.

### 6. Ensure logs directory exists

```bash
cd /opt/superroo2/cloud
mkdir -p logs
```

### 7. Start/Restart PM2 services

If PM2 services are already running:

```bash
cd /opt/superroo2/cloud
pm2 restart ecosystem.config.js
pm2 save
```

If this is the first time:

```bash
cd /opt/superroo2/cloud
pm2 start ecosystem.config.js
pm2 save
```

### 8. Verify deployment

Check that all services are running:

```bash
pm2 list
```

You should see three services:

- `superroo-api` (port 8787)
- `superroo-worker`
- `superroo-dashboard` (port 3001)

### 9. Check dashboard logs

```bash
pm2 logs superroo-dashboard --lines 50
```

### 10. Test the dashboard

From your local machine or browser:

```
http://104.248.225.250:3001
```

## Troubleshooting

### Dashboard not starting

```bash
# Check if port 3001 is in use
netstat -tulpn | grep 3001

# Check dashboard logs
pm2 logs superroo-dashboard

# Try restarting just the dashboard
pm2 restart superroo-dashboard
```

### API connection issues

The dashboard connects to the API at `http://localhost:8787`. Verify the API is running:

```bash
# Check API status
curl http://localhost:8787/health

# Check API logs
pm2 logs superroo-api
```

### Build errors

If the build fails:

```bash
cd /opt/superroo2/cloud/dashboard

# Clean and rebuild
rm -rf .next node_modules
npm install
npm run build
```

### Port 3001 not accessible from outside

If you can't access the dashboard from your browser, check firewall:

```bash
# Check if port 3001 is open
sudo ufw status

# Open port 3001 if needed
sudo ufw allow 3001/tcp
```

Or configure it in DigitalOcean's Cloud Firewall settings.

## Quick Commands Reference

```bash
# View all services
pm2 list

# View dashboard logs
pm2 logs superroo-dashboard

# Restart dashboard
pm2 restart superroo-dashboard

# Stop dashboard
pm2 stop superroo-dashboard

# View all logs
pm2 logs

# Monitor in real-time
pm2 monit
```

## What Changed

The following files were updated to add dashboard support:

1. **`cloud/ecosystem.config.js`** - Added `superroo-dashboard` PM2 app configuration
2. **`cloud/dashboard/README.md`** - Dashboard documentation
3. **`cloud/deploy-dashboard.sh`** - Automated deployment script (Linux/Mac)
4. **`cloud/deploy-dashboard-windows.ps1`** - Automated deployment script (Windows)

## Dashboard Features

Once running, the dashboard provides:

- **Overview**: System health and metrics
- **Jobs**: View and manage job execution
- **Queue**: Monitor the BullMQ job queue
- **Agents**: Browse available agents
- **Skill Generator**: Generate new skills
- **Logs**: View system logs
- **Docker**: Monitor Docker sandbox status
