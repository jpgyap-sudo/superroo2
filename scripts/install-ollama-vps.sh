#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y curl
fi

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

sudo systemctl enable ollama || true
sudo systemctl restart ollama || true
sleep 2
ollama --version || true
curl -s http://127.0.0.1:11434/api/tags || true
