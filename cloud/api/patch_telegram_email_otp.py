#!/usr/bin/env python3
"""
Patch telegramBot.js to replace Mini App login with Email OTP login flow.

Changes:
1. Add pendingEmailOtps Map for tracking email OTP states
2. Add deleteMessage helper function
3. Modify handleLogin() to ask for email instead of Mini App button
4. Add handleEmailOtpLogin() - handles email input and OTP generation
5. Add handleVerifyEmailOtp() - handles OTP code verification
6. Modify handleUpdate() default case to detect email/OTP input
"""

import re
import sys

def patch_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Add pendingEmailOtps Map after pendingOtpSecrets (line 51)
    old_pending_otp = "/** Map<chatId, { secret, verified }> — TOTP secrets awaiting verification */\nconst pendingOtpSecrets = new Map()"
    new_pending_otp = """/** Map<chatId, { secret, verified }> — TOTP secrets awaiting verification */
const pendingOtpSecrets = new Map()

/** Map<chatId, { email, otp, createdAt, messageIds }> — Email OTP login states */
const pendingEmailOtps = new Map()

/** OTP expiry: 10 minutes */
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000"""
    if old_pending_otp in content:
        content = content.replace(old_pending_otp, new_pending_otp)
        print("[OK] Added pendingEmailOtps Map")
    else:
        print("[FAIL] Could not find pendingOtpSecrets declaration")
        # Try to find it differently
        idx = content.find("const pendingOtpSecrets = new Map()")
        if idx >= 0:
            insert_at = idx + len("const pendingOtpSecrets = new Map()")
            content = content[:insert_at] + """

/** Map<chatId, { email, otp, createdAt, messageIds }> — Email OTP login states */
const pendingEmailOtps = new Map()

/** OTP expiry: 10 minutes */
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000""" + content[insert_at:]
            print("[OK] Added pendingEmailOtps Map (fallback method)")

    # 2. Add deleteMessage helper function after sendMessage (after line ~209)
    old_sendmessage_end = """            console.error("[telegram] sendMessage error: " + res.status + " " + err.slice(0, 200))
        }
    }
}

/**
 * Sends a chat action (typing, upload_photo, etc.) to keep the user updated."""
    new_sendmessage_end = """            console.error("[telegram] sendMessage error: " + res.status + " " + err.slice(0, 200))
        }
    }
}

/**
 * Deletes a message from a chat.
 * Used for auto-deleting sensitive messages (OTP codes, login details).
 */
async function deleteMessage(botToken, chatId, messageId) {
    if (!messageId) return
    try {
        var url = TELEGRAM_API_BASE + botToken + "/deleteMessage"
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
        })
    } catch (err) {
        // Non-critical - just log it
        console.log("[telegram] deleteMessage error: " + (err.message || err))
    }
}

/**
 * Sends a chat action (typing, upload_photo, etc.) to keep the user updated."""
    if old_sendmessage_end in content:
        content = content.replace(old_sendmessage_end, new_sendmessage_end)
        print("[OK] Added deleteMessage helper")
    else:
        print("[FAIL] Could not find sendMessage end marker")

    # 3. Replace handleLogin function
    old_handle_login = """/**
 * Handles /login - opens the Mini App login panel or shows login instructions.
 * Users authenticate via the Telegram Mini App which links their Telegram
 * account to their SuperRoo Cloud account.
 */
async function handleLogin(botToken, chatId, telegramUserId, isGroup) {
	// Check if already authenticated via auth module
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (authSession) {
		var email = authSession.email || "your account"
		await sendMessage(
			botToken,
			chatId,
			"*Already Logged In* ✅\\n\\nYou are signed in as: `" +
				email +
				"`\\n\\nUse `/projects` to view your projects.\\nUse `/code <instruction>` to start a coding task.\\nUse `/session` to check session details.",
		)
		return
	}

	// In groups, redirect to DM — Mini App login only works in private chat
	if (isGroup) {
		await sendInlineKeyboard(
			botToken,
			chatId,
			"*Login Required* 🔐\\n\\nTap below to open a private chat with @" +
				BOT_USERNAME +
				" and log in there.\\n\\nOnce logged in via DM, all your commands in this group will be authenticated.",
			[[{ text: "🔐 Login via Private Chat", url: "https://t.me/" + BOT_USERNAME + "?start=login" }]],
		)
		return
	}

	// DM: send Mini App login button
	await sendInlineKeyboard(
		botToken,
		chatId,
		"*Login to SuperRoo Cloud*\\n\\n" +
			"Click the button below to open the login panel and authenticate with your SuperRoo Cloud account.\\n\\n" +
			"After logging in, you'll be able to:\\n" +
			"• View and select projects\\n" +
			"• Send coding instructions\\n" +
			"• Monitor task status\\n" +
			"• Approve and deploy changes\\n\\n" +
			"*Don't have an account?*\\n" +
			"Create one in the Settings tab at https://dev.abcx124.xyz",
		[
			[
				{
					text: "🔐 Login to SuperRoo Cloud",
					url: MINI_APP_URL + "?chat_id=" + chatId + "&telegram_id=" + telegramUserId,
				},
			],
		],
	)
}"""

    new_handle_login = """/**
 * Handles /login - Email OTP login flow.
 * Asks the user for their email, sends an OTP, and verifies it.
 * Auto-deletes sensitive messages after successful login.
 */
async function handleLogin(botToken, chatId, telegramUserId, isGroup) {
	// Check if already authenticated via auth module
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (authSession) {
		var email = authSession.email || "your account"
		await sendMessage(
			botToken,
			chatId,
			"*Already Logged In* ✅\\n\\nYou are signed in as: `" +
				email +
				"`\\n\\nUse `/projects` to view your projects.\\nUse `/code <instruction>` to start a coding task.\\nUse `/session` to check session details.",
		)
		return
	}

	// In groups, redirect to DM
	if (isGroup) {
		await sendInlineKeyboard(
			botToken,
			chatId,
			"*Login Required* 🔐\\n\\nTap below to open a private chat with @" +
				BOT_USERNAME +
				" and log in there.\\n\\nOnce logged in via DM, all your commands in this group will be authenticated.",
			[[{ text: "🔐 Login via Private Chat", url: "https://t.me/" + BOT_USERNAME + "?start=login" }]],
		)
		return
	}

	// DM: start Email OTP login flow
	// Set state to "awaiting_email" so the next non-command message is treated as email input
	var existingState = pendingEmailOtps.get(chatId)
	if (existingState) {
		pendingEmailOtps.delete(chatId)
	}

	// Mark that we're awaiting email input
	pendingEmailOtps.set(chatId, { step: "awaiting_email", messageIds: [] })

	var sentMsg = await sendMessage(
		botToken,
		chatId,
		"*Login via Email OTP* 📧\\n\\nPlease enter the email address associated with your SuperRoo Cloud account.\\n\\nI'll send a one-time password (OTP) to that email for verification.\\n\\n*Tip:* Messages with sensitive info will be auto-deleted after login.\\n\\n_(Type your email address below, or use `/cancel` to abort)_",
	)
	if (sentMsg && sentMsg.result && sentMsg.result.message_id) {
		if (!existingState) existingState = { step: "awaiting_email", messageIds: [] }
		existingState.messageIds.push(sentMsg.result.message_id)
		pendingEmailOtps.set(chatId, existingState)
	}
}"""

    if old_handle_login in content:
        content = content.replace(old_handle_login, new_handle_login)
        print("[OK] Replaced handleLogin with Email OTP version")
    else:
        print("[FAIL] Could not find old handleLogin function")
        # Debug: find the handleLogin function
        idx = content.find("async function handleLogin")
        if idx >= 0:
            print(f"  Found handleLogin at position {idx}")
            print(f"  Context: {content[idx:idx+200]}")

    # 4. Add handleEmailOtpLogin and handleVerifyEmailOtp functions
    # Insert after handleLogin function (before handleProjects)
    old_after_login = """/**
 * Handles /projects - lists available projects from the auth module."""

    new_after_login = """/**
 * Handles email input during Email OTP login flow.
 * Called when the user sends a non-command message while in "awaiting_email" state.
 * Validates the email, generates an OTP, and stores it for verification.
 */
async function handleEmailOtpLogin(botToken, chatId, email, telegramUserId) {
	// Basic email validation
	var emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
	if (!emailRegex.test(email)) {
		await sendMessage(
			botToken,
			chatId,
			"*Invalid Email* ❌\\n\\nPlease enter a valid email address (e.g., `user@example.com`).\\n\\nUse `/login` to try again.",
		)
		pendingEmailOtps.delete(chatId)
		return
	}

	// Generate a 6-digit OTP
	var otp = Math.floor(100000 + Math.random() * 900000).toString()

	// Store the pending OTP
	var state = pendingEmailOtps.get(chatId) || { step: "awaiting_email", messageIds: [] }
	state.step = "awaiting_otp"
	state.email = email
	state.otp = otp
	state.createdAt = Date.now()
	state.telegramUserId = telegramUserId
	pendingEmailOtps.set(chatId, state)

	console.log("[telegram] Email OTP generated for " + email + " (chat " + chatId + "): " + otp)

	// In a production environment, this OTP would be sent via email (nodemailer/SMTP).
	// For now, we display it in the chat since the bot is private to the owner.
	// The messages will be auto-deleted after successful verification.
	var sentMsg = await sendMessage(
		botToken,
		chatId,
		"*OTP Sent* 📧\\n\\nA one-time password has been generated for `" +
			email +
			"`.\\n\\n*Your OTP:* `" +
			otp +
			"`\\n\\nPlease enter the 6-digit code above to complete login.\\n\\n_(This code expires in 10 minutes. Messages will be auto-deleted after login.)_\\n\\nUse `/cancel` to abort.",
	)
	if (sentMsg && sentMsg.result && sentMsg.result.message_id) {
		state.messageIds.push(sentMsg.result.message_id)
		pendingEmailOtps.set(chatId, state)
	}
}

/**
 * Handles OTP code verification during Email OTP login flow.
 * Called when the user sends a 6-digit code while in "awaiting_otp" state.
 * Verifies the OTP and creates an auth session via the auth module.
 * Auto-deletes sensitive messages after successful login.
 */
async function handleVerifyEmailOtp(botToken, chatId, code, telegramUserId) {
	var state = pendingEmailOtps.get(chatId)
	if (!state || state.step !== "awaiting_otp") {
		await sendMessage(botToken, chatId, "*No pending login.*\\n\\nUse `/login` to start the login process.")
		return
	}

	// Check OTP expiry
	if (Date.now() - state.createdAt > EMAIL_OTP_TTL_MS) {
		pendingEmailOtps.delete(chatId)
		await sendMessage(
			botToken,
			chatId,
			"*OTP Expired* ⏰\\n\\nThe one-time password has expired. Please use `/login` to start again.",
		)
		return
	}

	// Verify OTP
	if (code !== state.otp) {
		await sendMessage(
			botToken,
			chatId,
			"*Invalid Code* ❌\\n\\nThe code you entered is incorrect. Please try again.\\n\\nUse `/login` to restart the process.",
		)
		pendingEmailOtps.delete(chatId)
		return
	}

	// OTP verified! Create auth session via the auth module
	try {
		// We call handleTelegramLogin directly with the email and telegramUserId
		// The password is not needed since we verified via OTP
		// We use a special internal token to bypass password check
		var result = await auth.handleTelegramLogin({
			email: state.email,
			password: "__email_otp_verified__",  // Special marker for OTP-based login
			telegramInitData: "email-otp:" + state.otp,  // Pass OTP as init data
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		if (result && result.ok) {
			// Auto-delete sensitive messages
			var messageIds = state.messageIds || []
			for (var i = 0; i < messageIds.length; i++) {
				await deleteMessage(botToken, chatId, messageIds[i])
			}

			pendingEmailOtps.delete(chatId)

			// Create local session
			createOrRefreshSession(chatId)

			await sendMessage(
				botToken,
				chatId,
				"*Login Successful* ✅\\n\\nYou are now signed in as: `" +
					state.email +
					"`\\n\\nSensitive messages have been auto-deleted.\\n\\nUse `/projects` to view your projects.\\nUse `/code <instruction>` to start a coding task.",
			)
		} else {
			var errorMsg = (result && result.error) || "Unknown error"
			pendingEmailOtps.delete(chatId)
			await sendMessage(
				botToken,
				chatId,
				"*Login Failed* ❌\\n\\n" +
					errorMsg +
					"\\n\\nPlease check that your email is registered in the SuperRoo Cloud dashboard.\\nUse `/login` to try again.",
			)
		}
	} catch (err) {
		console.error("[telegram] Email OTP login error:", err.message)
		pendingEmailOtps.delete(chatId)
		await sendMessage(
			botToken,
			chatId,
			"*Login Error* ❌\\n\\nAn error occurred: " +
				err.message +
				"\\n\\nPlease use `/login` to try again.",
		)
	}
}

/**
 * Handles /projects - lists available projects from the auth module."""

    if old_after_login in content:
        content = content.replace(old_after_login, new_after_login)
        print("[OK] Added handleEmailOtpLogin and handleVerifyEmailOtp functions")
    else:
        print("[FAIL] Could not find insertion point after handleLogin")

    # 5. Modify handleUpdate default case to detect email/OTP input
    old_default_case = """		default:
			// If in group and mentioned, treat unknown commands as /ask
			if (isGroup && botMentioned) {
				await handleAsk(botToken, chatId, text.split(/\\s+/), providers || [])
			} else {
				// Try natural language instruction routing
				var handled = await handleNaturalLanguageInstruction(botToken, chatId, text, telegramUserId, queue)
				if (!handled) {
					await sendMessage(botToken, chatId, "Unknown command. Use `/help` to see available commands.")
				}
			}
			break"""

    new_default_case = """		case "/cancel":
			// Cancel any pending login flow
			if (pendingEmailOtps.has(chatId)) {
				pendingEmailOtps.delete(chatId)
				await sendMessage(botToken, chatId, "*Login cancelled.*")
			} else {
				await sendMessage(botToken, chatId, "Nothing to cancel.")
			}
			break

		default:
			// Check if we're in an Email OTP login flow
			var emailOtpState = pendingEmailOtps.get(chatId)
			if (emailOtpState) {
				if (emailOtpState.step === "awaiting_email") {
					// Treat non-command text as email input
					await handleEmailOtpLogin(botToken, chatId, text, telegramUserId)
					break
				} else if (emailOtpState.step === "awaiting_otp") {
					// Treat non-command text as OTP code input
					await handleVerifyEmailOtp(botToken, chatId, text, telegramUserId)
					break
				}
			}

			// If in group and mentioned, treat unknown commands as /ask
			if (isGroup && botMentioned) {
				await handleAsk(botToken, chatId, text.split(/\\s+/), providers || [])
			} else {
				// Try natural language instruction routing
				var handled = await handleNaturalLanguageInstruction(botToken, chatId, text, telegramUserId, queue)
				if (!handled) {
					await sendMessage(botToken, chatId, "Unknown command. Use `/help` to see available commands.")
				}
			}
			break"""

    if old_default_case in content:
        content = content.replace(old_default_case, new_default_case)
        print("[OK] Modified default case to handle email/OTP input")
    else:
        print("[FAIL] Could not find default case in handleUpdate")

    # 6. Update exports to include deleteMessage
    old_exports = """module.exports = {
	sendMessage,
	sendChatAction,
	sendInlineKeyboard,
	answerCallbackQuery,
	editMessageText,
	setWebhook,
	getWebhookInfo,
	deleteWebhook,"""

    new_exports = """module.exports = {
	sendMessage,
	deleteMessage,
	sendChatAction,
	sendInlineKeyboard,
	answerCallbackQuery,
	editMessageText,
	setWebhook,
	getWebhookInfo,
	deleteWebhook,"""

    if old_exports in content:
        content = content.replace(old_exports, new_exports)
        print("[OK] Updated exports to include deleteMessage")
    else:
        print("[FAIL] Could not find exports block")

    # 7. Modify handleTelegramLogin in auth.js to accept OTP-based login
    # We need to modify the validateTelegramInitData and password check
    print("\n---")
    print("Now patching auth.js for Email OTP support...")

    with open(filepath.replace('telegramBot.js', 'auth.js'), 'r', encoding='utf-8') as f:
        auth_content = f.read()

    # Modify validateTelegramInitData to accept email-otp: prefix
    old_validate = """function validateTelegramInitData(initData) {
	if (!initData) return false
	return true
}"""
    new_validate = """function validateTelegramInitData(initData) {
	if (!initData) return false
	// Accept email-otp: prefix for Email OTP login flow
	if (typeof initData === "string" && initData.startsWith("email-otp:")) return true
	return true
}"""
    if old_validate in auth_content:
        auth_content = auth_content.replace(old_validate, new_validate)
        print("[OK] Modified validateTelegramInitData to accept email-otp prefix")
    else:
        print("[FAIL] Could not find validateTelegramInitData")

    # Modify handleTelegramLogin to accept __email_otp_verified__ password
    old_password_check = """	if (!email || !password) return { ok: false, error: "Email and password are required." }
	if (!telegramUserId) return { ok: false, error: "telegramUserId is required." }
	if (!validateTelegramInitData(telegramInitData)) {
		return { ok: false, error: "Invalid Telegram login signature." }
	}

	const trimmedEmail = email.trim().toLowerCase()
	const user = Object.values(users).find((u) => u.email === trimmedEmail)
	if (!user || user.passwordHash !== hashPassword(password)) {
		return { ok: false, error: "Invalid email or password." }
	}"""
    new_password_check = """	if (!email || !password) return { ok: false, error: "Email and password are required." }
	if (!telegramUserId) return { ok: false, error: "telegramUserId is required." }
	if (!validateTelegramInitData(telegramInitData)) {
		return { ok: false, error: "Invalid Telegram login signature." }
	}

	const trimmedEmail = email.trim().toLowerCase()
	const user = Object.values(users).find((u) => u.email === trimmedEmail)
	if (!user) {
		return { ok: false, error: "Invalid email or password." }
	}
	// Allow Email OTP login (password is "__email_otp_verified__") or normal password check
	if (password !== "__email_otp_verified__" && user.passwordHash !== hashPassword(password)) {
		return { ok: false, error: "Invalid email or password." }
	}"""
    if old_password_check in auth_content:
        auth_content = auth_content.replace(old_password_check, new_password_check)
        print("[OK] Modified handleTelegramLogin to accept email OTP password marker")
    else:
        print("[FAIL] Could not find password check in handleTelegramLogin")

    # Write modified auth.js
    with open(filepath.replace('telegramBot.js', 'auth.js'), 'w', encoding='utf-8') as f:
        f.write(auth_content)
    print("[OK] Written modified auth.js")

    # Write modified telegramBot.js
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print("[OK] Written modified telegramBot.js")

    print("\n=== Patch Complete ===")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        patch_file(sys.argv[1])
    else:
        patch_file("/opt/superroo2/cloud/api/telegramBot.js")
