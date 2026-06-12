#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const repoRoot = path.resolve(import.meta.dirname, "..")
const home = os.homedir()
const codexHome = process.env.CODEX_HOME || path.join(home, ".codex")
const superrooHome = process.env.SUPERROO_HOME || path.join(home, ".superroo")

const paths = {
	codexConfig: path.join(codexHome, "config.toml"),
	codexAgents: path.join(codexHome, "AGENTS.md"),
	codexSkillDir: path.join(codexHome, "skills", "codex-brain"),
	kiloMcp: path.join(home, ".kilo", "mcp.json"),
	superrooBin: path.join(superrooHome, "bin"),
	superrooResources: path.join(superrooHome, "resources"),
	superrooWorkflows: path.join(superrooHome, "workflows"),
	superrooMcp: path.join(superrooHome, "mcp"),
}

const codexBrainCli = path.join(repoRoot, "scripts", "codex-brain.mjs")
const codexBrainMcp = path.join(repoRoot, "scripts", "codex-brain-mcp.mjs")
const centralBrainMcp = path.join(repoRoot, "scripts", "central-brain-mcp.mjs")
const syncLocalLessons = path.join(repoRoot, "scripts", "sync-local-extension-lessons.mjs")
const guardLessons = path.join(repoRoot, "scripts", "guard-append-only-lessons.mjs")
const syncCentralBrain = path.join(repoRoot, "scripts", "sync-lessons-to-central-brain.mjs")
const trainCentralMl = path.join(repoRoot, "scripts", "train-central-ml.mjs")
const syncMlToVps = path.join(repoRoot, "scripts", "sync-ml-to-vps.mjs")
const syncMlFull = path.join(repoRoot, "scripts", "sync-ml-full.mjs")
const syncAllBrains = path.join(repoRoot, "scripts", "sync-all-brains.mjs")
const findLessonGaps = path.join(repoRoot, "scripts", "find-lesson-gaps.mjs")
const summarizeLessons = path.join(repoRoot, "scripts", "ollama-summarize-lesson.mjs")
const pullVpsLessons = path.join(repoRoot, "scripts", "pull-vps-lessons.mjs")
const learningLayerAgent = path.join(repoRoot, "scripts", "learning-layer-agent.mjs")
const extensionIndexingAgent = path.join(repoRoot, "scripts", "extension-indexing-agent.mjs")
const superrooLearnSource = path.join(repoRoot, "tools", "superroo-learn.mjs")
const globalPostCommitSource = path.join(repoRoot, "tools", "global-post-commit.mjs")
const repoLessonIndex = path.join(repoRoot, "memory", "lesson-index.jsonl")
const repoLessonsMd = path.join(repoRoot, "memory", "lessons-learned.md")
const globalLessonIndex = path.join(superrooHome, "memory", "lesson-index.jsonl")
const globalLessonsMd = path.join(superrooHome, "memory", "lessons-learned.md")
const globalCodexBrainDir = path.join(superrooHome, "memory", "codex-brain")
const globalClaudeBrainDir = path.join(superrooHome, "memory", "claude-brain")
const globalBrainMcpDir = path.join(superrooHome, "memory", "brain-mcp")
const globalRiskDir = path.join(superrooHome, "memory", "predictive-risk")
const globalHookDir = path.join(superrooHome, "git-hooks")

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true })
}

function writeFile(file, content) {
	ensureDir(path.dirname(file))
	fs.writeFileSync(file, content, "utf8")
}

function toTomlPath(file) {
	return file.replaceAll("\\", "\\\\")
}

function managedBlock(name, content) {
	return `# >>> ${name} managed by superroo global Codex Brain installer\n${content.trimEnd()}\n# <<< ${name} managed by superroo global Codex Brain installer\n`
}

