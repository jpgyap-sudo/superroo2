#!/usr/bin/env python3
"""Add SMTP credentials to the superroo-api env section in ecosystem.config.js"""

import re

path = "/opt/superroo2/cloud/ecosystem.config.js"

with open(path, "r") as f:
    content = f.read()

# The SMTP vars to add after TELEGRAM_BOT_TOKEN in the superroo-api section
smtp_vars = """				SMTP_HOST: "smtp.gmail.com",
				SMTP_PORT: "587",
				SMTP_USER: "marketing.homeu1@gmail.com",
				SMTP_PASS: "qigg urgy nzes sqf",
				SMTP_FROM: "marketing.homeu1@gmail.com","""

# Find the TELEGRAM_BOT_TOKEN line in the superroo-api section and add SMTP vars after it
# The pattern: TELEGRAM_BOT_TOKEN: "..." line followed by a closing }
target = 'TELEGRAM_BOT_TOKEN: "8645986629:AAGFH6aC6y_F39dLfAB2q95-1s-kKALm0RQ",\n\t\t\t},'

if target in content:
    replacement = 'TELEGRAM_BOT_TOKEN: "8645986629:AAGFH6aC6y_F39dLfAB2q95-1s-kKALm0RQ",\n' + smtp_vars + '\n\t\t\t},'
    content = content.replace(target, replacement)
    with open(path, "w") as f:
        f.write(content)
    print("SUCCESS: SMTP credentials added to ecosystem.config.js")
else:
    print("ERROR: Could not find target pattern in ecosystem.config.js")
    # Debug: show what we're looking for vs what's there
    print("Looking for:", repr(target[:60]))
    # Find TELEGRAM_BOT_TOKEN line
    for i, line in enumerate(content.split("\n")):
        if "TELEGRAM_BOT_TOKEN" in line:
            print(f"Line {i+1}: {repr(line)}")
            # Show next few lines
            lines = content.split("\n")
            for j in range(i, min(i+5, len(lines))):
                print(f"  Line {j+1}: {repr(lines[j])}")
