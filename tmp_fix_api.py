with open('/opt/superroo2/cloud/api/api.js', 'r') as f:
    lines = f.readlines()

# The upgrade handler is at lines 1476-1490 (0-indexed: 1475-1489)
# Extract it
upgrade_block = lines[1475:1490]

# Remove it from original position
lines = lines[:1475] + lines[1490:]

# Find listenWithRetry(server, PORT) - insert upgrade handler before this line
insert_before = None
for i, line in enumerate(lines):
    if 'listenWithRetry(server, PORT)' in line:
        insert_before = i
        break

print(f"Inserting upgrade handler before line {insert_before+1}")

# Insert the upgrade handler before listenWithRetry
result = lines[:insert_before] + upgrade_block + lines[insert_before:]

with open('/opt/superroo2/cloud/api/api.js', 'w') as f:
    f.writelines(result)

print('Done - fix applied successfully')
