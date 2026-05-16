#!/usr/bin/env python3
"""
Fix telegramBot.js: Add email whitelist check in handleEmailOtpLogin()
Inserts whitelist check after email validation, before OTP generation.
"""

import re

bot_path = "/opt/superroo2/cloud/api/telegramBot.js"

with open(bot_path, "r") as f:
    content = f.read()

# Find the exact insertion point: after the email validation block
# The pattern is: pendingEmailOtps.delete(chatId)\n\t\treturn\n\t}\n\n\t// Generate a 6-digit OTP
# We need to insert the whitelist check between the closing } and // Generate

old_block = """	// Generate a 6-digit OTP
\tvar otp = Math.floor(100000 + Math.random() * 900000).toString()"""

new_block = """	// ── Email whitelist check ──
\t// Only allow emails registered in SuperRoo Cloud auth store
\ttry {
\t\tvar fs = require("fs")
\t\tvar usersPath = __dirname + "/../data/auth/users.json"
\t\tvar usersData = JSON.parse(fs.readFileSync(usersPath, "utf8"))
\t\tvar whitelistedEmails = Object.values(usersData).map(function(u) { return u.email.toLowerCase() })
\t\tvar isWhitelisted = whitelistedEmails.indexOf(email.toLowerCase()) !== -1

\t\tif (!isWhitelisted) {
\t\t\tvar whitelistStr = whitelistedEmails.map(function(e) { return "  - `" + e + "`" }).join("\\\\n")
\t\t\tawait sendMessage(
\t\t\t\tbotToken,
\t\t\t\tchatId,
\t\t\t\t"*Email Not Registered* ❌\\\\n\\\\nThe email `" + email + "` is not registered in SuperRoo Cloud.\\\\n\\\\nOnly registered users can receive OTP codes.\\\\n\\\\n*Registered emails:*\\\\n" + whitelistStr + "\\\\n\\\\nPlease register at the SuperRoo Cloud dashboard first, then use `/login` again."
\t\t\t)
\t\t\tpendingEmailOtps.delete(chatId)
\t\t\treturn
\t\t}
\t} catch (err) {
\t\tconsole.error("[telegram] Failed to check email whitelist: " + (err.message || err))
\t\t// If we can't check the whitelist, allow OTP to proceed (fail open)
\t}

\t// Generate a 6-digit OTP
\tvar otp = Math.floor(100000 + Math.random() * 900000).toString()"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open(bot_path, "w") as f:
        f.write(content)
    print("SUCCESS: Email whitelist check inserted into handleEmailOtpLogin()")
else:
    print("ERROR: Could not find target pattern")
    # Debug: show the actual content around that area
    idx = content.find("Generate a 6-digit OTP")
    if idx != -1:
        print("Found 'Generate a 6-digit OTP' at", idx)
        print("Context:", repr(content[idx-50:idx+100]))
    else:
        print("Could not find 'Generate a 6-digit OTP'")
        # Try to find the function
        idx2 = content.find("handleEmailOtpLogin")
        if idx2 != -1:
            print("Found handleEmailOtpLogin at", idx2)
            print("Context:", repr(content[idx2:idx2+800]))
