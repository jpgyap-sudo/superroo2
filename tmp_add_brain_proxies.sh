#!/bin/bash
# Add /brain/ask and /brain/log-bug proxy routes to api.js
# Insert after line 2708 (end of /brain/session proxy block)

API_JS="/opt/superroo2/cloud/api/api.js"

# Create a temporary file with the new routes inserted
awk '
NR == 2708 {
    print
    print ""
    print "\t\t// ── Brain /ask proxy (bypasses auth, proxies to daemon) ────────────"
    print ""
    print "\t\t// Proxies POST /brain/ask to the daemon at localhost:3417/brain/ask"
    print "\t\t// This is used by the AI Chat component for conversational Q&A"
    print "\t\tif (method === \"POST\" && (url === \"/brain/ask\" || normalizedUrl === \"/brain/ask\")) {"
    print "\t\t\ttry {"
    print "\t\t\t\tconst body = await parseBody(req)"
    print "\t\t\t\tconst daemonRes = await fetch(\"http://127.0.0.1:3417/brain/ask\", {"
    print "\t\t\t\t\tmethod: \"POST\","
    print "\t\t\t\t\theaders: { \"Content-Type\": \"application/json\" },"
    print "\t\t\t\t\tbody: JSON.stringify(body),"
    print "\t\t\t\t})"
    print "\t\t\t\tconst data = await daemonRes.json()"
    print "\t\t\t\tsendJson(res, daemonRes.status, data)"
    print "\t\t\t} catch (err) {"
    print "\t\t\t\tsendJson(res, 502, { ok: false, error: \"Brain ask proxy error: \" + err.message })"
    print "\t\t\t}"
    print "\t\t\treturn"
    print "\t\t}"
    print ""
    print "\t\t// ── Brain /log-bug proxy (bypasses auth, proxies to daemon) ────────"
    print ""
    print "\t\t// Proxies POST /brain/log-bug to the daemon at localhost:3417/brain/log-bug"
    print "\t\t// This is used by the AI Chat component to log bugs from conversations"
    print "\t\tif (method === \"POST\" && (url === \"/brain/log-bug\" || normalizedUrl === \"/brain/log-bug\")) {"
    print "\t\t\ttry {"
    print "\t\t\t\tconst body = await parseBody(req)"
    print "\t\t\t\tconst daemonRes = await fetch(\"http://127.0.0.1:3417/brain/log-bug\", {"
    print "\t\t\t\t\tmethod: \"POST\","
    print "\t\t\t\t\theaders: { \"Content-Type\": \"application/json\" },"
    print "\t\t\t\t\tbody: JSON.stringify(body),"
    print "\t\t\t\t})"
    print "\t\t\t\tconst data = await daemonRes.json()"
    print "\t\t\t\tsendJson(res, daemonRes.status, data)"
    print "\t\t\t} catch (err) {"
    print "\t\t\t\tsendJson(res, 502, { ok: false, error: \"Brain log-bug proxy error: \" + err.message })"
    print "\t\t\t}"
    print "\t\t\treturn"
    print "\t\t}"
    next
}
{ print }
' "$API_JS" > "${API_JS}.tmp" && mv "${API_JS}.tmp" "$API_JS"

echo "Done. Added brain proxy routes."
