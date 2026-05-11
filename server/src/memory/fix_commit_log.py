#!/usr/bin/env python3
"""Fix the corrupted commit-deploy-log.json file.

The file has:
1. A valid "commits" array (lines 1-370)
2. A valid "deploys" array (lines 371-638) that contains a misplaced commit object (lines 616-637)
3. A SECOND "deploys" key (lines 639-715) with duplicate entries

This script:
- Reads the file
- Parses the first "commits" array
- Parses the first "deploys" array, extracting the misplaced commit object
- Appends the extracted commit to the commits array
- Appends the deploy-auth-export-fix-001 record
- Writes the clean file
"""

import json
import os
import sys

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    filepath = os.path.join(base_dir, "commit-deploy-log.json")
    
    # The file is corrupted (truncated from previous partial write).
    # We'll build the complete file from scratch using the known good data.
    
    # Commits from the original valid portion (lines 2-370)
    commits = [
        {
            "id": "commit-group-chat-fixes-001",
            "commitSha": "group-chat-fixes-001",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "fix: group chat issues \u2014 markdown parsing, auth session sharing, message routing + worker crash resilience",
            "description": "Three group chat bugs fixed:\n\n1. Group chat /login markdown parsing error: Escaped @ as \\\\@ in inline keyboard message to prevent Telegram entity parser failure (\"Can't find end of the entity starting at byte offset 70\").\n\n2. Auth session not shared between private chat and group chat: Added fallback in checkAuthSession() that tries without chatId when exact match fails. Refactored handleTelegramSessionCheck() in auth.js to handle missing telegramChatId parameter \u2014 sorts sessions by recency when no chatId provided.\n\n3. Messages not routed through BullMQ from group chat: Added helpful \"No Active Project\" message instead of silently falling through to handleAsk. Group chat messages now show clear guidance to select a project.\n\nWorker crash resilience improvements:\n- Added dead-letter queue (DLQ) \u2014 failed jobs moved to superroo-jobs-dlq queue for inspection\n- Added job timeout (lockDuration: 600000ms) to prevent hanging jobs\n- Added auto-recovery \u2014 if worker is paused for >5 minutes, forces Redis disconnect/reconnect cycle\n- Added DLQ cleanup in graceful shutdown\n\nAlso updated /help text to include /specify example and changed section header from \"Projects\" to \"Projects & Workspace\".",
            "filesChanged": ["cloud/api/telegramBot.js", "cloud/api/auth.js", "cloud/worker/worker.js"],
            "featuresAffected": ["telegram-bot", "cloud-api", "auth", "worker", "group-chat"],
            "bugsFixed": [
                "Group chat /login markdown parsing error \u2014 'Can't find end of the entity'",
                "Auth session not shared between private chat and group chat",
                "Messages not routed through BullMQ from group chat \u2014 no active project prompt missing",
                "Worker has no crash resilience \u2014 no dead-letter queue, no job timeout, no auto-recovery"
            ],
            "timestamp": "2026-05-10T06:55:00.000Z"
        },
        {
            "id": "commit-worker-tg-notify-001",
            "commitSha": "efd066d8c",
            "agent": "Roo Code",
            "type": "feature",
            "title": "feat: add Telegram notifications to worker job lifecycle \u2014 only for Telegram-originated jobs",
            "description": "Added Telegram notification support to the BullMQ worker (worker.js) that sends job lifecycle events (completed/failed) to the Telegram bot via the /telegram/notify API endpoint.\n\nKey changes:\n- Added sendTelegramNotification() helper that POSTs to /telegram/notify with job status\n- Notifications are only sent when job.data.telegram.chatId exists (Telegram-originated jobs)\n- Added BOSS_TELEGRAM_CHAT_ID and API_BASE_URL env vars to ecosystem.config.js for the worker\n- Uses http/https.request (not fetch) for compatibility with older Node.js on VPS\n- Fire-and-forget pattern \u2014 doesn't block job processing\n\nThis ensures notifications are only sent when commands come through Telegram, not from VS Code or other sources.",
            "filesChanged": ["cloud/worker/worker.js", "cloud/ecosystem.config.js"],
            "featuresAffected": ["telegram-notifications", "worker", "cloud-api"],
            "bugsFixed": [],
            "timestamp": "2026-05-10T06:27:00.000Z"
        },
        {
            "id": "commit_mini_ide_fix_001",
            "commitSha": "mini-ide-fix-001",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "fix: Mini IDE crashing with MODULE_NOT_FOUND for express \u2014 missing package.json and node_modules",
            "description": "Root cause: The Mini IDE server at /opt/superroo2/cloud/mini-ide/server.js required express, cors, and multer npm packages, but the directory had no package.json and no node_modules/. Every PM2 restart attempt crashed immediately with 'Error: Cannot find module express'.\n\nFix: Created package.json with dependencies (express@^4.18.2, cors@^2.8.5, multer@^1.4.5-lts.1) and ran npm install --production (88 packages installed). Restarted superroo-mini-ide via PM2.\n\nVerification:\n- Mini IDE now online (PID 181455)\n- Error log is empty (no more MODULE_NOT_FOUND)\n- HTTP / returns 200 with HTML\n- /api/health returns 200\n- /api/workspace returns 401 (expected \u2014 requires auth)\n- CSS loads correctly\n- Nginx config valid, proxied at /tg/",
            "filesChanged": ["cloud/mini-ide/package.json"],
            "featuresAffected": ["mini-ide"],
            "bugsFixed": ["Mini IDE 'Something went wrong' error when opening from Telegram"],
            "timestamp": "2026-05-10T03:06:50.000Z"
        },
        {
            "id": "commit_project_sync_welcome_001",
            "commitSha": "project-sync-welcome-001",
            "agent": "Roo Code",
            "type": "feature",
            "title": "feat: add project sync API, welcome message after login, and projects.json data",
            "description": "Three features implemented:\n\n1. Project Sync API: Added POST /api/projects/sync and POST /api/projects/presence/sync endpoints to auth.js. handleProjectSync() syncs projects from VSCode/agents to the cloud, handleProjectPresenceSync() syncs real-time workspace presence (active file, current task, active agent).\n\n2. Welcome Message: After successful email OTP login, the bot now shows 'Welcome Boss JP \U0001f44b' with the latest workspace name, language, active file, and current task. Inline keyboard: '\u2705 Yes, open [project]', '\U0001f4c1 View all projects', '\u274c No, just browsing'. Added callback handlers for dismiss_welcome and projects.\n\n3. Projects Data: Created projects.json with 2 projects (superroo2, productgenerator) for user jpgyap@gmail.com. /projects command now shows workspaces.\n\nE2E test results: Project sync (200), Presence sync (200), Unauthorized rejected (401) \u2014 all passing.",
            "filesChanged": ["cloud/api/auth.js", "cloud/api/telegramBot.js", "cloud/data/auth/projects.json"],
            "featuresAffected": ["telegram-bot", "cloud-api", "auth", "project-sync"],
            "bugsFixed": ["/projects shows 'No Projects Found' because projects.json didn't exist"],
            "timestamp": "2026-05-10T02:46:00.000Z"
        },
        {
            "id": "commit_telegram_group_fix_001",
            "commitSha": "efd066d8c",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "fix: Telegram bot not responding in group chats + 404 login URL",
            "description": "Two bugs fixed:\n\n1. Telegram bot now responds in group chats: refactored bot.ts to factory pattern (createBot) with proper group chat support including bot_command entity detection, @mention detection, reply-to-bot detection, my_chat_member handling (bot added to group), and configurable authorization per chat type. Added 35 tests covering all scenarios.\n\n2. Login 404: Changed CLOUD_APP_LOGIN and related URLs from app.superroo.com/sign-in to clerk.superroo.com/sign-in since the Clerk auth pages are hosted at clerk.superroo.com, not app.superroo.com.",
            "filesChanged": ["src/telegram/bot.ts", "src/telegram/__tests__/bot.test.ts", "apps/web-superroo/src/lib/constants.ts", "cloud/api/telegramBot.js"],
            "featuresAffected": ["telegram-bot", "web-superroo", "cloud-api"],
            "bugsFixed": ["Telegram bot not responding in group chats", "404 error when logging in via Telegram"],
            "timestamp": "2026-05-09T15:36:25.000Z"
        },
        {
            "id": "commit_b927d78c1",
            "commitSha": "b927d78c1",
            "agent": "Roo Code",
            "type": "feature",
            "title": "feat: rewrite Docker tab with full Docker Control Center UI",
            "description": "",
            "filesChanged": ["cloud/dashboard/src/components/views/docker.tsx", "cloud/dashboard/src/app/page.tsx"],
            "featuresAffected": ["docker-tab", "dashboard"],
            "bugsFixed": [],
            "timestamp": "2026-05-07T17:02:00.000Z"
        },
        {
            "id": "commit_076d47f88",
            "commitSha": "076d47f88",
            "agent": "Roo Code",
            "type": "feature",
            "title": "feat: add Supabase, Vercel, and DigitalOcean VPS skills + update skill-generator UI",
            "description": "",
            "filesChanged": [".roo/skills/supabase/SKILL.md", ".roo/skills/vercel/SKILL.md", ".roo/skills/digitalocean-vps/SKILL.md", "cloud/dashboard/src/components/views/skill-generator.tsx"],
            "featuresAffected": ["skills", "skill-generator", "dashboard"],
            "bugsFixed": [],
            "timestamp": "2026-05-07T16:30:00.000Z"
        },
        {
            "id": "commit_01abfc32e",
            "commitSha": "01abfc32e",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "fix: resolve BUG-001 (memory leak), BUG-006 (Redis reconnect), BUG-008 (health check timeout) + clean up bugs.tsx",
            "description": "",
            "filesChanged": ["src/super-roo/healing/", "cloud/dashboard/src/components/views/bugs.tsx"],
            "featuresAffected": ["healing-system", "dashboard"],
            "bugsFixed": ["BUG-001", "BUG-006", "BUG-008"],
            "timestamp": "2026-05-07T16:00:00.000Z"
        },
        {
            "id": "commit_bea805352",
            "commitSha": "bea805352",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "fix: wire up BugsView in page.tsx and clean up bugs.tsx code quality",
            "description": "",
            "filesChanged": ["cloud/dashboard/src/app/page.tsx", "cloud/dashboard/src/components/views/bugs.tsx"],
            "featuresAffected": ["dashboard"],
            "bugsFixed": [],
            "timestamp": "2026-05-07T15:30:00.000Z"
        },
        {
            "id": "commit_ade822c97",
            "commitSha": "ade822c97",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "fix: add onClick handlers, toast notifications, remove dead priorityColors code",
            "description": "",
            "filesChanged": ["cloud/dashboard/src/components/views/bugs.tsx"],
            "featuresAffected": ["dashboard"],
            "bugsFixed": [],
            "timestamp": "2026-05-07T15:00:00.000Z"
        },
        {
            "id": "commit_02bc132a-71a1-4082-b712-35b7cb1de488",
            "commitSha": "1ff6829f1",
            "agent": "Roo Code",
            "type": "feature",
            "title": "Upgrade GitHub tab to Repository Operations Center with live data",
            "description": "Created shared types (packages/types/src/github.ts), backend service (src/super-roo/github/GitHubDashboardService.ts), frontend component (webview-ui/src/components/github/GitHubView.tsx), cloud dashboard view (cloud/dashboard/src/components/views/github.tsx), API endpoint (cloud/api/api.js), and comprehensive tests (12/12 passing).",
            "filesChanged": ["packages/types/src/github.ts", "packages/types/src/index.ts", "src/super-roo/github/index.ts", "src/super-roo/github/GitHubDashboardService.ts", "src/super-roo/github/__tests__/GitHubDashboardService.test.ts", "webview-ui/src/components/github/GitHubView.tsx", "webview-ui/src/App.tsx", "cloud/dashboard/src/components/views/github.tsx", "cloud/dashboard/src/app/page.tsx", "cloud/api/api.js"],
            "featuresAffected": ["github-tab", "dashboard", "commit-deploy-log", "webview-ui"],
            "bugsFixed": [],
            "timestamp": "2026-05-06T03:52:31.979Z"
        },
        {
            "id": "commit_68d54a05-1",
            "commitSha": "68d54a051",
            "agent": "Roo Code",
            "type": "feature",
            "title": "Add Working Tree tab, Working Tree Agent, and Commit & Deploy Log",
            "description": "",
            "filesChanged": ["cloud/dashboard/src/components/views/working-tree.tsx", "cloud/dashboard/src/components/sidebar.tsx", "cloud/dashboard/src/app/page.tsx", "src/super-roo/product-memory/agents/WorkingTreeAgent.ts", "src/super-roo/product-memory/__tests__/WorkingTreeAgent.test.ts", "src/super-roo/product-memory/CommitDeployLog.ts", "src/super-roo/product-memory/__tests__/CommitDeployLog.test.ts", "src/super-roo/product-memory/agents/index.ts", "src/super-roo/product-memory/index.ts", "src/super-roo/index.ts", "docs/resources/working-tree.md", "AGENTS.md"],
            "featuresAffected": ["working-tree", "commit-deploy-log", "dashboard", "product-memory", "agent-system"],
            "bugsFixed": [],
            "timestamp": "2025-05-05T22:26:25.000Z"
        },
        {
            "id": "commit_161b35c-1",
            "commitSha": "161b35cf3",
            "agent": "Roo Code",
            "type": "feature",
            "title": "Initialize CommitDeployLog with deploy 68d54a051",
            "description": "",
            "filesChanged": ["server/src/memory/commit-deploy-log.json"],
            "featuresAffected": ["commit-deploy-log"],
            "bugsFixed": [],
            "timestamp": "2025-05-05T22:18:55.000Z"
        },
        {
            "id": "commit_ccbf850c-1",
            "commitSha": "ccbf850c6",
            "agent": "Roo Code",
            "type": "chore",
            "title": "Update CommitDeployLog with commit 161b35cf3",
            "description": "",
            "filesChanged": ["server/src/memory/commit-deploy-log.json"],
            "featuresAffected": ["commit-deploy-log"],
            "bugsFixed": [],
            "timestamp": "2025-05-05T22:41:25.000Z"
        },
        {
            "id": "commit_settings_upgrade_001",
            "commitSha": "settings-upgrade-001",
            "agent": "Roo Code",
            "type": "feature",
            "title": "Add Settings & API Keys system \u2014 dashboard views, secret vault, provider testers, agent routing sync",
            "description": "",
            "filesChanged": ["cloud/dashboard/src/components/views/api-keys.tsx", "cloud/dashboard/src/components/views/settings.tsx", "cloud/dashboard/src/components/sidebar.tsx", "cloud/dashboard/src/app/page.tsx", "cloud/api/api.js", "cloud/config/providers.ts", "cloud/config/agent-routing.ts", "docs/resources/working-tree.md"],
            "featuresAffected": ["settings-api-keys", "dashboard", "api-server", "agent-routing", "secret-vault", "working-tree"],
            "bugsFixed": [],
            "timestamp": "2026-05-05T05:57:45.320Z"
        },
        {
            "id": "commit_61581624",
            "commitSha": "615816247b217e67d2adfd0974a12d9c5e1f9f50",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "fix: improve mobile responsiveness across cloud dashboard",
            "description": "Mobile compatibility fixes: agent table\u2192card layout on mobile, command strip scrollable, reduced grid columns, larger touch targets, PWA PNG icons, touch optimization CSS",
            "filesChanged": ["cloud/dashboard/public/manifest.json", "cloud/dashboard/src/app/globals.css", "cloud/dashboard/src/app/page.tsx", "cloud/dashboard/src/components/sidebar.tsx", "cloud/dashboard/src/components/views/overview.tsx", "cloud/dashboard/src/components/views/settings.tsx"],
            "featuresAffected": ["dashboard"],
            "bugsFixed": [],
            "timestamp": "2026-05-08T05:26:00.000Z"
        },
        {
            "id": "commit_email_otp_login_003",
            "commitSha": "email-otp-001",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "fix: replace broken Telegram Mini App login with Email OTP login flow",
            "description": "Replaced the broken Telegram Mini App login (which required telegramInitData validation that the Mini App couldn't provide) with a chat-based Email OTP login flow:\n\n1. handleLogin() now asks for email instead of showing Mini App button\n2. Added pendingEmailOtps Map for tracking email OTP states per chat\n3. Added handleEmailOtpLogin() - validates email, generates 6-digit OTP, stores for verification\n4. Added handleVerifyEmailOtp() - verifies OTP code, creates auth session via auth module\n5. Added /cancel command to abort login flow\n6. Added deleteMessage() helper for auto-deleting sensitive messages after login\n7. Modified auth.js handleTelegramLogin to accept '__email_otp_verified__' password marker for OTP-based login\n8. Messages with OTP codes are auto-deleted after successful verification",
            "filesChanged": ["cloud/api/telegramBot.js", "cloud/api/auth.js"],
            "featuresAffected": ["telegram-bot", "cloud-api", "auth"],
            "bugsFixed": ["Telegram Mini App login flow broken - login links to dashboard but asks to login again"],
            "timestamp": "2026-05-09T18:33:00.000Z"
        },
        {
            "sha": "email-otp-nodemailer-001",
            "agent": "Roo Code",
            "type": "feature",
            "title": "Fix email OTP sending - use nodemailer with Gmail SMTP",
            "description": "Updated handleEmailOtpLogin() to actually send OTP via email using nodemailer with Gmail SMTP credentials stored in environment variables. Added SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM to ecosystem config. Includes fallback to show OTP in chat if email sending fails.",
            "timestamp": "2026-05-09T18:47:00.000Z",
            "filesChanged": ["cloud/api/telegramBot.js", "cloud/ecosystem.config.js"],
            "featuresAffected": ["telegram-bot", "cloud-api"]
        },
        {
            "id": "commit_email_otp_smtp_fix_001",
            "commitSha": "email-otp-smtp-fix-001",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "fix: Email OTP login flow overwritten by deployment, SMTP credentials expired",
            "description": "Root cause: Two issues causing login failures:\n\n1. Email OTP flow was overwritten by deployment at 04:42:56 UTC \u2014 the patch_telegram_email_otp.py changes were lost. The old Mini App login flow pointed to https://dev.abcx124.xyz/telegram-miniapp which returns HTTP 404.\n\n2. SMTP app password 'odwd bykm cxym ziew' was revoked by Google (535-5.7.8 Username and Password not accepted).\n\nFixes:\n- Re-applied Email OTP flow to telegramBot.js: pendingEmailOtps Map, EMAIL_OTP_TTL_MS constant, deleteMessage helper, handleLogin() with Email OTP (asks for email instead of Mini App), handleEmailOtpLogin() (validates email, generates 6-digit OTP, sends via nodemailer/SMTP), handleVerifyEmailOtp() (verifies OTP, creates auth session via auth.handleTelegramLogin with __email_otp_verified__ password marker, auto-deletes sensitive messages), /cancel command, email OTP state detection in else block, deleteMessage in exports\n- Updated SMTP_PASS to new app password in ecosystem.config.js\n- Added SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_FROM env vars to ecosystem.config.js\n- Removed MINI_APP_URL dependency (no longer used)",
            "filesChanged": ["cloud/api/telegramBot.js", "cloud/ecosystem.config.js"],
            "featuresAffected": ["telegram-bot", "auth", "email-otp"],
            "bugsFixed": ["Login error: Missing credentials for PLAIN (SMTP)", "Login error: 535-5.7.8 Username and Password not accepted", "Login error: Mini App 404 endpoint", "Login error: auth.handleTelegramLogin is not a function"],
            "timestamp": "2026-05-10T05:03:00.000Z"
        },
        {
            "id": "commit-tg-agent-upgrade-001",
            "sha": "cf575707f",
            "agent": "Roo Code",
            "type": "feature",
            "title": "Telegram Agent upgrade - smarter AI with conversation context, ML learning, OTP fix",
            "filesChanged": ["cloud/api/auth.js", "cloud/api/telegramBot.js", "cloud/api/telegramLearner.js", "cloud/agents/telegram-agent/agent.json", "cloud/agents/telegram-agent/skills/conversation-flow.md", "cloud/agents/telegram-agent/skills/intent-analysis.md", "cloud/agents/telegram-agent/skills/code-context.md", "cloud/agents/telegram-agent/skills/telegram-response.md", "cloud/agents/telegram-agent/workflows/analyze-and-respond.md", "cloud/agents/telegram-agent/workflows/route-to-agent.md", "cloud/agents/telegram-agent/workflows/research-and-answer.md", "cloud/agents/telegram-agent/resources/superroo-architecture.md", "cloud/agents/telegram-agent/resources/project-context.md"],
            "featuresAffected": ["Telegram Bot Intelligence", "Email OTP Login", "ML-Powered Conversation Learning"],
            "bugsFixed": ["OTP login: auth.handleTelegramLogin rejects __email_otp_verified__ password marker"],
            "timestamp": "2026-05-10T05:39:00.000Z"
        },
        {
            "id": "commit-session-ttl-fix-001",
            "commitSha": "session-ttl-fix-001",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "Fix group chat session expiry \u2014 increase TTL to 24h and reorder session guard",
            "description": "Group chat was still asking for login because: (1) session TTL was only 30 minutes and had expired, (2) session guard ran AFTER group chat /ask conversion, blocking natural language messages. Fixed by increasing TELEGRAM_SESSION_TIMEOUT_MS to 24 hours and moving session guard before /ask conversion so natural language bypasses auth.",
            "filesChanged": ["cloud/api/auth.js", "cloud/api/telegramBot.js"],
            "featuresAffected": ["telegram-bot", "auth", "group-chat"],
            "bugsFixed": ["Group chat still asks for login after session expires", "Natural language messages in group chat blocked by session guard"],
            "timestamp": "2026-05-10T07:19:00.000Z"
        },
        {
            "id": "commit-auth-export-fix-001",
            "commitSha": "auth-export-fix-001",
            "agent": "Roo Code",
            "type": "bugfix",
            "title": "fix: export handleTelegramLogin from auth.js \u2014 OTP login fails with 'auth.handleTelegramLogin is not a function'",
            "description": "Root cause: The handleTelegramLogin function exists in auth.js at line 357 and is used internally at line 792 for the HTTP route handler, but it was NOT exported in module.exports at line 939. When telegramBot.js calls auth.handleTelegramLogin(), it gets undefined \u2192 'is not a function' error.\n\nFix: Added handleTelegramLogin to module.exports in auth.js.\n\nVPS log evidence:\n- 2026-05-10 07:22:19 [telegram] Email OTP login error: auth.handleTelegramLogin is not a function\n- The OTP code matching (code !== state.otp) was working correctly, but the subsequent auth.handleTelegramLogin() call failed because the function was not exported.",
            "filesChanged": ["cloud/api/auth.js"],
            "featuresAffected": ["auth", "telegram-bot", "email-otp-login"],
            "bugsFixed": ["Email OTP login fails with 'auth.handleTelegramLogin is not a function' \u2014 user enters correct OTP but gets 'Invalid Code \u274c'"],
            "timestamp": "2026-05-10T07:30:00.000Z"
        }
    ]
    
    # The misplaced commit object (commit-session-ttl-fix-001) is inside the first deploys array
    # We need to extract it from the raw content
    # Let's find it by looking for the commit object inside deploys
    
    # The commit object we need to extract has id "commit-session-ttl-fix-001"
    # It's currently inside the first deploys array
    
    # From the raw content, let's find all deploy records
    # The first deploys array has these IDs (in order):
    # deploy-group-chat-fixes-001, deploy-worker-tg-notify-001, deploy-1746850000000,
    # deploy-1746637200000, deploy-1778053951979, deploy-1778047445745,
    # deploy-1746469585000, deploy-1746689200000, deploy-1746808400000,
    # deploy-1746808400001, deploy-1746810000001, deploy-1746859800000,
    # deploy-tg-agent-upgrade-001, deploy-worker-tg-notify-001 (dup),
    # deploy-group-chat-fixes-001 (dup), commit-session-ttl-fix-001 (misplaced commit)
    
    # The second deploys array has:
    # deploy-group-chat-fixes-001 (dup), deploy-session-ttl-fix-001,
    # deploy-session-ttl-fix-001 (dup), deploy-auth-export-fix-001
    
    # Build the correct deploys list (unique, chronological)
    correct_deploys = [
        {
            "id": "deploy-1746469585000",
            "version": "1.0.0",
            "commitSha": "ccbf850c6",
            "agent": "Roo Code",
            "status": "failed",
            "environment": "production",
            "commitsIncluded": ["ccbf850c6"],
            "featuresDeployed": ["commit-deploy-log"],
            "healthCheckPassed": None,
            "healthCheckLatencyMs": None,
            "startedAt": "2025-05-05T22:26:25.000Z",
            "completedAt": "2026-05-09T12:37:00.000Z",
            "failureReason": "Deploy pipeline was interrupted before completion — status was stuck as 'building' for over 1 year. Marked as failed by deployer agent upgrade."
        },
        {
            "id": "deploy-1778047445745",
            "version": "1.1.0",
            "commitSha": "settings-upgrade-001",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["settings-upgrade-001"],
            "featuresDeployed": ["settings-api-keys", "dashboard", "api-server", "agent-routing", "secret-vault", "working-tree"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 250,
            "startedAt": "2026-05-05T05:57:45.745Z",
            "completedAt": "2026-05-05T05:58:05.745Z"
        },
        {
            "id": "deploy-1778053951979",
            "version": "1.2.0",
            "commitSha": "1ff6829f1",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["1ff6829f1"],
            "featuresDeployed": ["github-tab", "dashboard", "commit-deploy-log", "webview-ui"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 300,
            "startedAt": "2026-05-06T03:52:31.979Z",
            "completedAt": "2026-05-06T03:52:36.979Z"
        },
        {
            "id": "deploy-1746637200000",
            "version": "1.3.0",
            "commitSha": "b927d78c1",
            "agent": "Roo Code (deployer)",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["b927d78c1", "076d47f88", "01abfc32e", "bea805352", "ade822c97"],
            "featuresDeployed": ["docker-tab", "skills", "skill-generator", "healing-system", "dashboard"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 250,
            "startedAt": "2026-05-07T17:02:00.000Z",
            "completedAt": "2026-05-07T17:03:48.000Z"
        },
        {
            "id": "deploy-1746689200000",
            "version": "1.4.0",
            "commitSha": "615816247b217e67d2adfd0974a12d9c5e1f9f50",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["615816247b217e67d2adfd0974a12d9c5e1f9f50"],
            "featuresDeployed": ["dashboard"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 250,
            "startedAt": "2026-05-08T05:26:40.000Z",
            "completedAt": "2026-05-08T05:31:40.000Z"
        },
        {
            "id": "deploy-1746808400000",
            "version": "1.5.0",
            "commitSha": "efd066d8c",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["efd066d8c", "47bb58511"],
            "featuresDeployed": ["telegram-bot", "cloud-api"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 250,
            "startedAt": "2026-05-09T16:30:00.000Z",
            "completedAt": "2026-05-09T16:36:15.000Z"
        },
        {
            "id": "deploy-1746808400001",
            "version": "1.6.0",
            "commitSha": "email-otp-001",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["email-otp-001"],
            "featuresDeployed": ["telegram-bot", "cloud-api", "auth"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 250,
            "startedAt": "2026-05-09T18:33:00.000Z",
            "completedAt": "2026-05-09T18:33:25.000Z"
        },
        {
            "id": "deploy-1746810000001",
            "version": "1.6.1",
            "commitSha": "email-otp-nodemailer-001",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["email-otp-nodemailer-001"],
            "featuresDeployed": ["telegram-bot", "cloud-api", "auth"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 250,
            "startedAt": "2026-05-09T18:47:00.000Z",
            "completedAt": "2026-05-09T18:48:10.000Z"
        },
        {
            "id": "deploy-1746850000000",
            "version": "1.7.1",
            "commitSha": "mini-ide-fix-001",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["mini-ide-fix-001"],
            "featuresDeployed": ["mini-ide"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 250,
            "startedAt": "2026-05-10T03:06:50.000Z",
            "completedAt": "2026-05-10T03:06:52.000Z"
        },
        {
            "id": "deploy-1746859800000",
            "version": "1.7.2",
            "commitSha": "email-otp-smtp-fix-001",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["email-otp-smtp-fix-001"],
            "featuresDeployed": ["telegram-bot", "cloud-api", "auth", "email-otp"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 250,
            "startedAt": "2026-05-10T05:03:00.000Z",
            "completedAt": "2026-05-10T05:04:30.000Z"
        },
        {
            "id": "deploy-tg-agent-upgrade-001",
            "version": "1.8.0",
            "commitSha": "cf575707f",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["cf575707f"],
            "featuresDeployed": ["Telegram Bot Intelligence Upgrade", "ML-Powered Conversation Learning", "Email OTP Login Fix"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 300,
            "startedAt": "2026-05-10T05:38:00.000Z",
            "completedAt": "2026-05-10T05:38:56.000Z"
        },
        {
            "id": "deploy-worker-tg-notify-001",
            "version": "1.9.0",
            "commitSha": "efd066d8c",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["efd066d8c"],
            "featuresDeployed": ["telegram-notifications", "worker", "cloud-api"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 250,
            "startedAt": "2026-05-10T06:27:44.000Z",
            "completedAt": "2026-05-10T06:27:55.000Z"
        },
        {
            "id": "deploy-group-chat-fixes-001",
            "version": "1.10.0",
            "commitSha": "group-chat-fixes-001",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["group-chat-fixes-001"],
            "featuresDeployed": ["telegram-bot", "cloud-api", "auth", "worker", "group-chat", "worker-crash-resilience"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 250,
            "startedAt": "2026-05-10T06:55:00.000Z",
            "completedAt": "2026-05-10T06:56:00.000Z"
        },
        {
            "id": "deploy-session-ttl-fix-001",
            "version": "1.11.0",
            "commitSha": "session-ttl-fix-001",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["session-ttl-fix-001"],
            "featuresDeployed": ["telegram-bot", "auth", "group-chat"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 200,
            "startedAt": "2026-05-10T07:19:00.000Z",
            "completedAt": "2026-05-10T07:19:30.000Z"
        },
        {
            "id": "deploy-auth-export-fix-001",
            "version": "1.12.0",
            "commitSha": "auth-export-fix-001",
            "agent": "Roo Code",
            "status": "healthy",
            "environment": "production",
            "commitsIncluded": ["auth-export-fix-001"],
            "featuresDeployed": ["auth", "telegram-bot", "email-otp-login"],
            "healthCheckPassed": True,
            "healthCheckLatencyMs": 180,
            "startedAt": "2026-05-10T07:30:00.000Z",
            "completedAt": "2026-05-10T07:30:45.000Z"
        }
    ]
    
    # The misplaced commit object (commit-session-ttl-fix-001) needs to be added to commits
    # Check if it's already there
    session_ttl_commit = {
        "id": "commit-session-ttl-fix-001",
        "commitSha": "session-ttl-fix-001",
        "agent": "Roo Code",
        "type": "bugfix",
        "title": "Fix group chat session expiry — increase TTL to 24h and reorder session guard",
        "description": "Group chat was still asking for login because: (1) session TTL was only 30 minutes and had expired, (2) session guard ran AFTER group chat /ask conversion, blocking natural language messages. Fixed by increasing TELEGRAM_SESSION_TIMEOUT_MS to 24 hours and moving session guard before /ask conversion so natural language bypasses auth.",
        "filesChanged": ["cloud/api/auth.js", "cloud/api/telegramBot.js"],
        "featuresAffected": ["telegram-bot", "auth", "group-chat"],
        "bugsFixed": ["Group chat still asks for login after session expires", "Natural language messages in group chat blocked by session guard"],
        "timestamp": "2026-05-10T07:19:00.000Z"
    }
    
    auth_export_commit = {
        "id": "commit-auth-export-fix-001",
        "commitSha": "auth-export-fix-001",
        "agent": "Roo Code",
        "type": "bugfix",
        "title": "fix: export handleTelegramLogin from auth.js — OTP login fails with 'auth.handleTelegramLogin is not a function'",
        "description": "Root cause: The handleTelegramLogin function exists in auth.js at line 357 and is used internally at line 792 for the HTTP route handler, but it was NOT exported in module.exports at line 939. When telegramBot.js calls auth.handleTelegramLogin(), it gets undefined → 'is not a function' error.\n\nFix: Added handleTelegramLogin to module.exports in auth.js.\n\nVPS log evidence:\n- 2026-05-10 07:22:19 [telegram] Email OTP login error: auth.handleTelegramLogin is not a function\n- The OTP code matching (code !== state.otp) was working correctly, but the subsequent auth.handleTelegramLogin() call failed because the function was not exported.",
        "filesChanged": ["cloud/api/auth.js"],
        "featuresAffected": ["auth", "telegram-bot", "email-otp-login"],
        "bugsFixed": ["Email OTP login fails with 'auth.handleTelegramLogin is not a function' — user enters correct OTP but gets 'Invalid Code ❌'"],
        "timestamp": "2026-05-10T07:30:00.000Z"
    }
    
    # Check if session-ttl-fix commit is already in commits
    existing_ids = {c.get("id") for c in commits}
    if "commit-session-ttl-fix-001" not in existing_ids:
        commits.append(session_ttl_commit)
    if "commit-auth-export-fix-001" not in existing_ids:
        commits.append(auth_export_commit)
    
    # Build the final data
    result = {
        "commits": commits,
        "deploys": correct_deploys
    }
    
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(result, f, indent="\t", ensure_ascii=False)
        f.write("\n")
    
    print(f"Fixed {filepath}")
    print(f"  Commits: {len(result['commits'])}")
    print(f"  Deploys: {len(result['deploys'])}")

if __name__ == "__main__":
    main()
