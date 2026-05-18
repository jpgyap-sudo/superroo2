with open('cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts', 'r', encoding='utf-8') as f:
    content = f.read()

marker = '\t// ── Import / Open workspace ───────────────────────────────────────────'
new_func = '''\t// ── Terminal key handler (Up/Down for command history) ────────────────

\tconst handleTerminalKeyDown = useCallback(
\t\t(e: React.KeyboardEvent, currentInput: string) => {
\t\t\tif (e.key === "ArrowUp") {
\t\t\t\te.preventDefault()
\t\t\t\tif (commandHistoryIndex === -1) {
\t\t\t\t\tsetCommandHistoryDraft(currentInput)
\t\t\t\t}
\t\t\t\tconst nextIndex = commandHistoryIndex + 1
\t\t\t\tif (nextIndex < recentCommands.length) {
\t\t\t\t\tsetCommandHistoryIndex(nextIndex)
\t\t\t\t\tdispatch({
\t\t\t\t\t\ttype: "SET_TERMINAL_INPUT",
\t\t\t\t\t\tpayload: recentCommands[recentCommands.length - 1 - nextIndex],
\t\t\t\t\t})
\t\t\t\t}
\t\t\t} else if (e.key === "ArrowDown") {
\t\t\t\te.preventDefault()
\t\t\t\tconst nextIndex = commandHistoryIndex - 1
\t\t\t\tif (nextIndex >= 0) {
\t\t\t\t\tsetCommandHistoryIndex(nextIndex)
\t\t\t\t\tdispatch({
\t\t\t\t\t\ttype: "SET_TERMINAL_INPUT",
\t\t\t\t\t\tpayload: recentCommands[recentCommands.length - 1 - nextIndex],
\t\t\t\t\t})
\t\t\t\t} else if (nextIndex === -1) {
\t\t\t\t\tsetCommandHistoryIndex(-1)
\t\t\t\t\tdispatch({ type: "SET_TERMINAL_INPUT", payload: commandHistoryDraft })
\t\t\t\t}
\t\t\t} else if (e.key === "Enter") {
\t\t\t\thandleTerminalCommand(currentInput)
\t\t\t}
\t\t},
\t\t[recentCommands, commandHistoryIndex, commandHistoryDraft, dispatch, handleTerminalCommand],
\t)

\t// ── Import / Open workspace ───────────────────────────────────────────'''

if marker in content:
    content = content.replace(marker, new_func, 1)
    with open('cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Inserted handleTerminalKeyDown")
else:
    print("Marker not found")