function upsertManagedBlock(file, name, content, prefix = "") {
	const block = managedBlock(name, content)
	const start = `# >>> ${name} managed by superroo global Codex Brain installer`
	const end = `# <<< ${name} managed by superroo global Codex Brain installer`
	const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : prefix
	const startIndex = previous.indexOf(start)
	const endIndex = previous.indexOf(end)
	if (startIndex >= 0 && endIndex >= startIndex) {
		const after = endIndex + end.length
		writeFile(file, `${previous.slice(0, startIndex)}${block}${previous.slice(after).replace(/^\r?\n/, "")}`)
		return
	}
	const separator = previous.trim().length > 0 && !previous.endsWith("\n") ? "\n\n" : previous.trim().length > 0 ? "\n" : ""
	writeFile(file, `${previous}${separator}${block}`)
}

function removeUnmanagedTomlTable(content, tableName, managedName) {
	const managedStart = `# >>> ${managedName} managed by superroo global Codex Brain installer`
	const lines = content.split(/\r?\n/)
	const output = []
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i]
		if (line.trim() !== `[${tableName}]`) {
			output.push(line)
			continue
		}

		const previousText = output.join("\n")
		if (previousText.includes(managedStart)) {
			output.push(line)
			continue
		}

		i += 1
		while (i < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[i])) {
			i += 1
		}
		i -= 1
	}
	return output.join("\n").replace(/\n{3,}/g, "\n\n")
}

function createCmdWrapper(file, target, extraArgs = []) {
	const args = extraArgs.join(" ")
	writeFile(
		file,
		`@echo off\r\nset "SUPERROO_HOME=${superrooHome}"\r\nset "SUPERROO_MEMORY_DIR=${path.join(superrooHome, "memory")}"\r\nset "MEMORY_DIR=${path.join(superrooHome, "memory")}"\r\nset "CODEX_BRAIN_MEMORY_DIR=${globalCodexBrainDir}"\r\nset "SUPERROO_RISK_DIR=${globalRiskDir}"\r\nnode "${target}" ${args} %*\r\n`,
	)
}

function createShWrapper(file, target, extraArgs = []) {
	const args = extraArgs.map((arg) => `"${arg}"`).join(" ")
	writeFile(
		file,
		`#!/usr/bin/env sh\nexport SUPERROO_HOME="${superrooHome}"\nexport SUPERROO_MEMORY_DIR="${path.join(superrooHome, "memory")}"\nexport MEMORY_DIR="${path.join(superrooHome, "memory")}"\nexport CODEX_BRAIN_MEMORY_DIR="${globalCodexBrainDir}"\nexport SUPERROO_RISK_DIR="${globalRiskDir}"\nexec node "${target}" ${args} "$@"\n`,
	)
}

function installWrappers() {
	ensureDir(paths.superrooBin)
	const wrappers = [
		["superroo-codex-brain", codexBrainCli, []],
		["superroo-codex-brain-mcp", codexBrainMcp, []],
		["superroo-central-brain-mcp", centralBrainMcp, []],
		["superroo-lessons-sync-local", syncLocalLessons, []],
		["superroo-lessons-guard", guardLessons, []],
		["superroo-lessons-sync-central", syncCentralBrain, []],
		["superroo-ml-train", trainCentralMl, []],
		["superroo-ml-sync-vps", syncMlToVps, []],
		["superroo-ml-sync-full", syncMlFull, []],
		["superroo-sync-all-brains", syncAllBrains, []],
		["superroo-lesson-gaps", findLessonGaps, []],
		["superroo-lesson-summarize", summarizeLessons, []],
		["superroo-lessons-pull-vps", pullVpsLessons, []],
		["superroo-learning-agent", learningLayerAgent, []],
		["superroo-learning-audit", learningLayerAgent, ["auditor"]],
		["superroo-learning-doctor", learningLayerAgent, ["doctor"]],
		["superroo-indexing-agent", extensionIndexingAgent, []],
		["superroo-indexing-status", extensionIndexingAgent, ["--status"]],
		["superroo-indexing-sync", extensionIndexingAgent, ["--sync"]],
		["superroo-learn", superrooLearnSource, []],
		["superroo-codex-retrieve", codexBrainCli, ["retrieve"]],
		["superroo-codex-collect", codexBrainCli, ["collect"]],
		["superroo-codex-code", codexBrainCli, ["code-with-memory"]],
		["superroo-codex-recall", codexBrainCli, ["recall"]],
		["superroo-codex-remember", codexBrainCli, ["remember"]],
		["superroo-risk-assess", codexBrainCli, ["risk-assess"]],
		["superroo-risk-stats", codexBrainCli, ["risk-stats"]],
	]

	for (const [name, target, args] of wrappers) {
		createCmdWrapper(path.join(paths.superrooBin, `${name}.cmd`), target, args)
		createShWrapper(path.join(paths.superrooBin, name), target, args)
		const stalePsWrapper = path.join(paths.superrooBin, `${name}.ps1`)
		if (fs.existsSync(stalePsWrapper)) fs.unlinkSync(stalePsWrapper)
	}
}

