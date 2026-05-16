#!/usr/bin/env python3
"""
Fix Email OTP sending — updates telegramBot.js to use nodemailer with Gmail SMTP.
Also adds SMTP environment variables to ecosystem.config.js.
"""
import re
import sys

def fix_telegram_bot(content):
    """Replace the handleEmailOtpLogin function to actually send email via nodemailer."""
    
    # Find the handleEmailOtpLogin function
    old_func_start = "async function handleEmailOtpLogin(botToken, chatId, email, telegramUserId) {"
    
    # Find where this function starts
    idx = content.find(old_func_start)
    if idx == -1:
        print("ERROR: Could not find handleEmailOtpLogin function")
        return None
    
    # Find the end of the function (next function or end of block)
    # We need to find the closing brace at the right indentation level
    rest = content[idx:]
    lines = rest.split('\n')
    
    # Find the function end - look for the next top-level function or end of content
    end_idx = -1
    brace_count = 0
    func_started = False
    for i, line in enumerate(lines):
        if i == 0:
            func_started = True
            continue
        stripped = line.strip()
        if func_started:
            # Count braces
            for ch in line:
                if ch == '{':
                    brace_count += 1
                elif ch == '}':
                    brace_count -= 1
            if brace_count == 0 and stripped == '}':
                end_idx = idx + sum(len(lines[j]) + 1 for j in range(i + 1))
                break
    
    if end_idx == -1:
        print("ERROR: Could not find end of handleEmailOtpLogin function")
        return None
    
    new_func = """async function handleEmailOtpLogin(botToken, chatId, email, telegramUserId) {
\t// Basic email validation
\tvar emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
\tif (!emailRegex.test(email)) {
\t\tawait sendMessage(
\t\t\tbotToken,
\t\t\tchatId,
\t\t\t"*Invalid Email* ❌\\n\\nPlease enter a valid email address (e.g., `user@example.com`).\\n\\nUse `/login` to try again.",
\t\t)
\t\tpendingEmailOtps.delete(chatId)
\t\treturn
\t}

\t// Generate a 6-digit OTP
\tvar otp = Math.floor(100000 + Math.random() * 900000).toString()

\t// Store the pending OTP
\tvar state = pendingEmailOtps.get(chatId) || { step: "awaiting_email", messageIds: [] }
\tstate.step = "awaiting_otp"
\tstate.email = email
\tstate.otp = otp
\tstate.createdAt = Date.now()
\tstate.telegramUserId = telegramUserId
\tpendingEmailOtps.set(chatId, state)

\tconsole.log("[telegram] Email OTP generated for " + email + " (chat " + chatId + "): " + otp)

\t// Send the OTP via email using nodemailer
\ttry {
\t\tvar nodemailer = require("nodemailer")
\t\tvar transporter = nodemailer.createTransport({
\t\t\thost: process.env.SMTP_HOST || "smtp.gmail.com",
\t\t\tport: parseInt(process.env.SMTP_PORT || "587"),
\t\t\tsecure: false,
\t\t\tauth: {
\t\t\t\tuser: process.env.SMTP_USER,
\t\t\t\tpass: process.env.SMTP_PASS,
\t\t\t},
\t\t})
\t\tvar mailResult = await transporter.sendMail({
\t\t\tfrom: process.env.SMTP_FROM || process.env.SMTP_USER,
\t\t\tto: email,
\t\t\tsubject: "Your SuperRoo Cloud Login OTP",
\t\t\ttext: "Your one-time password (OTP) for SuperRoo Cloud login is:\\n\\n" + otp + "\\n\\nThis code expires in 10 minutes.\\n\\nIf you did not request this, please ignore this email.",
\t\t\thtml: "<div style=\\"font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;\\">\\n  <h2 style=\\"color: #333;\\">SuperRoo Cloud Login</h2>\\n  <p style=\\"color: #555; font-size: 14px;\\">Your one-time password (OTP):</p>\\n  <div style=\\"background: #f5f5f5; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0;\\">\\n    <span style=\\"font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;\\">" + otp + "</span>\\n  </div>\\n  <p style=\\"color: #888; font-size: 12px;\\">This code expires in 10 minutes.</p>\\n  <hr style=\\"border: none; border-top: 1px solid #eee; margin: 16px 0;\\">\\n  <p style=\\"color: #aaa; font-size: 11px;\\">If you did not request this, please ignore this email.</p>\\n</div>",
\t\t})
\t\tconsole.log("[telegram] OTP email sent to " + email + " (messageId: " + mailResult.messageId + ")")
\t\t
\t\tvar sentMsg = await sendMessage(
\t\t\tbotToken,
\t\t\tchatId,
\t\t\t"*OTP Sent* 📧\\n\\nA one-time password has been sent to `" +
\t\t\t\temail +
\t\t\t\t"`.\\n\\nPlease check your inbox and enter the 6-digit code to complete login.\\n\\n_(The code expires in 10 minutes. Messages will be auto-deleted after login.)_\\n\\nUse `/cancel` to abort.",
\t\t)
\t\tif (sentMsg && sentMsg.result && sentMsg.result.message_id) {
\t\t\tstate.messageIds.push(sentMsg.result.message_id)
\t\t\tpendingEmailOtps.set(chatId, state)
\t\t}
\t} catch (err) {
\t\tconsole.error("[telegram] Failed to send OTP email to " + email + ": " + (err.message || err))
\t\t// Fallback: show OTP in chat if email fails
\t\tvar sentMsg = await sendMessage(
\t\t\tbotToken,
\t\t\tchatId,
\t\t\t"*OTP Generated* 📧\\n\\nCould not send email to `" +
\t\t\t\temail +
\t\t\t\t"`.\\n\\n*Your OTP:* `" +
\t\t\t\totp +
\t\t\t\t"`\\n\\nPlease enter the 6-digit code above to complete login.\\n\\n_(The code expires in 10 minutes. Messages will be auto-deleted after login.)_\\n\\nUse `/cancel` to abort.",
\t\t)
\t\tif (sentMsg && sentMsg.result && sentMsg.result.message_id) {
\t\t\tstate.messageIds.push(sentMsg.result.message_id)
\t\t\tpendingEmailOtps.set(chatId, state)
\t\t}
\t}
}
"""
    
    new_content = content[:idx] + new_func + content[end_idx:]
    return new_content


