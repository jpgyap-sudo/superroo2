// Root vitest setup for src/ tests
import { vi } from "vitest"

// Mock vscode for src/ tests
global.vscode = {
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
} as any