function installCodexConfig() {
	const managedName = "superroo-codex-brain-global-config"
	if (fs.existsSync(paths.codexConfig)) {
		const cleaned = removeUnmanagedTomlTable(fs.readFileSync(paths.codexConfig, "utf8"), "superroo", managedName)
		writeFile(paths.codexConfig, cleaned)
	}
	const content = `
[superroo]
default_brain = "codex-brain"
global_workflow = "codex_brain_retrieves_collects_ollama_agents_draft_codex_reviews_remembers"
append_only_lessons = true
repo_root = "${toTomlPath(repoRoot)}"
codex_brain_cli = "node ${toTomlPath(codexBrainCli)}"
codex_brain_mcp = "node ${toTomlPath(codexBrainMcp)}"
central_brain_mcp = "node ${toTomlPath(centralBrainMcp)}"
sync_local_lessons = "node ${toTomlPath(syncLocalLessons)}"
guard_append_only_lessons = "node ${toTomlPath(guardLessons)}"
sync_central_brain = "node ${toTomlPath(syncCentralBrain)}"
train_central_ml = "node ${toTomlPath(trainCentralMl)}"
sync_ml_to_vps = "node ${toTomlPath(syncMlToVps)}"
sync_ml_full = "node ${toTomlPath(syncMlFull)}"
global_bin = "${toTomlPath(paths.superrooBin)}"
global_resources = "${toTomlPath(paths.superrooResources)}"
global_workflows = "${toTomlPath(paths.superrooWorkflows)}"
global_memory = "${toTomlPath(path.join(superrooHome, "memory"))}"
global_models = "${toTomlPath(path.join(superrooHome, "models"))}"
codex_brain_memory_dir = "${toTomlPath(globalCodexBrainDir)}"
predictive_risk_dir = "${toTomlPath(globalRiskDir)}"
claude_brain_memory_dir = "${toTomlPath(globalClaudeBrainDir)}"
global_hook_dir = "${toTomlPath(globalHookDir)}"

[mcp_servers.codex-brain]
command = "node"
args = ["${toTomlPath(codexBrainMcp)}"]
env = { OLLAMA_HOST = "http://127.0.0.1:11434", SUPERROO_HOME = "${toTomlPath(superrooHome)}", SUPERROO_MEMORY_DIR = "${toTomlPath(path.join(superrooHome, "memory"))}", CODEX_BRAIN_MEMORY_DIR = "${toTomlPath(globalCodexBrainDir)}", SUPERROO_RISK_DIR = "${toTomlPath(globalRiskDir)}", CODEX_BRAIN_HERMES_MODEL = "hermes3", CODEX_BRAIN_EMBED_MODEL = "nomic-embed-text", CODEX_BRAIN_FAST_CODER_MODEL = "qwen2.5-coder:7b", CODEX_BRAIN_PRO_CODER_MODEL = "qwen3:14b" }

[mcp_servers.central-brain]
command = "node"
args = ["${toTomlPath(centralBrainMcp)}"]
env = { PROJECT_ID = "global-codex", MEMORY_DIR = "${toTomlPath(path.join(superrooHome, "memory"))}", DATABASE_URL = "postgresql://superroo:superroo@localhost:5432/superroo_brain" }
`
	upsertManagedBlock(paths.codexConfig, managedName, content, 'model = "gpt-5.5"\nmodel_reasoning_effort = "medium"\n')
}

