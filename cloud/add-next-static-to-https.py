#!/usr/bin/env python3
"""Add /_next/static/ block to the Certbot-managed HTTPS nginx config."""
import re

CONFIG_PATH = "/etc/nginx/sites-enabled/dev.abcx124.xyz"

with open(CONFIG_PATH, "r") as f:
    content = f.read()

if "_next/static" in content:
    print("ALREADY_EXISTS")
    exit(0)

block = """    location /_next/static/ {
        alias /opt/superroo2/cloud/dashboard/.next/static/;
        expires 365d;
        add_header Cache-Control "public, immutable, max-age=31536000";
        access_log off;
    }
"""

# Insert before the first "location / {" block
content = content.replace("    location / {", block + "    location / {", 1)

with open(CONFIG_PATH, "w") as f:
    f.write(content)

print("ADDED")
