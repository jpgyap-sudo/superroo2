import sys

with open('cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = '''\tconst handleTerminalCommand = useCallback(
\t\tasync (cmd: string) => {
\t\t\tif (!cmd.trim()) return
\t\t\tdispatch({ type: "SET_TERMINAL_INPUT", payload: "" })

\t\t\tif (terminalMode === "shell" && ptyConnected && ptySessionId) {
\t\t\t\t// Send via PTY for real shell interaction
\t\t\t\thandlePtyInput(cmd + "\\n")
\t\t\t\treturn
\t\t\t}

\t\t\t// Fallback to REST-based command execution
\t\t\tdispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: [`$ ${cmd}`] })
\t\t\ttry {
\t\t\t\tconst result = await sendTerminalCommand(cmd, undefined, terminalMode)
\t\t\t\tif (result.output) {
\t\t\t\t\tdispatch({
\t\t\t\t\t\ttype: "APPEND_TERMINAL_OUTPUT",
\t\t\t\t\t\tpayload: Array.isArray(result.output) ? result.output : [result.output],
\t\t\t\t\t})
\t\t\t\t}
\t\t\t} catch (err: any) {
\t\t\t\tdispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: [`Error: ${err.message}`] })
\t\t\t}
\t\t},
\t\t[dispatch, ptyConnected, ptySessionId, handlePtyInput, terminalMode],
\t)'''

new = '''\tconst handleTerminalCommand = useCallback(
\t\tasync (cmd: string) => {
\t\t\tif (!cmd.trim()) return
\t\t\tdispatch({ type: "SET_TERMINAL_INPUT", payload: "" })
\t\t\tsetCommandHistoryIndex(-1)
\t\t\tsetCommandHistoryDraft("")

\t\t\t// Add to command history (deduped, max 100)
\t\t\tconst trimmed = cmd.trim()
\t\t\tconst newHistory = [...recentCommands.filter((c) => c !== trimmed), trimmed].slice(-100)
\t\t\tdispatch({ type: "SET_RECENT_COMMANDS", payload: newHistory })

\t\t\tif (terminalMode === "shell" && ptyConnected && ptySessionId) {
\t\t\t\t// Send via PTY for real shell interaction
\t\t\t\thandlePtyInput(cmd + "\\n")
\t\t\t\treturn
\t\t\t}

\t\t\t// Fallback to REST-based command execution
\t\t\tdispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: [`$ ${cmd}`] })
\t\t\ttry {
\t\t\t\tconst result = await sendTerminalCommand(cmd, undefined, terminalMode)
\t\t\t\tif (result.output) {
\t\t\t\t\tdispatch({
\t\t\t\t\t\ttype: "APPEND_TERMINAL_OUTPUT",
\t\t\t\t\t\tpayload: Array.isArray(result.output) ? result.output : [result.output],
\t\t\t\t\t})
\t\t\t\t}
\t\t\t} catch (err: any) {
\t\t\t\tdispatch({ type: "APPEND_TERMINAL_OUTPUT", payload: [`Error: ${err.message}`] })
\t\t\t}
\t\t},
\t\t[dispatch, ptyConnected, ptySessionId, handlePtyInput, terminalMode, recentCommands],
\t)'''

if old in content:
    content = content.replace(old, new)
    with open('cloud/dashboard/src/components/ide-terminal/hooks/useIdeTerminal.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced handleTerminalCommand")
else:
    print("Old handleTerminalCommand not found")
    idx = content.find('const handleTerminalCommand = useCallback')
    if idx >= 0:
        snippet = content[idx:idx+500]
        print("Snippet:", repr(snippet[:200]))
