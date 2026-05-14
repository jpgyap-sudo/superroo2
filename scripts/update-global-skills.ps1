$skills = @{
    'auto-deployer' = @{ modeSlugs = @('code','debug'); desc = 'Auto-Deployer Bot - Self-retrying SSH deploy agent that kills stuck processes, auto-deploys when traffic is high, and keeps retrying until deployment succeeds' }
    'autonomous' = @{ modeSlugs = @('code','debug'); desc = 'Autonomous Mode - Self-directed coding, debugging, testing, committing, deploying, and 10-step autonomous improvement loop using Tailscale SSH' }
    'debug-team' = @{ modeSlugs = @('debug','code'); desc = 'Super Debug Team - Autonomous multi-agent debugging system that solves complex feature problems through phase-by-phase breakdown, hypothesis-driven iteration, safe container execution, automatic rollback, and skill generation' }
    'deployer' = @{ modeSlugs = @('code'); desc = 'Automates project deployment preparation and execution while requesting required deployment details, secrets, and explicit user authorization before external or production changes' }
    'digitalocean-vps' = @{ modeSlugs = @('code','debug'); desc = 'DigitalOcean VPS - Deploy, manage, and maintain applications on DigitalOcean Droplets (VPS)' }
    'docker-upgrade' = @{ modeSlugs = @('code','debug'); desc = 'Docker Upgrade - Upgrade Docker and Docker Compose on remote servers via SSH' }
    'e2e-test' = @{ modeSlugs = @('code','debug'); desc = 'Run comprehensive end-to-end tests across the full stack to verify system health. When tests fail, perform systematic root-cause analysis and fix the entire system' }
    'google-cloud-api' = @{ modeSlugs = @('code','architect'); desc = 'Google Cloud API - Integrate Google Cloud services (GCP APIs, auth, storage, AI/ML, databases, serverless) into apps' }
    'ide-vscode-parity' = @{ modeSlugs = @('code','architect'); desc = 'Close feature gaps between the Cloud IDE Terminal and VS Code webview. Use when adding Monaco Editor, IntelliSense, error diagnostics, auto-fix, multi-cursor, breadcrumbs, minimap, settings UI, or extensions panel' }
    'n8n' = @{ modeSlugs = @('code','architect'); desc = 'n8n - Integrate n8n workflow automation (triggers, nodes, webhooks, AI agents, Telegram, Supabase, VPS deployment) into apps' }
    'pgvector-rag' = @{ modeSlugs = @('code','architect'); desc = 'PostgreSQL + pgvector + RAG - Integrate vector search, embeddings, and Retrieval-Augmented Generation into apps using PostgreSQL with the pgvector extension' }
    'phase-breakdown' = @{ modeSlugs = @('architect','code','debug'); desc = 'Break down complex problems into clear, sequential phases to find systematic solutions. Use when a problem is too large to solve in one step or requires multi-domain coordination' }
    'project-artifact-generator' = @{ modeSlugs = @('architect','code'); desc = 'Generates project agents, resources, rules, skills, and required Markdown documentation from repository signals, ML/neural coding patterns, and user goals' }
    'roo-conflict-resolution' = @{ modeSlugs = @('code','debug'); desc = 'Provides comprehensive guidelines for resolving merge conflicts intelligently using git history and commit context' }
    'roo-translation' = @{ modeSlugs = @('translate','code'); desc = 'Provides comprehensive guidelines for translating and localizing application strings. Use when tasks involve i18n, translation, localization, adding new languages, or updating existing translation files' }
    'supabase' = @{ modeSlugs = @('code','architect'); desc = 'Supabase - Integrate Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions) into apps' }
    'tailscale' = @{ modeSlugs = @('code','debug'); desc = 'Tailscale - Manage Tailscale SSH connections, deploy via Tailscale IP, and maintain Tailscale mesh network for VPS infrastructure' }
    'telegram-integration' = @{ modeSlugs = @('code','architect'); desc = 'Telegram Bot - Integrate, manage, and troubleshoot Telegram bots with ML-powered conversation learning, notification agent, group chat support, and agent routing' }
    'ui-builder' = @{ modeSlugs = @('code','architect'); desc = 'UI Builder - Build, extend, and wire dashboard views, Telegram UI, and website pages with full-stack integration. Ensures every new feature is properly wired (sidebar to page.tsx to API endpoint to WebSocket)' }
    'vercel' = @{ modeSlugs = @('code','architect'); desc = 'Vercel - Deploy and integrate Vercel (Next.js, Edge Functions, Serverless, Analytics, ISR) into apps' }
    'visual-crawler-e2e' = @{ modeSlugs = @('code','debug'); desc = 'Automated visual regression testing using Playwright screenshots + Ollama Vision analysis + agent-driven bug fixing' }
    'workspace-domain-guard' = @{ modeSlugs = @('code','architect','debug'); desc = 'Detect likely wrong-workspace or wrong-project requests before editing code. Use when the user asks to add or modify features whose domain may not match the current repository' }
    'commissioning-agent' = @{ modeSlugs = @('code','architect'); desc = 'Commissioning Agent - Automated project commissioning and setup agent that bootstraps new projects with proper structure, configuration, and dependencies' }
    'terminal-brain-upgrade' = @{ modeSlugs = @('code','debug'); desc = 'Terminal Brain Upgrade - Upgrade the terminal agent with enhanced context awareness, command planning, safe execution, error analysis, and terminal memory' }
}

$basePath = "C:\Users\User\.roo\skills"
foreach ($name in $skills.Keys) {
    $info = $skills[$name]
    $filePath = Join-Path $basePath "$name\SKILL.md"
    if (Test-Path $filePath) {
        $content = Get-Content $filePath -Raw
        $modeLines = ($info.modeSlugs | ForEach-Object { "  - $_" }) -join "`n"
        $newFrontmatter = "---`nname: $name`ndescription: $($info.desc)`nmodeSlugs:`n$modeLines`n---"
        $updated = $content -replace '(?s)^---.*?---', $newFrontmatter
        Set-Content -Path $filePath -Value $updated -NoNewline
        Write-Output "Updated: $name"
    } else {
        Write-Output "NOT FOUND: $name"
    }
}
