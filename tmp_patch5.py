with open('cloud/dashboard/src/components/views/ide-terminal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old = '''onLspReferences={hook.onLspReferences}
\t\t\t\t\t\t\t\t\t\tonLspOpenDocument={hook.onLspOpenDocument}'''

new = '''onLspReferences={hook.onLspReferences}
\t\t\t\t\t\t\t\t\t\tonLspCodeActions={hook.onLspCodeActions}
\t\t\t\t\t\t\t\t\t\tonLspOpenDocument={hook.onLspOpenDocument}'''

if old in content:
    content = content.replace(old, new, 1)
    with open('cloud/dashboard/src/components/views/ide-terminal.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Added onLspCodeActions")
else:
    print("Old string not found")
    idx = content.find('onLspReferences')
    if idx >= 0:
        print(repr(content[idx:idx+200]))
