// Mock VSCode API for Vitest tests - webview context
type MockVsCodeApi = {
	getState: () => unknown | undefined
	setState: <T>(newState: T) => T
	postMessage: (message: unknown) => void
}

// Mock acquireVsCodeApi for webview tests
const mockVsCodeApi: MockVsCodeApi = {
	getState: () => undefined,
	setState: (newState) => newState,
	postMessage: () => {},
}

// @ts-expect-error - acquireVsCodeApi is a global provided by VS Code
global.acquireVsCodeApi = () => mockVsCodeApi

export const workspace = {
	workspaceFolders: [],
	getWorkspaceFolder: () => null,
	onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
	getConfiguration: () => ({
		get: (key: string, defaultValue?: unknown) => defaultValue,
	}),
	createFileSystemWatcher: () => ({
		onDidCreate: () => ({ dispose: () => {} }),
		onDidChange: () => ({ dispose: () => {} }),
		onDidDelete: () => ({ dispose: () => {} }),
		dispose: () => {},
	}),
	fs: {
		readFile: () => Promise.resolve(new Uint8Array()),
		writeFile: () => Promise.resolve(),
		stat: () => Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: 0 }),
	},
}

export const window = {
	activeTextEditor: null,
	onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
	showErrorMessage: () => Promise.resolve(),
	showWarningMessage: () => Promise.resolve(),
	showInformationMessage: () => Promise.resolve(),
	createOutputChannel: () => ({
		appendLine: () => {},
		append: () => {},
		clear: () => {},
		show: () => {},
		dispose: () => {},
	}),
	createTerminal: () => ({
		exitStatus: undefined,
		name: "SuperRoo",
		processId: Promise.resolve(123),
		creationOptions: {},
		state: { isInteractedWith: true },
		dispose: () => {},
		hide: () => {},
		show: () => {},
		sendText: () => {},
	}),
	onDidCloseTerminal: () => ({ dispose: () => {} }),
	createTextEditorDecorationType: () => ({ dispose: () => {} }),
}

export const commands = {
	registerCommand: () => ({ dispose: () => {} }),
	executeCommand: () => Promise.resolve(),
}

export const languages = {
	createDiagnosticCollection: () => ({
		set: () => {},
		delete: () => {},
		clear: () => {},
		dispose: () => {},
	}),
}

export const extensions = {
	getExtension: () => null,
}

export const env = {
	openExternal: () => Promise.resolve(),
	machineId: "test-machine-id",
	language: "en",
}

export const Uri = {
	file: (path: string) => ({ fsPath: path, path, scheme: "file" }),
	parse: (path: string) => ({ fsPath: path, path, scheme: "file" }),
}

export const Range = class {
	start: unknown
	end: unknown
	constructor(start: unknown, end: unknown) {
		this.start = start
		this.end = end
	}
}

export const Position = class {
	line: number
	character: number
	constructor(line: number, character: number) {
		this.line = line
		this.character = character
	}
}

export const Selection = class extends Range {
	anchor: unknown
	active: unknown
	constructor(start: unknown, end: unknown) {
		super(start, end)
		this.anchor = start
		this.active = end
	}
}

export const Disposable = { dispose: () => {} }

export const ThemeIcon = class {
	id: string
	constructor(id: string) {
		this.id = id
	}
}

export const FileType = {
	File: 1,
	Directory: 2,
	SymbolicLink: 64,
}

export const DiagnosticSeverity = {
	Error: 0,
	Warning: 1,
	Information: 2,
	Hint: 3,
}

export const OverviewRulerLane = {
	Left: 1,
	Center: 2,
	Right: 4,
	Full: 7,
}

export const CodeAction = class {
	title: string
	kind: unknown
	command: unknown
	constructor(title: string, kind?: unknown) {
		this.title = title
		this.kind = kind
		this.command = undefined
	}
}

export const CodeActionKind = {
	QuickFix: { value: "quickfix" },
	RefactorRewrite: { value: "refactor.rewrite" },
}

export const EventEmitter = () => ({
	event: () => () => {},
	fire: () => {},
	dispose: () => {},
})

export default {
	workspace,
	window,
	commands,
	languages,
	extensions,
	env,
	Uri,
	Range,
	Position,
	Selection,
	Disposable,
	ThemeIcon,
	FileType,
	DiagnosticSeverity,
	OverviewRulerLane,
	EventEmitter,
	CodeAction,
	CodeActionKind,
}