import * as path from "path"

const {
	mockStat,
	mockReadFile,
	mockReaddir,
	mockDirectoryExists,
	mockFileExists,
	mockRealpath,
	mockMkdir,
	mockWriteFile,
	mockRm,
	mockRename,
	mockRmdir,
} = vi.hoisted(() => ({
	mockStat: vi.fn(),
	mockReadFile: vi.fn(),
	mockReaddir: vi.fn(),
	mockDirectoryExists: vi.fn(),
	mockFileExists: vi.fn(),
	mockRealpath: vi.fn(),
	mockMkdir: vi.fn(),
	mockWriteFile: vi.fn(),
	mockRm: vi.fn(),
	mockRename: vi.fn(),
	mockRmdir: vi.fn(),
}))

const HOME_DIR = process.platform === "win32" ? "C:\\Users\\testuser" : "/home/user"
const PROJECT_DIR = process.platform === "win32" ? "C:\\test\\project" : "/test/project"

const p = (...segments: string[]) => path.join(...segments)

vi.mock("fs/promises", () => ({
	default: {
		stat: mockStat,
		readFile: mockReadFile,
		readdir: mockReaddir,
		realpath: mockRealpath,
		mkdir: mockMkdir,
		writeFile: mockWriteFile,
		rm: mockRm,
		rename: mockRename,
		rmdir: mockRmdir,
	},
	stat: mockStat,
	readFile: mockReadFile,
	readdir: mockReaddir,
	realpath: mockRealpath,
	mkdir: mockMkdir,
	writeFile: mockWriteFile,
	rm: mockRm,
	rename: mockRename,
	rmdir: mockRmdir,
}))

vi.mock("os", () => ({
	homedir: vi.fn(() => HOME_DIR),
}))

vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidChange: vi.fn(),
			onDidCreate: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		})),
	},
	RelativePattern: vi.fn(),
}))

const GLOBAL_ROO_DIR = p(HOME_DIR, ".roo")
const GLOBAL_AGENTS_DIR = p(HOME_DIR, ".agents")

vi.mock("../../roo-config", () => ({
	getGlobalRooDirectory: () => GLOBAL_ROO_DIR,
	getGlobalAgentsDirectory: () => GLOBAL_AGENTS_DIR,
	getProjectAgentsDirectoryForCwd: (cwd: string) => p(cwd, ".agents"),
	directoryExists: mockDirectoryExists,
	fileExists: mockFileExists,
	readFile: mockReadFile,
}))

vi.mock("../../../i18n", () => ({
	t: (key: string, params?: Record<string, any>) => {
		const translations: Record<string, string> = {
			"skills:errors.name_length": `Skill name must be 1-${params?.maxLength} characters (got ${params?.length})`,
			"skills:errors.name_format":
				"Skill name must be lowercase letters/numbers/hyphens only (no leading/trailing hyphen, no consecutive hyphens)",
			"skills:errors.description_length": `Skill description must be 1-1024 characters (got ${params?.length})`,
			"skills:errors.no_workspace": "Cannot create project skill: no workspace folder is open",
			"skills:errors.already_exists": `Skill "${params?.name}" already exists at ${params?.path}`,
			"skills:errors.not_found": `Skill "${params?.name}" not found in ${params?.source}${params?.modeInfo}`,
		}
		return translations[key] || key
	},
}))

import { describe, it, expect, beforeEach, vi } from "vitest"
import { SkillsManager } from "../SkillsManager"
import { ClineProvider } from "../../../core/webview/ClineProvider"

const globalSkillsDir = p(HOME_DIR, ".roo", "skills")
const globalSkillsCodeDir = p(HOME_DIR, ".roo", "skills-code")
const globalSkillsArchitectDir = p(HOME_DIR, ".roo", "skills-architect")
const projectSkillsDir = p(PROJECT_DIR, ".roo", "skills")

