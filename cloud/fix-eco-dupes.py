#!/usr/bin/env python3
"""Remove duplicate SMTP env vars from mini-ide section of ecosystem.config.js"""
import re

path = "/opt/superroo2/cloud/ecosystem.config.js"
with open(path, 'r') as f:
    content = f.read()

# Remove the duplicate SMTP block from mini-ide section
# Pattern: SMTP_HOST through SMTP_FROM lines followed by }, log_file for mini-ide
old_block = '''\t\t\t\tSMTP_HOST: "smtp.gmail.com",
\t\t\t\tSMTP_PORT: "587",
\t\t\t\tSMTP_USER: "marketing.homeu1@gmail.com",
\t\t\t\tSMTP_PASS: "ikot frcv srsi tfoq",
\t\t\t\tSMTP_FROM: "marketing.homeu1@gmail.com",
\t\t\t},
\t\t\tlog_file: "/opt/superroo2/cloud/logs/mini-ide-combined.log",'''

new_block = '''\t\t\t},
\t\t\tlog_file: "/opt/superroo2/cloud/logs/mini-ide-combined.log",'''

if old_block in content:
    content = content.replace(old_block, new_block, 1)
    with open(path, 'w') as f:
        f.write(content)
    print("Removed duplicate SMTP vars from mini-ide section")
else:
    print("Pattern not found - checking...")
    # Debug: find mini-ide section
    idx = content.find("mini-ide-combined.log")
    print(f"Context around mini-ide log_file: ...{content[idx-200:idx+50]}...")

import subprocess
r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
if r.returncode != 0:
    print("Syntax error:", r.stderr)
else:
    print("Syntax OK")
