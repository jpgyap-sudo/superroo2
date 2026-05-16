#!/usr/bin/env python3
"""
Fix auth.js: Add handleTelegramLogin to exports
Fix telegramBot.js: Add email whitelist check in handleEmailOtpLogin()
"""

import re

# ── Fix 1: Add handleTelegramLogin to auth.js exports ──
auth_path = "/opt/superroo2/cloud/api/auth.js"

with open(auth_path, "r") as f:
    auth_content = f.read()

# Add handleTelegramLogin to the exports
old_exports = """module.exports = {
	loadStore,
	handleAuthRoute,
	authenticate,
	requireAuth,
	handleTelegramSessionCheck,
	handleTelegramProjects,
	handleTelegramProjectSelect,
	handleOrchestratorInstruction,
}"""

new_exports = """module.exports = {
	loadStore,
	handleAuthRoute,
	authenticate,
	requireAuth,
	handleTelegramLogin,
	handleTelegramSessionCheck,
	handleTelegramProjects,
	handleTelegramProjectSelect,
	handleOrchestratorInstruction,
}"""

if old_exports in auth_content:
    auth_content = auth_content.replace(old_exports, new_exports)
    with open(auth_path, "w") as f:
        f.write(auth_content)
    print("FIX 1: Added handleTelegramLogin to auth.js exports")
else:
    print("WARN 1: Could not find old exports pattern in auth.js")
    # Check if handleTelegramLogin is already there
    if "handleTelegramLogin" in auth_content:
        print("  -> handleTelegramLogin already in auth.js (no change needed)")
    else:
        print("  -> ERROR: Unknown state in auth.js")


# ── Fix 2: Add email whitelist check in telegramBot.js handleEmailOtpLogin ──
bot_path = "/opt/superroo2/cloud/api/telegramBot.js"

with open(bot_path, "r") as f:
    bot_content = f.read()

# The handleEmailOtpLogin function starts with basic email validation
# We need to add a whitelist check after the email regex validation
# Find the function and add whitelist check

# Pattern: after the email regex check and before OTP generation
old_pattern = """	// Basic email validation
	var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
	if (!emailRegex.test(email)) {
		await sendMessage(botToken, chatId, "*Invalid Email* ❌\\n\\nPlease enter a valid email address (e.g., `user@example.com`).\\n\\nUse `/login` to try again.")
		pendingEmailOtps.delete(chatId)
		return
	}
	var otp = Math.floor(100000 + Math.random() * 900000).toString()"""

new_pattern = """	// Basic email validation
	var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
	if (!emailRegex.test(email)) {
		await sendMessage(botToken, chatId, "*Invalid Email* ❌\\n\\nPlease enter a valid email address (e.g., `user@example.com`).\\n\\nUse `/login` to try again.")
		pendingEmailOtps.delete(chatId)
		return
	}

	// ── Email whitelist check ──
	// Only allow emails that are registered in the SuperRoo Cloud auth store
	try {
		var fs = require("fs")
		var usersPath = __dirname + "/../data/auth/users.json"
		var usersData = JSON.parse(fs.readFileSync(usersPath, "utf8"))
		var whitelistedEmails = Object.values(usersData).map(function(u) { return u.email.toLowerCase() })
		var isWhitelisted = whitelistedEmails.indexOf(email.toLowerCase()) !== -1

		if (!isWhitelisted) {
			var whitelistStr = whitelistedEmails.map(function(e) { return "  - `" + e + "`" }).join("\\n")
			await sendMessage(
				botToken,
				chatId,
				"*Email Not Registered* ❌\\n\\nThe email `" + email + "` is not registered in SuperRoo Cloud.\\n\\nOnly registered users can receive OTP codes.\\n\\n*Registered emails:*\\n" + whitelistStr + "\\n\\nPlease register at the SuperRoo Cloud dashboard first, then use `/login` again."
			)
			pendingEmailOtps.delete(chatId)
			return
		}
	} catch (err) {
		console.error("[telegram] Failed to check email whitelist: " + (err.message || err))
		// If we can't check the whitelist, allow the OTP to proceed (fail open)
	}

	var otp = Math.floor(100000 + Math.random() * 900000).toString()"""

if old_pattern in bot_content:
    bot_content = bot_content.replace(old_pattern, new_pattern)
    with open(bot_path, "w") as f:
        f.write(bot_content)
    print("FIX 2: Added email whitelist check to handleEmailOtpLogin()")
else:
    print("WARN 2: Could not find old pattern in telegramBot.js")
    # Debug: show context around the function
    idx = bot_content.find("var emailRegex")
    if idx != -1:
        print("  Found 'var emailRegex' at position", idx)
        print("  Context:", repr(bot_content[idx:idx+500]))
    else:
        print("  Could not find 'var emailRegex' in file")


print("\\nDone!")