describe("SkillsManager.getSkillsForMode — multi-mode conflict resolution", () => {
	let skillsManager: SkillsManager
	let mockProvider: Partial<ClineProvider>

	beforeEach(() => {
		vi.clearAllMocks()

		mockProvider = {
			cwd: PROJECT_DIR,
			contextProxy: {
				workspaceState: {
					get: vi.fn().mockReturnValue(undefined),
					update: vi.fn().mockResolvedValue(undefined),
				},
			},
		} as unknown as ClineProvider

		skillsManager = new SkillsManager(mockProvider as ClineProvider)
	})

	it("should resolve project > global override", async () => {
		const globalSharedDir = p(globalSkillsDir, "shared-skill")
		const projectSharedDir = p(projectSkillsDir, "shared-skill")

		mockDirectoryExists.mockImplementation(async (dir: string) => {
			return [globalSkillsDir, projectSkillsDir].includes(dir)
		})
		mockRealpath.mockImplementation(async (pathArg: string) => pathArg)
		mockReaddir.mockImplementation(async (dir: string) => {
			if (dir === globalSkillsDir) return ["shared-skill"]
			if (dir === projectSkillsDir) return ["shared-skill"]
			return []
		})
		mockStat.mockImplementation(async (pathArg: string) => {
			if (pathArg === globalSharedDir || pathArg === projectSharedDir) {
				return { isDirectory: () => true }
			}
			throw new Error("Not found")
		})
		mockFileExists.mockResolvedValue(true)
		mockReadFile.mockResolvedValue(`---
name: shared-skill
description: Shared skill
---
Instructions`)

		await skillsManager.discoverSkills()

		const skills = skillsManager.getSkillsForMode("code")
		const sharedSkill = skills.find((s) => s.name === "shared-skill")

		expect(sharedSkill?.source).toBe("project")
	})

	it("should resolve mode-specific > generic override", async () => {
		const genericDir = p(globalSkillsDir, "test-skill")
		const codeDir = p(globalSkillsCodeDir, "test-skill")

		mockDirectoryExists.mockImplementation(async (dir: string) => {
			return [globalSkillsDir, globalSkillsCodeDir].includes(dir)
		})
		mockRealpath.mockImplementation(async (pathArg: string) => pathArg)
		mockReaddir.mockImplementation(async (dir: string) => {
			if (dir === globalSkillsDir) return ["test-skill"]
			if (dir === globalSkillsCodeDir) return ["test-skill"]
			return []
		})
		mockStat.mockImplementation(async (pathArg: string) => {
			if (pathArg === genericDir || pathArg === codeDir) {
				return { isDirectory: () => true }
			}
			throw new Error("Not found")
		})
		mockFileExists.mockResolvedValue(true)
		mockReadFile.mockResolvedValue(`---
name: test-skill
description: Test skill
---
Instructions`)

		await skillsManager.discoverSkills()

		const skills = skillsManager.getSkillsForMode("code")
		const testSkill = skills.find((s) => s.name === "test-skill")

		expect(testSkill?.mode).toBe("code")
	})

	it("should return only the requested mode-specific skill when multi-mode copies exist", async () => {
		const codeDir = p(globalSkillsCodeDir, "multi-skill")
		const architectDir = p(globalSkillsArchitectDir, "multi-skill")

		mockDirectoryExists.mockImplementation(async (dir: string) => {
			return [globalSkillsCodeDir, globalSkillsArchitectDir].includes(dir)
		})
		mockRealpath.mockImplementation(async (pathArg: string) => pathArg)
		mockReaddir.mockImplementation(async (dir: string) => {
			if (dir === globalSkillsCodeDir) return ["multi-skill"]
			if (dir === globalSkillsArchitectDir) return ["multi-skill"]
			return []
		})
		mockStat.mockImplementation(async (pathArg: string) => {
			if (pathArg === codeDir || pathArg === architectDir) {
				return { isDirectory: () => true }
			}
			throw new Error("Not found")
		})
		mockFileExists.mockResolvedValue(true)
		mockReadFile.mockResolvedValue(`---
name: multi-skill
description: Multi skill
---
Instructions`)

		await skillsManager.discoverSkills()

		const codeSkills = skillsManager.getSkillsForMode("code")
		const architectSkills = skillsManager.getSkillsForMode("architect")

		expect(codeSkills.length).toBe(1)
		expect(codeSkills[0].mode).toBe("code")
		expect(architectSkills.length).toBe(1)
		expect(architectSkills[0].mode).toBe("architect")
	})

	it("should include generic skills in every mode", async () => {
		const genericDir = p(globalSkillsDir, "generic-skill")

		mockDirectoryExists.mockImplementation(async (dir: string) => {
			return dir === globalSkillsDir
		})
		mockRealpath.mockImplementation(async (pathArg: string) => pathArg)
		mockReaddir.mockImplementation(async (dir: string) => {
			if (dir === globalSkillsDir) return ["generic-skill"]
			return []
		})
		mockStat.mockImplementation(async (pathArg: string) => {
			if (pathArg === genericDir) return { isDirectory: () => true }
			throw new Error("Not found")
		})
		mockFileExists.mockResolvedValue(true)
		mockReadFile.mockResolvedValue(`---
name: generic-skill
description: Generic skill
---
Instructions`)

		await skillsManager.discoverSkills()

		const codeSkills = skillsManager.getSkillsForMode("code")
		const architectSkills = skillsManager.getSkillsForMode("architect")

		expect(codeSkills.map((s) => s.name)).toContain("generic-skill")
		expect(architectSkills.map((s) => s.name)).toContain("generic-skill")
	})

	it("should keep first-seen when same source and same mode-specificity", async () => {
		const genericDir = p(globalSkillsDir, "same-skill")

		mockDirectoryExists.mockImplementation(async (dir: string) => {
			return dir === globalSkillsDir
		})
		mockRealpath.mockImplementation(async (pathArg: string) => pathArg)
		mockReaddir.mockImplementation(async (dir: string) => {
			if (dir === globalSkillsDir) return ["same-skill"]
			return []
		})
		mockStat.mockImplementation(async (pathArg: string) => {
			if (pathArg === genericDir) return { isDirectory: () => true }
			throw new Error("Not found")
		})
		mockFileExists.mockResolvedValue(true)
		let callCount = 0
		mockReadFile.mockImplementation(async () => {
			callCount++
			return `---
name: same-skill
description: Version ${callCount}
---
Instructions`
		})

		await skillsManager.discoverSkills()

		const skills = skillsManager.getSkillsForMode("code")
		const skill = skills.find((s) => s.name === "same-skill")

		expect(skill?.description).toBe("Version 1")
	})
})
