#!/usr/bin/env python3
"""Add dismiss_welcome and projects callback handlers to telegramBot.js."""
import re

path = "/opt/superroo2/cloud/api/telegramBot.js"
with open(path, "r") as f:
    content = f.read()

# Find the callback query handler section and add dismiss_welcome + projects handling
old = '''		// Handle project selection
		if (cqData.startsWith("project:")) {
			var projectId = cqData.slice(8)
			await handleProjectSelect(botToken, cqChatId, cqMessageId, projectId, cqUserId)
			return
		}

		return'''

new = '''		// Handle project selection
		if (cqData.startsWith("project:")) {
			var projectId = cqData.slice(8)
			await handleProjectSelect(botToken, cqChatId, cqMessageId, projectId, cqUserId)
			return
		}

		// Handle "View all projects" from welcome message
		if (cqData === "projects") {
			await editMessageText(botToken, cqChatId, cqMessageId, "📋 *Loading your projects\\.\\.\\.*")
			await handleProjects(botToken, cqChatId, cqUserId)
			return
		}

		// Handle "No, just browsing" from welcome message
		if (cqData === "dismiss_welcome") {
			await editMessageText(botToken, cqChatId, cqMessageId, "Alright, Boss JP\\. Feel free to type */login* whenever you want to start working\\.")
			return
		}

		return'''

if old in content:
    content = content.replace(old, new)
    with open(path, "w") as f:
        f.write(content)
    print("SUCCESS: Added dismiss_welcome and projects callback handlers.")
else:
    print("ERROR: Could not find the target section.")
    # Debug: show context around the area
    idx = content.find("// Handle project selection")
    if idx >= 0:
        print(content[idx:idx+500])