function installCodexAgents() {
	const content = `
# Global SuperRoo Codex Brain Workflow

These instructions apply across projects unless a repo-local AGENTS.md is more specific.

## Default Brain

- Use Codex Brain as the persistent local brain: \`superroo-codex-brain\`.
- Use Codex Brain MCP for MCP-aware clients: \`superroo-codex-brain-mcp\`.
- Codex owns planning, edits, review, tests, and final user communication.
- Local Ollama agents are advisory workers for retrieval, context collection, research, coding drafts, and review.
- DeepSeek is not required for this global workflow unless a repo explicitly asks for it.

## Before Substantial Coding

1. Retrieve memory: \`superroo-codex-retrieve "<task>"\`.
2. Run predictive risk preflight: \`superroo-risk-assess "<task>" --files "path1,path2"\` or MCP \`risk_assess\`.
3. Collect context when useful: \`superroo-codex-collect "<task>"\`.
4. Search repo-local rules, lessons, and architecture docs if present.
5. Register or record task context when the project provides a task memory system.

## During Coding

- Prefer the target repo's existing patterns.
- Use \`superroo-codex-code "<prompt>"\` only as a drafting helper.
- Codex applies final edits directly and verifies behavior.
- Never let any extension delete, rewrite, reorder, or patch existing canonical lessons.

## After Coding

1. Append a lesson to the project's canonical learning layer if present.
2. Run \`superroo-lessons-guard\` when working in SuperRoo repos.
3. Run \`superroo-lessons-sync-local\` to consolidate extension memories.
4. Run \`superroo-codex-brain seed-lessons --all\` from the SuperRoo repo when new lessons were added.
5. Run \`superroo-lessons-sync-central --status\` or sync when Central Brain is reachable.

## Global Machine Learning

- Lesson mirror: \`~/.superroo/memory/lesson-index.jsonl\`.
- Model artifacts: \`~/.superroo/models/code-learner.json\`.
- Train/update ML: \`superroo-ml-train\`.
- Sync ML to VPS: \`superroo-ml-sync-vps\`.
- Full ML sync/merge: \`superroo-ml-sync-full\`.

## Persistent Resources

- Global workflow: \`~/.superroo/workflows/codex-brain-global-workflow.md\`
- Global resource: \`~/.superroo/resources/codex-brain-global.md\`
- ML resource: \`~/.superroo/resources/superroo-ml-global.md\`
- Global MCP config: \`~/.superroo/mcp/codex-brain.json\`
- Global lesson CLI: \`superroo-learn\`
- Global git hook: \`~/.superroo/git-hooks/post-commit\`
- Global user skill: \`~/.codex/skills/codex-brain/SKILL.md\`
`
	writeFile(paths.codexAgents, content.trimStart())
}

