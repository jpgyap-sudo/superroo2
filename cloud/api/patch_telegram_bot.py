#!/usr/bin/env python3
"""
Patch script for telegramBot.js and api.js on the VPS.

Changes:
1. sendMessage: fallback to plain text when Markdown parsing fails
2. Boss-only guard: use Telegram User ID (8485794779) instead of username
3. handleLogin group message: use plain text to avoid markdown parsing issues
4. api.js: add GET /telegram-miniapp route to serve the Mini App HTML page
"""

import re
import sys

def patch_telegram_bot(content):
    """Apply all fixes to telegramBot.js"""
    lines = content.split('\n')
    new_lines = []
    changes = []
    
    i = 0
    while i < len(lines):
        line = lines[i]
        line_num = i + 1
        
        # Fix 1: sendMessage - add fallback when Markdown parsing fails
        if 'async function sendMessage(botToken, chatId, text, opts)' in line:
            new_lines.append(line)
            i += 1
            # Copy lines until we find the fetch call
            while i < len(lines):
                new_lines.append(lines[i])
                # After the fetch call with POST, add fallback logic
                if 'const res = await fetch(url, {' in lines[i]:
                    # We need to add fallback after the error handling
                    pass
                i += 1
            continue
        
        # Fix 2: Boss-only guard - use Telegram User ID
        if "var senderUsername = (msg.from && msg.from.username) || \"\"" in line:
            new_lines.append('	// Use Telegram User ID for boss check (more reliable than username)')
            new_lines.append('	var senderId = msg.from ? msg.from.id : null')
            new_lines.append('	var BOSS_TELEGRAM_ID = 8485794779  // jpgy888\'s Telegram user ID')
            changes.append(f"Line {line_num}: Changed boss guard to use Telegram ID")
            i += 1
            continue
            
        if 'if (senderUsername.toLowerCase() !== BOSS_USERNAME.toLowerCase()) {' in line:
            new_lines.append('	if (!senderId || senderId !== BOSS_TELEGRAM_ID) {')
            changes.append(f"Line {line_num}: Changed boss guard condition to check ID")
            i += 1
            continue
        
        # Fix 3: handleLogin group message - use plain text to avoid markdown parsing issues
        if '"*Login Required* 🔐\\n\\nTap below to open a private chat with @"' in line:
            new_lines.append('		"Login Required 🔐\\n\\nTap below to open a private chat with @" +')
            changes.append(f"Line {line_num}: Changed group login message to plain text")
            i += 1
            continue
        
        if '" and log in there.\\n\\nOnce logged in via DM, all your commands in this group will be authenticated."' in line:
            new_lines.append('			" and log in there.\\n\\nOnce logged in via DM, all your commands in this group will be authenticated."')
            changes.append(f"Line {line_num}: Changed group login message to plain text")
            i += 1
            continue
        
        new_lines.append(line)
        i += 1
    
    return '\n'.join(new_lines), changes


def patch_send_message_fallback(content):
    """Add Markdown fallback to sendMessage function"""
    # Find the sendMessage function and add retry logic
    pattern = r'(\t\ttry \{\n\t\t\tconst res = await fetch\(url, \{\n\t\t\t\tmethod: "POST",\n\t\t\t\theaders: \{ "Content-Type": "application\/json" \},\n\t\t\t\tbody: JSON\.stringify\(body\),\n\t\t\t\}\)\n\t\t\tif \(!res\.ok\) \{\n\t\t\t\tconst err = await res\.text\(\)\.catch\(function \(\) \{\n\t\t\t\t\treturn ""\n\t\t\t\t\}\)\n\t\t\t\tconsole\.error\("\[telegram\] sendMessage error: " \+ res\.status \+ " " \+ err\.slice\(0, 200\)\)\n\t\t\t\}\)?)'
    
    replacement = r'''		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			if (!res.ok) {
				const err = await res.text().catch(function () {
					return ""
				})
				// If Markdown parsing fails, retry without parse_mode
				if (res.status === 400 && err.indexOf("can't parse entities") !== -1) {
					console.log("[telegram] Markdown parse failed, retrying without parse_mode")
					delete body.parse_mode
					const retryRes = await fetch(url, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					})
					if (!retryRes.ok) {
						const retryErr = await retryRes.text().catch(function() { return "" })
						console.error("[telegram] sendMessage retry error: " + retryRes.status + " " + retryErr.slice(0, 200))
					}
					return
				}
				console.error("[telegram] sendMessage error: " + res.status + " " + err.slice(0, 200))
			}'''
    
    return re.sub(pattern, replacement, content, flags=re.DOTALL)


def patch_api_js(content):
    """Add /telegram-miniapp route to api.js"""
    # Find the telegram webhook section and add the mini app route before it
    pattern = r'(\t\t// ── Telegram Bot Routes ────────────────────────────────────────────────)'
    replacement = r'''		// ── Telegram Mini App ────────────────────────────────────────────────────

		// GET /telegram-miniapp — serve the Telegram Mini App login page
		if (method === "GET" && (url === "/telegram-miniapp" || normalizedUrl === "/telegram-miniapp")) {
			const fs = require("fs")
			const path = require("path")
			const miniAppPath = path.join(__dirname, "telegram-miniapp.html")
			try {
				const html = fs.readFileSync(miniAppPath, "utf8")
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
				res.end(html)
			} catch (err) {
				console.error("[api] Failed to read telegram-miniapp.html:", err.message)
				sendJson(res, 404, { error: "Mini App page not found" })
			}
			return
		}

		\1'''
    
    return re.sub(pattern, replacement, content, flags=re.DOTALL)


def main():
    import os
    
    # Read telegramBot.js
    bot_path = '/opt/superroo2/cloud/api/telegramBot.js'
    api_path = '/opt/superroo2/cloud/api/api.js'
    
    if not os.path.exists(bot_path):
        print(f"ERROR: {bot_path} not found")
        sys.exit(1)
    if not os.path.exists(api_path):
        print(f"ERROR: {api_path} not found")
        sys.exit(1)
    
    with open(bot_path, 'r') as f:
        bot_content = f.read()
    
    # Apply fixes
    bot_content, changes = patch_telegram_bot(bot_content)
    bot_content = patch_send_message_fallback(bot_content)
    
    # Write back
    with open(bot_path, 'w') as f:
        f.write(bot_content)
    
    print("=== telegramBot.js changes ===")
    for c in changes:
        print(f"  {c}")
    
    # Patch api.js
    with open(api_path, 'r') as f:
        api_content = f.read()
    
    api_content = patch_api_js(api_content)
    
    with open(api_path, 'w') as f:
        f.write(api_content)
    
    print("\n=== api.js changes ===")
    print("  Added GET /telegram-miniapp route")
    
    print("\n=== Done ===")

if __name__ == '__main__':
    main()
