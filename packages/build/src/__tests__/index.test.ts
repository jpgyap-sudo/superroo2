// npx vitest run src/__tests__/index.test.ts

import { generatePackageJson } from "../index.js"

describe("generatePackageJson", () => {
	it("should be a test", () => {
		const generatedPackageJson = generatePackageJson({
			packageJson: {
				name: "superroo",
				displayName: "%extension.displayName%",
				description: "%extension.description%",
				publisher: "SuperRoo",
				version: "3.17.2",
				icon: "assets/icons/icon.png",
				contributes: {
					viewsContainers: {
						activitybar: [
							{
								id: "superroo-ActivityBar",
								title: "%views.activitybar.title%",
								icon: "assets/icons/icon.svg",
							},
						],
					},
					views: {
						"superroo-ActivityBar": [
							{
								type: "webview",
								id: "superroo.SidebarProvider",
								name: "",
							},
						],
					},
					commands: [
						{
							command: "superroo.plusButtonClicked",
							title: "%command.newTask.title%",
							icon: "$(edit)",
						},
						{
							command: "superroo.openInNewTab",
							title: "%command.openInNewTab.title%",
							category: "%configuration.title%",
						},
					],
					menus: {
						"editor/context": [
							{
								submenu: "superroo.contextMenu",
								group: "navigation",
							},
						],
						"superroo.contextMenu": [
							{
								command: "superroo.addToContext",
								group: "1_actions@1",
							},
						],
						"editor/title": [
							{
								command: "superroo.plusButtonClicked",
								group: "navigation@1",
								when: "activeWebviewPanelId == superroo.TabPanelProvider",
							},
							{
								command: "superroo.settingsButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == superroo.TabPanelProvider",
							},
							{
								command: "superroo.accountButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == superroo.TabPanelProvider",
							},
						],
					},
					submenus: [
						{
							id: "superroo.contextMenu",
							label: "%views.contextMenu.label%",
						},
						{
							id: "superroo.terminalMenu",
							label: "%views.terminalMenu.label%",
						},
					],
					configuration: {
						title: "%configuration.title%",
						properties: {
							"superroo.allowedCommands": {
								type: "array",
								items: {
									type: "string",
								},
								default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
								description: "%commands.allowedCommands.description%",
							},
							"superroo.customStoragePath": {
								type: "string",
								default: "",
								description: "%settings.customStoragePath.description%",
							},
						},
					},
				},
				scripts: {
					lint: "eslint **/*.ts",
				},
			},
			overrideJson: {
				name: "superroo-nightly",
				displayName: "SuperRoo Nightly",
				publisher: "SuperRoo",
				version: "0.0.1",
				icon: "assets/icons/icon-nightly.png",
				scripts: {},
			},
			substitution: ["superroo", "superroo-nightly"],
		})

		expect(generatedPackageJson).toStrictEqual({
			name: "superroo-nightly",
			displayName: "SuperRoo Nightly",
			description: "%extension.description%",
			publisher: "SuperRoo",
			version: "0.0.1",
			icon: "assets/icons/icon-nightly.png",
			contributes: {
				viewsContainers: {
					activitybar: [
						{
							id: "superroo-nightly-ActivityBar",
							title: "%views.activitybar.title%",
							icon: "assets/icons/icon.svg",
						},
					],
				},
				views: {
					"superroo-nightly-ActivityBar": [
						{
							type: "webview",
							id: "superroo-nightly.SidebarProvider",
							name: "",
						},
					],
				},
				commands: [
					{
						command: "superroo-nightly.plusButtonClicked",
						title: "%command.newTask.title%",
						icon: "$(edit)",
					},
					{
						command: "superroo-nightly.openInNewTab",
						title: "%command.openInNewTab.title%",
						category: "%configuration.title%",
					},
				],
				menus: {
					"editor/context": [
						{
							submenu: "superroo-nightly.contextMenu",
							group: "navigation",
						},
					],
					"superroo-nightly.contextMenu": [
						{
							command: "superroo-nightly.addToContext",
							group: "1_actions@1",
						},
					],
					"editor/title": [
						{
							command: "superroo-nightly.plusButtonClicked",
							group: "navigation@1",
							when: "activeWebviewPanelId == superroo-nightly.TabPanelProvider",
						},
						{
							command: "superroo-nightly.settingsButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == superroo-nightly.TabPanelProvider",
						},
						{
							command: "superroo-nightly.accountButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == superroo-nightly.TabPanelProvider",
						},
					],
				},
				submenus: [
					{
						id: "superroo-nightly.contextMenu",
						label: "%views.contextMenu.label%",
					},
					{
						id: "superroo-nightly.terminalMenu",
						label: "%views.terminalMenu.label%",
					},
				],
				configuration: {
					title: "%configuration.title%",
					properties: {
						"superroo-nightly.allowedCommands": {
							type: "array",
							items: {
								type: "string",
							},
							default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
							description: "%commands.allowedCommands.description%",
						},
						"superroo-nightly.customStoragePath": {
							type: "string",
							default: "",
							description: "%settings.customStoragePath.description%",
						},
					},
				},
			},
			scripts: {},
		})
	})
})