function installSkill() {
	const skill = `
---
name: codex-brain
description: Use when a task needs the global SuperRoo Codex Brain workflow, local Ollama RAG memory, cross-project lessons, MCP brain access, append-only lesson guardrails, or persistent agent context across projects.
---

# Codex Brain

Codex Brain is the global SuperRoo local brain for Codex. It wraps local Ollama
models and the shared SuperRoo lesson layer.

## Use This Workflow

1. Retrieve context with \`superroo-codex-retrieve "<task>"\`.
2. Run risk preflight with \`superroo-risk-assess "<task>"\`.
3. Collect task context with \`superroo-codex-collect "<task>"\` for substantial work.
4. Draft with \`superroo-codex-code "<prompt>"\` only when helpful.
5. Apply edits yourself, then verify.
6. Append lessons instead of editing old lessons.
7. Run \`superroo-lessons-guard\` where available.
8. Sync local extension lessons and seed Codex Brain after completion.

## Commands

\`\`\`bash
superroo-codex-brain status
superroo-codex-retrieve "task"
superroo-codex-collect "task"
superroo-codex-code "implementation prompt"
superroo-codex-recall "query"
superroo-codex-remember "lesson"
superroo-risk-assess "task"
superroo-risk-stats
superroo-codex-brain-mcp
superroo-lessons-sync-local
superroo-lessons-guard
superroo-lessons-sync-central --status
superroo-ml-train
superroo-ml-sync-vps
superroo-ml-sync-full
superroo-sync-all-brains
superroo-lesson-gaps
superroo-lesson-summarize
superroo-learning-agent
superroo-learning-doctor
superroo-indexing-agent
superroo-indexing-status
superroo-indexing-sync
superroo-learn status
\`\`\`

## Rules

- Codex Brain is advisory; Codex owns final edits and verification.
- Ollama is the default local model provider.
- Canonical lessons are append-only.
- Convert destructive memory requests into corrective appended lessons.
- Central Brain remains the shared cross-project memory when reachable.
- ML model artifacts live globally under \`~/.superroo/models\`.
- Codex Brain memory lives globally under \`~/.superroo/memory/codex-brain\`.
`
	writeFile(path.join(paths.codexSkillDir, "SKILL.md"), skill.trimStart())
}

