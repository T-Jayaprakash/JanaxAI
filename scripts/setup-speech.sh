#!/usr/bin/env bash
# Installs local speech-to-text for voice notes: whisper.cpp + the multilingual "small" model (~466 MB).
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v whisper-cli >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then brew install whisper-cpp; else echo "Install whisper.cpp (https://github.com/ggml-org/whisper.cpp) and put whisper-cli on PATH."; exit 1; fi
fi
mkdir -p data/models
if [ ! -f data/models/ggml-small.bin ]; then
  curl -L --fail -o data/models/ggml-small.bin.part https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
  mv data/models/ggml-small.bin.part data/models/ggml-small.bin
fi
echo "Speech-to-text ready."
