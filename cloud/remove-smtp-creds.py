#!/usr/bin/env python3
"""Remove SMTP credentials from ecosystem.config.js"""
import re

path = "/opt/superroo2/cloud/ecosystem.config.js"
with open(path, 'r') as f:
    content = f.read()

# Remove the 5 SMTP lines (they appear after TELEGRAM_BOT_TOKEN)
# Pattern: 5 lines of SMTP_* followed by a newline
content = re.sub(
    r'\t\t\t\tSMTP_HOST: .*\n\t\t\t\tSMTP_PORT: .*\n\t\t\t\tSMTP_USER: .*\n\t\t\t\tSMTP_PASS: .*\n\t\t\t\tSMTP_FROM: .*\n',
    '',
    content
)

with open(path, 'w') as f:
    f.write(content)
print("Removed SMTP credentials")

import subprocess
r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
if r.returncode != 0:
    print("Syntax error:", r.stderr)
else:
    print("Syntax OK")