function installResources() {
	const workflow = `
# Codex Brain Global Workflow

This is the persistent global workflow for Codex and SuperRoo-aware extensions.

1. Read repo rules.
2. Retrieve memory through Codex Brain.
3. Collect task context through Codex Brain for substantial work.
4. Use local Ollama agents for advisory drafts and review.
5. Codex applies edits and runs verification.
6. Append lessons to the canonical learning layer.
7. Sync extension-local memories into the canonical layer.
8. Seed Codex Brain and sync Central Brain when reachable.
9. Train or sync ML through the global SuperRoo model commands when learning data changes.

DeepSeek is not part of the default global workflow. A repo may request it, but
the persistent baseline is Codex Brain plus local Ollama plus Central Brain.
`

	const resource = `
# Codex Brain Global Resource

## Entry Points

- CLI: \`${codexBrainCli}\`
- MCP: \`${codexBrainMcp}\`
- Central Brain MCP: \`${centralBrainMcp}\`
- Global bin: \`${paths.superrooBin}\`
- Global lesson mirror: \`${globalLessonIndex}\`
- Global markdown lessons: \`${globalLessonsMd}\`
- Global model directory: \`${path.join(superrooHome, "models")}\`
- Global Codex Brain memory: \`${globalCodexBrainDir}\`

## Wrapper Commands

- \`superroo-codex-brain\`
- \`superroo-codex-brain-mcp\`
- \`superroo-codex-retrieve\`
- \`superroo-codex-collect\`
- \`superroo-codex-code\`
- \`superroo-codex-recall\`
- \`superroo-codex-remember\`
- \`superroo-risk-assess\`
- \`superroo-risk-stats\`
- \`superroo-lessons-sync-local\`
- \`superroo-lessons-guard\`
- \`superroo-lessons-sync-central\`
- \`superroo-ml-train\`
- \`superroo-ml-sync-vps\`
- \`superroo-ml-sync-full\`
- \`superroo-sync-all-brains\`
- \`superroo-lesson-gaps\`
- \`superroo-lesson-summarize\`
- \`superroo-learning-agent\`
- \`superroo-learning-doctor\`
- \`superroo-indexing-agent\`
- \`superroo-indexing-status\`
- \`superroo-indexing-sync\`
- \`superroo-learn\`

## Memory Policy

Canonical lesson files are append-only. Agents may append new lessons and
corrective lessons, but must not edit, delete, reorder, or rewrite existing
lesson records.

## Learning Layer Agent Roles

- \`auditor\` - check canonical lesson health, duplicates, schema gaps, and mirror consistency.
- \`curator\` - identify entries needing summaries, tags, files, model metadata, or quality work.
- \`dedupe\` - detect duplicate IDs and titles; add \`--repair\` for backed-up maintenance.
- \`mirror\` - verify Brain MCP, Codex Brain, and Claude Brain mirror canonical lesson IDs.
- \`sentinel\` - run guardrails that block unsafe learning-layer edits.
- \`sync\` - check Central Brain/VPS sync readiness and pending lesson counts.
- \`coverage\` - summarize tags, sources, models, types, and file coverage.
- \`archivist\` - list backups and repair artifacts.
- \`reporter\` - write JSON health reports under \`~/.superroo/reports\`.
- \`doctor\` - combined health check; add \`--repair\` for safe repairs.
`

	const mlResource = `
# SuperRoo ML Global Resource

## Status

The SuperRoo ML data layer is global. Model artifacts live in:

\`\`\`txt
${path.join(superrooHome, "models")}
\`\`\`

The neural-network engine implementation remains repo code in:

\`\`\`txt
${path.join(repoRoot, "src", "super-roo", "ml")}
\`\`\`

Global command wrappers call that repo implementation so every project can use
the same persisted model artifacts.

## Global Files

- \`${path.join(superrooHome, "models", "code-learner.json")}\`
- \`${path.join(superrooHome, "models", "train-log.json")}\`
- \`${path.join(superrooHome, "models", "vps-sync-state.json")}\`
- \`${globalLessonIndex}\`
- \`${path.join(superrooHome, "memory", "codex-brain", "memory.json")}\`
- \`${path.join(superrooHome, "memory", "claude-brain", "knowledge.jsonl")}\`

## Commands

- \`superroo-ml-train\` - train/update the global code learner from lessons.
- \`superroo-ml-sync-vps\` - sync global ML artifacts to the VPS.
- \`superroo-ml-sync-full\` - run full local/VPS ML sync and merge flow.

## Rule

Treat neural-network code as versioned source and model artifacts as global
state. Persist trained weights under \`~/.superroo/models\`, not inside a single
project checkout.
`

	const mcpConfig = {
		mcpServers: {
			"codex-brain": {
				command: "node",
				args: [codexBrainMcp],
				env: {
					OLLAMA_HOST: "http://127.0.0.1:11434",
					SUPERROO_HOME: superrooHome,
					SUPERROO_MEMORY_DIR: path.join(superrooHome, "memory"),
					CODEX_BRAIN_MEMORY_DIR: globalCodexBrainDir,
					SUPERROO_RISK_DIR: globalRiskDir,
					CODEX_BRAIN_HERMES_MODEL: "hermes3",
					CODEX_BRAIN_EMBED_MODEL: "nomic-embed-text",
					CODEX_BRAIN_FAST_CODER_MODEL: "qwen2.5-coder:7b",
					CODEX_BRAIN_PRO_CODER_MODEL: "qwen3:14b",
				},
			},
			"central-brain": {
				command: "node",
				args: [centralBrainMcp],
				env: {
					PROJECT_ID: "global-codex",
					MEMORY_DIR: path.join(superrooHome, "memory"),
					DATABASE_URL: "postgresql://superroo:superroo@localhost:5432/superroo_brain",
				},
			},
			"claude-brain": {
				command: "node",
				args: [path.join(home, "brain", "src", "server.js")],
				env: {
					OLLAMA_HOST: "http://127.0.0.1:11434",
					SUPERROO_HOME: superrooHome,
					SUPERROO_MEMORY_DIR: path.join(superrooHome, "memory"),
					SUPERROO_BRAIN_DATA_DIR: globalBrainMcpDir,
					SUPERROO_MODEL_DIR: path.join(superrooHome, "models"),
				},
			},
		},
	}

	writeFile(path.join(paths.superrooWorkflows, "codex-brain-global-workflow.md"), workflow.trimStart())
	writeFile(path.join(paths.superrooResources, "codex-brain-global.md"), resource.trimStart())
	writeFile(path.join(paths.superrooResources, "superroo-ml-global.md"), mlResource.trimStart())
	writeFile(path.join(paths.superrooMcp, "codex-brain.json"), `${JSON.stringify(mcpConfig, null, 2)}\n`)
	writeFile(path.join(codexHome, "mcp.codex-brain.json"), `${JSON.stringify(mcpConfig, null, 2)}\n`)
}

