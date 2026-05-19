@echo off
REM Helper script for build-agent-context.mjs
REM Calls curl to Ollama API and writes response to a temp file
REM Usage: ollama-curl-helper.cmd <url> <output-file> [body-file]
REM   body-file: optional path to file containing POST body (JSON)

set "URL=%~1"
set "OUTFILE=%~2"
set "BODYFILE=%~3"

if not "%BODYFILE%"=="" (
    curl -s --max-time 120 -H "Content-Type: application/json" -X POST "%URL%" -d @"%BODYFILE%" > "%OUTFILE%" 2>NUL
) else (
    curl -s --connect-timeout 3 "%URL%" > "%OUTFILE%" 2>NUL
)
