#!/usr/bin/env python3
"""
Replace the "Login Successful" message in handleVerifyEmailOtp with a
welcome message that shows the latest workspace and offers to open it.
"""
import re

BOT_FILE = "/opt/superroo2/cloud/api/telegramBot.js"

with open(BOT_FILE, "r") as f:
    content = f.read()

old_login_success = """			// Create local session
			createOrRefreshSession(chatId)

			await sendMessage(
				botToken,
				chatId,
				"*Login Successful* ✅\\n\\nYou are now signed in as: `" +
					state.email +
					"`\\n\\nSensitive messages have been auto-deleted.\\n\\nUse `/projects` to view your projects.\\nUse `/code <instruction>` to start a coding task.",
			)"""

new_login_success = """			// Create local session
			createOrRefreshSession(chatId)

			// Fetch projects to find the latest workspace
			var projectsResult = null
			try {
				projectsResult = await auth.handleTelegramProjects({
					telegramUserId: telegramUserId,
					telegramChatId: chatId,
				})
			} catch (e) {
				// Projects fetch is best-effort
			}

			var latestProject = null
			if (projectsResult && projectsResult.projects && projectsResult.projects.length > 0) {
				// Sort by lastActivityAt descending, pick the most recent
				var sorted = projectsResult.projects.slice().sort(function(a, b) {
					return new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime()
				})
				latestProject = sorted[0]
			}

			if (latestProject) {
				var welcomeText =
					"*Welcome Boss JP* 👋\\n\\n" +
					"How should we proceed today?\\n\\n" +
					"Your latest workspace is: *" + latestProject.name + "*\\n" +
					(latestProject.language ? "Language: " + latestProject.language + "\\n" : "") +
					(latestProject.activeFile ? "Last file: `" + latestProject.activeFile + "`\\n" : "") +
					(latestProject.currentTask ? "Last task: " + latestProject.currentTask + "\\n" : "")

				await sendInlineKeyboard(
					botToken,
					chatId,
					welcomeText,
					[
						[
							{ text: "✅ Yes, open " + latestProject.name, callback_data: "project:" + latestProject.id }
						],
						[
							{ text: "📁 View all projects", callback_data: "projects" },
							{ text: "❌ No, just browsing", callback_data: "dismiss_welcome" }
						]
					]
				)
			} else {
				await sendMessage(
					botToken,
					chatId,
					"*Welcome Boss JP* 👋\\n\\n" +
					"How should we proceed today?\\n\\n" +
					"You don't have any projects yet. Use `/projects` to get started.",
				)
			}"""

content = content.replace(old_login_success, new_login_success)

with open(BOT_FILE, "w") as f:
    f.write(content)

print("✅ Welcome message added to handleVerifyEmailOtp")