function installKiloMcpConfig() {
	const memoryDir = path.join(superrooHome, "memory")
	const mcp = fs.existsSync(paths.kiloMcp)
		? JSON.parse(fs.readFileSync(paths.kiloMcp, "utf8"))
		: { mcpServers: {} }
	mcp.mcpServers = mcp.mcpServers || {}
	mcp.mcpServers["central-brain"] = {
		...(mcp.mcpServers["central-brain"] || {}),
		command: "node",
		args: [centralBrainMcp],
		env: {
			...((mcp.mcpServers["central-brain"] || {}).env || {}),
			PROJECT_ID: "global",
			DATABASE_URL: "postgresql://superroo:superroo@localhost:5432/superroo_brain",
			MEMORY_DIR: memoryDir,
			SUPERROO_HOME: superrooHome,
			SUPERROO_MEMORY_DIR: memoryDir,
		},
	}
	mcp.mcpServers["codex-brain"] = {
		...(mcp.mcpServers["codex-brain"] || {}),
		command: "node",
		args: [codexBrainMcp],
		env: {
			...((mcp.mcpServers["codex-brain"] || {}).env || {}),
			OLLAMA_HOST: "http://127.0.0.1:11434",
			SUPERROO_HOME: superrooHome,
			SUPERROO_MEMORY_DIR: memoryDir,
			MEMORY_DIR: memoryDir,
			CODEX_BRAIN_MEMORY_DIR: globalCodexBrainDir,
			SUPERROO_RISK_DIR: globalRiskDir,
			CODEX_BRAIN_HERMES_MODEL: "hermes3",
			CODEX_BRAIN_EMBED_MODEL: "nomic-embed-text",
			CODEX_BRAIN_FAST_CODER_MODEL: "qwen2.5-coder:7b",
			CODEX_BRAIN_PRO_CODER_MODEL: "qwen3:14b",
		},
	}
	writeFile(paths.kiloMcp, `${JSON.stringify(mcp, null, 2)}\n`)
}

function installGlobalMemoryMirror() {
	ensureDir(path.dirname(globalLessonIndex))
	if (fs.existsSync(repoLessonIndex)) {
		fs.copyFileSync(repoLessonIndex, globalLessonIndex)
	}
	if (fs.existsSync(repoLessonsMd)) {
		fs.copyFileSync(repoLessonsMd, globalLessonsMd)
	}
	copyIfExists(path.join(repoRoot, "memory", "lesson-summaries.json"), path.join(superrooHome, "memory", "lesson-summaries.json"))
	copyIfExists(path.join(repoRoot, "memory", "bugs-fixed.md"), path.join(superrooHome, "memory", "bugs-fixed.md"))
	copyIfExists(path.join(repoRoot, "memory", "feature-knowledge.md"), path.join(superrooHome, "memory", "feature-knowledge.md"))
	copyIfExists(path.join(repoRoot, "memory", "model-decisions.md"), path.join(superrooHome, "memory", "model-decisions.md"))
	copyIfExists(path.join(repoRoot, "memory", "context", "latest-agent-context.md"), path.join(superrooHome, "memory", "context", "latest-agent-context.md"))
	copyIfExists(path.join(repoRoot, "server", "src", "memory", "codextask.json"), path.join(superrooHome, "memory", "codextask.json"))
	copyIfExists(path.join(repoRoot, "server", "src", "memory", "commit-deploy-log.json"), path.join(superrooHome, "memory", "commit-deploy-log.json"))
	copyIfExists(path.join(repoRoot, "memory", "codex-brain", "memory.json"), path.join(globalCodexBrainDir, "memory.json"), false)
	copyIfExists(path.join(repoRoot, "memory", "codex-brain", "outcomes.jsonl"), path.join(globalCodexBrainDir, "outcomes.jsonl"), false)
	copyDirIfExists(path.join(repoRoot, "memory", "claude-brain"), globalClaudeBrainDir, false)
	copyIfExists(path.join(home, "brain", "data", "memory.json"), path.join(globalBrainMcpDir, "memory.json"), false)
	copyDirIfExists(path.join(repoRoot, "memory", "ollama"), path.join(superrooHome, "memory", "ollama"))
	copyDirIfExists(path.join(repoRoot, "memory", "competitor-research"), path.join(superrooHome, "memory", "competitor-research"))
	ensureDir(path.join(superrooHome, "models"))
}

