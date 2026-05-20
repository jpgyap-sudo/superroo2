

### Lesson: PM2 v7 env_file directive does not load .env — env vars must be in env block

Date: 2026-05-20
Source: Code agent task completion
Model/API used: deepseek-chat
Confidence: high
Related files: cloud/ecosystem.config.js, cloud/api/api.js

#### Task Summary

Telegram bot @superroo_bot stopped responding to messages. Investigation revealed the webhook endpoint returned {"ok":false,"error":"TELEGRAM_BOT_TOKEN not configured"} because the TELEGRAM_BOT_TOKEN was defined in /opt/superroo2/cloud/.env but PM2's env_file directive did not load it into the process environment.

#### Files Changed

- cloud/ecosystem.config.js

#### Bug Cause

PM2 v7.0.1's `env_file` directive does NOT load .env file contents into the process environment. The ecosystem.config.js had `env_file: "/opt/superroo2/cloud/.env"` but the TELEGRAM_BOT_TOKEN and BOSS_TELEGRAM_CHAT_ID were never passed to the superroo-api process. When Telegram sent webhook POSTs, the handler at api.js:10535 checked `if (!TELEGRAM_BOT_TOKEN)` and returned the error response.

#### Fix Applied

1. Removed the non-functional `env_file` directive from ecosystem.config.js
2. Added TELEGRAM_BOT_TOKEN and BOSS_TELEGRAM_CHAT_ID directly to the `env` block
3. Added comment explaining PM2 v7 does not support env_file
4. Deployed: git pull, pm2 delete superroo-api, pm2 start cloud/ecosystem.config.js --only superroo-api (pm2 restart reuses old env, must delete and re-create)
5. Verified: TELEGRAM_BOT_TOKEN now in /proc/PID/environ
6. Verified: webhook endpoint returns {"ok":true}

#### Test Result

pass

#### Lesson Learned

PM2 v7's `env_file` directive is NOT functional — it does not load .env file contents into the process environment. All environment variables must be specified directly in the `env` block of ecosystem.config.js. Additionally, `pm2 restart` reuses the old process environment; to pick up new env vars from the config file, you must `pm2 delete` and `pm2 start` the process.

#### Reusable Rule

Never use `env_file` in PM2 ecosystem.config.js — PM2 v7 does not support it. Always put env vars directly in the `env` block. When changing env vars, use `pm2 delete` + `pm2 start` (not `pm2 restart`) to force PM2 to re-read the config.

#### Tags

pm2, env_file, environment-variables, telegram-bot, deployment, ecosystem-config

---
