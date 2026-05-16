#!/usr/bin/env python3
"""Patch sendMessage in telegramBot.js to add Markdown fallback."""

with open('/opt/superroo2/cloud/api/telegramBot.js', 'r') as f:
    content = f.read()

old = '''\t\tif (!res.ok) {
\t\t\tconst err = await res.text().catch(function () {
\t\t\t\treturn ""
\t\t\t})
\t\t\tconsole.error("[telegram] sendMessage error: " + res.status + " " + err.slice(0, 200))
\t\t}'''

new = '''\t\tif (!res.ok) {
\t\t\tconst err = await res.text().catch(function () {
\t\t\t\treturn ""
\t\t\t})
\t\t\t// If Markdown parsing fails, retry without parse_mode
\t\t\tif (res.status === 400 && err.indexOf("can't parse entities") !== -1) {
\t\t\t\tconsole.log("[telegram] Markdown parse failed, retrying without parse_mode")
\t\t\t\tdelete body.parse_mode
\t\t\t\tconst retryRes = await fetch(url, {
\t\t\t\t\tmethod: "POST",
\t\t\t\t\theaders: { "Content-Type": "application/json" },
\t\t\t\t\tbody: JSON.stringify(body),
\t\t\t\t})
\t\t\t\tif (!retryRes.ok) {
\t\t\t\t\tconst retryErr = await retryRes.text().catch(function() { return "" })
\t\t\t\t\tconsole.error("[telegram] sendMessage retry error: " + retryRes.status + " " + retryErr.slice(0, 200))
\t\t\t\t}
\t\t\t\treturn
\t\t\t}
\t\t\tconsole.error("[telegram] sendMessage error: " + res.status + " " + err.slice(0, 200))
\t\t}'''

if old in content:
    content = content.replace(old, new)
    with open('/opt/superroo2/cloud/api/telegramBot.js', 'w') as f:
        f.write(content)
    print('SUCCESS: Markdown fallback added to sendMessage')
else:
    print('ERROR: Could not find target block')
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if 'if (!res.ok)' in line:
            print(f'Found at line {i+1}: {repr(line)}')
            for j in range(i, min(i+12, len(lines))):
                print(f'  {j+1}: {repr(lines[j])}')
