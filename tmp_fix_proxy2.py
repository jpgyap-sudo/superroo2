import re

with open('/opt/superroo2/cloud/api/api.js.bak', 'r') as f:
    content = f.read()

# Find the auth block
auth_start = content.find('if (await auth.handleAuthRoute(method, url, req, res)) {')
if auth_start < 0:
    print('ERROR: auth block not found')
    exit(1)

# Find the closing brace of the auth block
# Look for the pattern: return\n\t\t}\n\n\t\t// ── Healing Metrics
# The Healing Metrics line has unicode box-drawing chars, so search for "Healing Metrics"
healing_start = content.find('Healing Metrics', auth_start)
if healing_start < 0:
    print('ERROR: healing metrics not found')
    exit(1)

# Go back from healing_start to find the closing brace
auth_end = content.rfind('}', auth_start, healing_start)
if auth_end < 0:
    print('ERROR: auth end not found')
    exit(1)

# Find the start of the brain proxy blocks
brain_block_start = content.find('Brain /ask proxy', auth_start)
if brain_block_start < 0:
    print('ERROR: brain proxy start not found')
    exit(1)

# Go back to the beginning of the line
line_start = content.rfind('\n', 0, brain_block_start)
if line_start < 0:
    line_start = 0
else:
    line_start += 1  # skip the newline

# Extract the brain proxy blocks (from line_start to auth_end)
brain_block = content[line_start:auth_end+1]
print(f'Brain block: {len(brain_block)} chars from {line_start} to {auth_end}')

# Build new content:
# 1. Everything before auth_start
# 2. The brain proxy blocks
# 3. A blank line
# 4. The auth if block (without the brain proxies)
# 5. Everything after auth_end
auth_if_block = 'if (await auth.handleAuthRoute(method, url, req, res)) {\n\t\t\treturn\n\t\t}'

new_content = content[:auth_start] + brain_block + '\n\n' + auth_if_block + content[auth_end+1:]

with open('/opt/superroo2/cloud/api/api.js.new3', 'w') as f:
    f.write(new_content)

print('Done')
