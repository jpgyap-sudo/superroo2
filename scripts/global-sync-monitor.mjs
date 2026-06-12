#!/usr/bin/env node
import { watch, existsSync, mkdirSync, readFileSync, createWriteStream } from 'fs';
import { spawnSync } from 'child_process';

// Configuration
const CONFIG = {
  watchPaths: [
    'C:/Users/user/.superroo/memory/lessons-learned.md',
    'C:/Users/user/.superroo/memory/lesson-index.jsonl',
    'C:/Users/user/.superroo/tasks/global-tasks.json',
    'C:/Users/user/.superroo/skills/',
    'C:/Users/user/.superroo/resources/'
  ],
  logFile: 'C:/Users/user/.superroo/memory/monitor-log.jsonl',
  defaultInterval: 15,
  debounceDelay: 500,
}

let debounceTimeout = null
let lastScanTime = 0
let isRunning = false
const ROOT = process.cwd()

// Ensure log directory exists
const logDir = CONFIG.logFile.substring(0, CONFIG.logFile.lastIndexOf('/'))
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true })
}

// Log action to JSONL file
function logAction(action, details = {}) {
  const logEntry = { timestamp: new Date().toISOString(), action, ...details }
  const logStream = createWriteStream(CONFIG.logFile, { flags: 'a' })
  logStream.write(JSON.stringify(logEntry) + '\n')
  logStream.end()
}

// Run a command and return output
function runCommand(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true
  })
  if (result.status !== 0) {
    return { success: false, error: result.stderr?.slice(0, 200) || 'exit code ' + result.status, output: '' }
  }
  return { success: true, output: result.stdout?.trim() || '' }
}

// Run audit using global-sync-engine.mjs
function runAudit() {
  logAction('audit_start')
  const result = runCommand('scripts/global-sync-engine.mjs', ['--json'])
  
  if (!result.success) {
    logAction('audit_error', { error: result.error })
    return null
  }
  
  try {
    const auditResult = JSON.parse(result.output)
    logAction('audit_complete', { gapsFound: auditResult.summary?.totalGaps || 0 })
    return auditResult
  } catch (e) {
    logAction('audit_parse_error', { error: e.message })
    return null
  }
}

// Execute fixes using global-sync-executor.mjs
function executeFixes(dryRun = false) {
  const args = dryRun ? ['--dry-run'] : ['--force']
  const result = runCommand('scripts/global-sync-executor.mjs', args)
  
  if (!result.success) {
    logAction('fix_error', { error: result.error })
    return { fixed: 0, skipped: 0, error: result.error }
  }
  
  logAction('fix_complete', { success: true, dryRun })
  return { fixed: 1, skipped: 0 }
}

// Generate status summary
function generateStatusSummary(stats) {
  return `Sync monitor: ${stats.fixed || 0} fixes applied, ${stats.skipped || 0} skipped.`
}

// Handle file change event with debounce
function handleFileChange() {
  clearTimeout(debounceTimeout)
  debounceTimeout = setTimeout(() => {
    if (isRunning) return
    isRunning = true
    try {
      logAction('file_change_detected')
      const auditResult = runAudit()
      if (auditResult) {
        const stats = executeFixes(false)
        const summary = generateStatusSummary(stats)
        logAction('status_summary', { summary })
        console.log(`[Global Sync Monitor] ${summary}`)
      }
    } finally {
      isRunning = false
      lastScanTime = Date.now()
    }
  }, CONFIG.debounceDelay)
}

// Start watching files and directories
function startWatcher() {
  console.log('[Global Sync Monitor] Starting file watcher...')
  
  for (const watchPath of CONFIG.watchPaths) {
    try {
      const checkPath = watchPath.replace(/\/$/, '')
      if (watchPath.endsWith('/')) {
        watch(checkPath, { recursive: true }, (eventType, filename) => {
          if (filename) {
            console.log(`[Global Sync Monitor] Detected ${eventType} on ${checkPath}/${filename}`)
            handleFileChange()
          }
        })
      } else {
        watch(checkPath, () => {
          console.log(`[Global Sync Monitor] Detected change on ${checkPath}`)
          handleFileChange()
        })
      }
      console.log(`[Global Sync Monitor] Watching: ${watchPath}`)
    } catch (error) {
      console.error(`[Global Sync Monitor] Failed to watch ${watchPath}:`, error.message)
      logAction('watch_error', { path: watchPath, error: error.message })
    }
  }
  
  setInterval(() => {
    const now = Date.now()
    if (now - lastScanTime > CONFIG.defaultInterval * 60 * 1000) {
      if (!isRunning) {
        logAction('periodic_scan_triggered')
        handleFileChange()
      }
    }
  }, 60000)
}

// Graceful shutdown
function shutdown() {
  console.log('[Global Sync Monitor] Shutting down...')
  clearTimeout(debounceTimeout)
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Main execution
function main() {
  const args = process.argv.slice(2)
  
  const flags = {
    once: args.includes('--once'),
    dryRun: args.includes('--dry-run'),
    status: args.includes('--status'),
  }
  
  if (flags.status) {
    let lastAction = 'none'
    try {
      const content = readFileSync(CONFIG.logFile, 'utf8')
      const lines = content.trim().split('\n')
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1])
        lastAction = `${last.action} at ${last.timestamp}`
      }
    } catch {}
    console.log('[Global Sync Monitor] Status: Active')
    console.log(`  Last action: ${lastAction}`)
    console.log(`  Log file: ${CONFIG.logFile}`)
    return
  }
  
  if (flags.once) {
    logAction('manual_trigger_once')
    const auditResult = runAudit()
    if (auditResult) {
      const stats = executeFixes(flags.dryRun)
      const summary = generateStatusSummary(stats)
      logAction('status_summary', { summary })
      console.log(`[Global Sync Monitor] ${summary}`)
    }
    return
  }
  
  logAction('monitor_started', { interval: CONFIG.defaultInterval, dryRun: flags.dryRun })
  startWatcher()
  handleFileChange()
  console.log('[Global Sync Monitor] Monitoring started. Press Ctrl+C to stop.')
}

// Run if not imported as module
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}