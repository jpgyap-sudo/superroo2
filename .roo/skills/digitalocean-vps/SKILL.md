---
name: digitalocean-vps
description: 🐳 DigitalOcean VPS — Deploy, manage, and maintain applications on DigitalOcean Droplets (VPS)
---

# DigitalOcean VPS Skill

## When To Use

Use this skill when the user asks to deploy applications to a DigitalOcean Droplet (VPS), set up a new server, configure nginx, manage PM2 processes, set up SSL certificates, configure firewalls, or perform server maintenance on DigitalOcean infrastructure.

Also use this skill when tasks involve:
- Creating and configuring DigitalOcean Droplets
- SSH key management for Droplet access
- Setting up nginx as a reverse proxy
- SSL/TLS certificate installation with Let's Encrypt/Certbot
- PM2 process management for Node.js apps
- UFW firewall configuration
- Domain DNS configuration (pointing to DigitalOcean)
- Monitoring server resources (CPU, memory, disk)
- Database setup (PostgreSQL, MySQL, Redis) on Droplets
- Docker deployment on DigitalOcean
- Load balancing with DigitalOcean Load Balancers
- Automated backups and snapshots
- Server hardening and security best practices
- Migrating applications to/from DigitalOcean

## Core Concepts

### DigitalOcean Droplet Overview

A Droplet is a virtual machine (VPS) running on DigitalOcean's infrastructure:

| Plan | vCPU | RAM | SSD | Bandwidth | Price (approx) |
|------|------|-----|-----|-----------|----------------|
| Basic | 1 | 1 GB | 25 GB | 1 TB | $6/mo |
| Basic | 2 | 2 GB | 60 GB | 2 TB | $12/mo |
| Basic | 2 | 4 GB | 80 GB | 4 TB | $24/mo |
| Premium Intel | 2 | 4 GB | 80 GB | 4 TB | $36/mo |
| Premium AMD | 2 | 4 GB | 80 GB | 4 TB | $42/mo |

### Initial Server Setup

```bash
# SSH into new Droplet
ssh root@<droplet-ip>

# Create a sudo user
adduser deploy
usermod -aG sudo deploy

# Copy SSH key
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# Disable root login (after verifying sudo user works)
# Edit /etc/ssh/sshd_config: PermitRootLogin no
systemctl restart sshd
```

## Deployment Patterns

### Node.js App Deployment

```bash
# Install Node.js (using NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Install PM2 globally
npm install -g pm2

# Clone and deploy
git clone https://github.com/user/project.git /opt/project
cd /opt/project
pnpm install
pnpm build

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Nginx Reverse Proxy

```nginx
# /etc/nginx/sites-available/app
server {
    listen 80;
    server_name example.com www.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# Enable site
ln -s /etc/nginx/sites-available/app /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### SSL with Let's Encrypt

```bash
# Install Certbot
apt-get install -y certbot python3-certbot-nginx

# Obtain certificate
certbot --nginx -d example.com -d www.example.com

# Auto-renewal (usually configured automatically)
certbot renew --dry-run

# Verify cron job
systemctl status certbot.timer
```

## PM2 Process Management

### Ecosystem File

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "api",
      script: "dist/server.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 8787,
      },
      env_file: ".env.production",
      max_memory_restart: "1G",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/api-error.log",
      out_file: "./logs/api-out.log",
      merge_logs: true,
    },
    {
      name: "worker",
      script: "dist/worker.js",
      instances: 1,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "dashboard",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: "./apps/dashboard",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
  ],
}
```

### Common PM2 Commands

```bash
pm2 list                    # List all processes
pm2 logs                    # View logs
pm2 logs api --lines 50     # View last 50 lines for specific app
pm2 monit                   # Monitor CPU/memory
pm2 restart all             # Restart all processes
pm2 reload all              # Zero-downtime reload
pm2 stop app-name           # Stop specific app
pm2 delete app-name         # Remove from PM2
pm2 save                    # Save process list
pm2 startup                 # Generate startup script
pm2 status                  # Check status
```

## Firewall Configuration (UFW)

```bash
# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow ssh
# or: ufw allow 22/tcp

