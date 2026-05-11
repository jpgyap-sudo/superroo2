#!/usr/bin/env python3
"""Fix the literal \n issue in api.js and verify the route."""

with open('/opt/superroo2/cloud/api/api.js', 'r') as f:
    content = f.read()

# Remove literal '\n' at the start of the inserted block
content = content.replace('\\n\t\t// ── Telegram Mini App', '\t\t// ── Telegram Mini App')

with open('/opt/superroo2/cloud/api/api.js', 'w') as f:
    f.write(content)

print('Fixed literal \\n in api.js')

# Verify
with open('/opt/superroo2/cloud/api/api.js', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'Telegram Mini App' in line:
        print(f'Line {i+1}: {repr(line)}')
