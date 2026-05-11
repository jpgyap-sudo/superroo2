#!/usr/bin/env python3
"""Insert deleteMessage function into telegramBot.js"""

with open('/opt/superroo2/cloud/api/telegramBot.js', 'r') as f:
    content = f.read()

old = '''}

/**
 * Sends a chat action (typing indicator) to show the bot is processing.'''

new = '''}

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
 * Sends a chat action (typing indicator) to show the bot is processing.'''

if old in content:
    content = content.replace(old, new, 1)
    with open('/opt/superroo2/cloud/api/telegramBot.js', 'w') as f:
        f.write(content)
    print('[OK] Inserted deleteMessage function')
else:
    print('[FAIL] Could not find insertion point')
