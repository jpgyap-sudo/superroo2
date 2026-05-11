#!/usr/bin/env python3
"""Fix telegramBot.js: silently ignore unauthorized users, add reply_to_message check."""

import re

with open('cloud/api/telegramBot.js', 'r') as f:
    content = f.read()

# 1. Change boss-only guard to silently ignore unauthorized users
old_boss_guard = """\t// ─── Boss-Only Guard ────────────────────────────────────────────────
\t// Only @jpgy888 (boss) can use the bot. Others get a polite rejection.
\tvar senderUsername = (msg.from && msg.from.username) || \"\"
\tif (senderUsername.toLowerCase() !== BOSS_USERNAME.toLowerCase()) {
\t\tawait sendMessage(
\t\t\tbotToken,
\t\t\tchatId,
\t\t\t\"*Access Restricted* 🔒\\n\\nThis bot is configured for private use only. If you believe this is an error, please contact the administrator.\",
\t\t)
\t\treturn
\t}"""

new_boss_guard = """\t// ─── Boss-Only Guard ────────────────────────────────────────────────
\t// Only @jpgy888 (boss) can use the bot. Others are silently ignored.
\tvar senderUsername = (msg.from && msg.from.username) || \"\"
\tif (senderUsername.toLowerCase() !== BOSS_USERNAME.toLowerCase()) {
\t\t// Silently ignore unauthorized users
\t\treturn
\t}"""

content = content.replace(old_boss_guard, new_boss_guard)

# 2. Add reply_to_message check for group chats
old_group_check = """\tif (isGroup) {
\t\t// Check for @superroo_bot mention OR /command@superroo_bot format
\t\tfor (var i = 0; i < entities.length; i++) {
\t\t\tvar entity = entities[i]
\t\t\tif (entity.type === \"mention\") {
\t\t\t\tvar mention = text.slice(entity.offset, entity.offset + entity.length)
\t\t\t\tif (mention.toLowerCase() === \"@\" + BOT_USERNAME.toLowerCase()) {
\t\t\t\t\tbotMentioned = true
\t\t\t\t\tbreak
\t\t\t\t}
\t\t\t}
\t\t\t// Handle /command@superroo_bot (bot_command entity containing the bot username)
\t\t\tif (entity.type === \"bot_command\") {
\t\t\t\tvar cmdText = text.slice(entity.offset, entity.offset + entity.length)
\t\t\t\tif (cmdText.toLowerCase().includes(\"@\" + BOT_USERNAME.toLowerCase())) {
\t\t\t\t\tbotMentioned = true
\t\t\t\t\tbreak
\t\t\t\t}
\t\t\t}
\t\t}
\t\t// In groups, only respond if explicitly mentioned
\t\tif (!botMentioned) return"""

new_group_check = """\tif (isGroup) {
\t\t// Check for @superroo_bot mention OR /command@superroo_bot format
\t\tfor (var i = 0; i < entities.length; i++) {
\t\t\tvar entity = entities[i]
\t\t\tif (entity.type === \"mention\") {
\t\t\t\tvar mention = text.slice(entity.offset, entity.offset + entity.length)
\t\t\t\tif (mention.toLowerCase() === \"@\" + BOT_USERNAME.toLowerCase()) {
\t\t\t\t\tbotMentioned = true
\t\t\t\t\tbreak
\t\t\t\t}
\t\t\t}
\t\t\t// Handle /command@superroo_bot (bot_command entity containing the bot username)
\t\t\tif (entity.type === \"bot_command\") {
\t\t\t\tvar cmdText = text.slice(entity.offset, entity.offset + entity.length)
\t\t\t\tif (cmdText.toLowerCase().includes(\"@\" + BOT_USERNAME.toLowerCase())) {
\t\t\t\t\tbotMentioned = true
\t\t\t\t\tbreak
\t\t\t\t}
\t\t\t}
\t\t}
\t\t// Also respond if replying to a bot message
\t\tif (!botMentioned && msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.is_bot) {
\t\t\tbotMentioned = true
\t\t}
\t\t// In groups, only respond if explicitly mentioned or replying to bot
\t\tif (!botMentioned) return"""

content = content.replace(old_group_check, new_group_check)

with open('cloud/api/telegramBot.js', 'w') as f:
    f.write(content)

print('Done - telegramBot.js updated')