def fix_ecosystem(content):
    """Add SMTP environment variables to the superroo-api app in ecosystem.config.js."""
    
    # Find the env block for superroo-api
    # Look for TELEGRAM_BOT_TOKEN line and add SMTP vars after it
    pattern = r'(TELEGRAM_BOT_TOKEN:\s*"[^"]*",)'
    replacement = r'\1\n\t\t\t\tSMTP_HOST: "smtp.gmail.com",\n\t\t\t\tSMTP_PORT: "587",\n\t\t\t\tSMTP_USER: "marketing.homeu1@gmail.com",\n\t\t\t\tSMTP_PASS: "ikot frcv srsi tfoq",\n\t\t\t\tSMTP_FROM: "marketing.homeu1@gmail.com",'
    
    new_content = re.sub(pattern, replacement, content)
    if new_content == content:
        print("ERROR: Could not find TELEGRAM_BOT_TOKEN in ecosystem config")
        return None
    return new_content


def main():
    import os
    
    # Fix telegramBot.js
    bot_path = "/opt/superroo2/cloud/api/telegramBot.js"
    with open(bot_path, 'r', encoding='utf-8') as f:
        bot_content = f.read()
    
    new_bot = fix_telegram_bot(bot_content)
    if new_bot is None:
        sys.exit(1)
    
    with open(bot_path, 'w', encoding='utf-8') as f:
        f.write(new_bot)
    print("✅ Updated telegramBot.js - handleEmailOtpLogin now uses nodemailer")
    
    # Fix ecosystem.config.js
    eco_path = "/opt/superroo2/cloud/ecosystem.config.js"
    with open(eco_path, 'r', encoding='utf-8') as f:
        eco_content = f.read()
    
    new_eco = fix_ecosystem(eco_content)
    if new_eco is None:
        sys.exit(1)
    
    with open(eco_path, 'w', encoding='utf-8') as f:
        f.write(new_eco)
    print("✅ Updated ecosystem.config.js - added SMTP env vars")
    
    # Verify syntax
    import subprocess
    result = subprocess.run(["node", "--check", bot_path], capture_output=True, text=True)
    if result.returncode != 0:
        print("❌ Syntax error in telegramBot.js:", result.stderr)
        sys.exit(1)
    print("✅ telegramBot.js syntax OK")
    
    result = subprocess.run(["node", "--check", eco_path], capture_output=True, text=True)
    if result.returncode != 0:
        print("❌ Syntax error in ecosystem.config.js:", result.stderr)
        sys.exit(1)
    print("✅ ecosystem.config.js syntax OK")


if __name__ == "__main__":
    main()