function copyIfExists(source, target, overwrite = true) {
	if (!fs.existsSync(source)) return
	if (!overwrite && fs.existsSync(target)) return
	ensureDir(path.dirname(target))
	fs.copyFileSync(source, target)
}

function copyDirIfExists(source, target, overwrite = true) {
	if (!fs.existsSync(source)) return
	ensureDir(target)
	for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
		const sourcePath = path.join(source, entry.name)
		const targetPath = path.join(target, entry.name)
		if (entry.isDirectory()) {
			copyDirIfExists(sourcePath, targetPath, overwrite)
		} else if (entry.isFile()) {
			copyIfExists(sourcePath, targetPath, overwrite)
		}
	}
}

function installGlobalLearningHook() {
	ensureDir(globalHookDir)
	const hookTarget = path.join(globalHookDir, "post-commit")
	copyIfExists(globalPostCommitSource, hookTarget)
	copyIfExists(superrooLearnSource, path.join(paths.superrooBin, "superroo-learn.mjs"))
	createCmdWrapper(path.join(paths.superrooBin, "superroo-learn.cmd"), path.join(paths.superrooBin, "superroo-learn.mjs"), [])
	createShWrapper(path.join(paths.superrooBin, "superroo-learn"), path.join(paths.superrooBin, "superroo-learn.mjs"), [])
	const stalePsWrapper = path.join(paths.superrooBin, "superroo-learn.ps1")
	if (fs.existsSync(stalePsWrapper)) fs.unlinkSync(stalePsWrapper)
	try {
		const gitConfig = awaitCommand("git", ["config", "--global", "core.hooksPath", globalHookDir])
		if (gitConfig.status !== 0) {
			console.error(`warning: failed to set global git hooksPath: ${gitConfig.stderr}`)
		}
	} catch (error) {
		console.error(`warning: failed to set global git hooksPath: ${error.message}`)
	}
}

function awaitCommand(command, args) {
	return spawnSync(command, args, { encoding: "utf8" })
}

installWrappers()
installCodexConfig()
installCodexAgents()
installSkill()
installResources()
installKiloMcpConfig()
installGlobalMemoryMirror()
installGlobalLearningHook()

console.log(JSON.stringify({
	ok: true,
	codexHome,
	superrooHome,
	wrappers: paths.superrooBin,
	skill: path.join(paths.codexSkillDir, "SKILL.md"),
	workflow: path.join(paths.superrooWorkflows, "codex-brain-global-workflow.md"),
	resource: path.join(paths.superrooResources, "codex-brain-global.md"),
	mlResource: path.join(paths.superrooResources, "superroo-ml-global.md"),
	mcp: path.join(paths.superrooMcp, "codex-brain.json"),
	globalLessonIndex,
	globalLessonsMd,
	globalCodexBrainDir,
	globalBrainMcpDir,
	globalModels: path.join(superrooHome, "models"),
	globalHookDir,
}, null, 2))
