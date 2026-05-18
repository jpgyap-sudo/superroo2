with open('cloud/dashboard/src/components/views/ide-terminal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old = '''onTerminalKeyDown={(e: React.KeyboardEvent) => {
\t\t\t\t\t\t\t\t\t\t\t\tif (e.key === "Enter") {
\t\t\t\t\t\t\t\t\t\t\t\t\thook.handleTerminalCommand(terminalInput)
\t\t\t\t\t\t\t\t\t\t\t\t}
\t\t\t\t\t\t\t\t\t\t\t}}'''

new = '''onTerminalKeyDown={(e: React.KeyboardEvent) => {
\t\t\t\t\t\t\t\t\t\t\t\thook.handleTerminalKeyDown(e, terminalInput)
\t\t\t\t\t\t\t\t\t\t\t}}'''

if old in content:
    content = content.replace(old, new, 1)
    with open('cloud/dashboard/src/components/views/ide-terminal.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced onTerminalKeyDown")
else:
    print("Old onTerminalKeyDown not found")