# Allow HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow app-specific ports (if needed)
ufw allow 3001/tcp  # Dashboard

# Enable
ufw enable

# Status
ufw status verbose
```

## Database Setup

### PostgreSQL

```bash
# Install
apt-get install -y postgresql postgresql-contrib

# Start and enable
systemctl start postgresql
systemctl enable postgresql

# Create user and database
sudo -u postgres createuser --interactive
sudo -u postgres createdb myapp

# Configure remote access (if needed)
# Edit /etc/postgresql/16/main/postgresql.conf: listen_addresses = '*'
# Edit /etc/postgresql/16/main/pg_hba.conf: host all all 0.0.0.0/0 md5
```

### Redis

```bash
# Install
apt-get install -y redis-server

# Configure
# Edit /etc/redis/redis.conf:
#   supervised systemd
#   requirepass your-strong-password

systemctl restart redis
systemctl enable redis
```

## Monitoring

### Built-in Tools

```bash
# Resource usage
htop                    # Interactive process viewer
df -h                   # Disk usage
free -h                 # Memory usage
netstat -tulpn          # Open ports
journalctl -u nginx     # Service logs
dmesg -T                # Kernel messages

# Disk I/O
iostat -x 1
iotop

# Network
iftop
nethogs
```

### PM2 Monitoring

```bash
pm2 monit               # Real-time monitoring
pm2 list                # Process list with status
pm2 show app-name       # Detailed process info
```

## Backup Strategies

### Automated Snapshots

```bash
# Via DigitalOcean API or UI
# Create snapshot: Droplet → Snapshots → Take Snapshot

# Automated backup (enable in DigitalOcean UI)
# Costs: 20% of Droplet price
```

### Database Backups

```bash
# PostgreSQL
pg_dump -U postgres myapp > /backups/myapp-$(date +%Y%m%d).sql

# Redis
redis-cli SAVE
cp /var/lib/redis/dump.rdb /backups/redis-$(date +%Y%m%d).rdb

# Automated cron
0 3 * * * pg_dump -U postgres myapp > /backups/daily/myapp-$(date +\%Y\%m\%d).sql
```

## Security Hardening

1. **SSH Hardening**:
   - Use key-based authentication only
   - Disable root login (`PermitRootLogin no`)
   - Change default SSH port (optional, security through obscurity)
   - Use `AllowUsers deploy` to restrict SSH access

2. **Automatic Updates**:
   ```bash
   apt-get install unattended-upgrades
   dpkg-reconfigure --priority=low unattended-upgrades
   ```

3. **Fail2Ban**:
   ```bash
   apt-get install fail2ban
   cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
   systemctl restart fail2ban
   ```

4. **AppArmor/SELinux**: Keep enabled for container isolation

5. **Regular audits**: Check `last`, `auth.log`, and `ufw status`

## Common Pitfalls

1. **Running out of disk space**: Monitor with `df -h`, set up log rotation
2. **Unattended security updates breaking apps**: Pin critical packages, test updates on staging
3. **SSH timeout during long deploys**: Use `tmux` or `screen` for long-running commands
4. **Nginx default server block**: Remove or secure the default nginx site
5. **PM2 not restarting after reboot**: Run `pm2 startup` and verify the systemd service
6. **UFW blocking SSH**: Always allow SSH before enabling UFW
7. **Swap exhaustion**: Add swap if running memory-intensive apps on small Droplets
8. **DNS propagation delays**: Set low TTL before migrating, then increase after

## DigitalOcean CLI (doctl)

```bash
# Install doctl
snap install doctl

# Authenticate
doctl auth init

# List Droplets
doctl compute droplet list

# Create Droplet
doctl compute droplet create my-droplet \
  --region sgp1 \
  --size s-1vcpu-1gb \
  --image ubuntu-22-04-x64 \
  --ssh-keys <fingerprint>

# List snapshots
doctl compute snapshot list

# Create firewall
doctl compute firewall create \
  --name web-firewall \
  --inbound-rules "protocol:tcp,ports:22,80,443"
```
