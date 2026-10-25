#!/bin/sh
# One-time setup for FluentLoop's local text-to-speech (Kokoro-82M).
# Creates an isolated Python 3.12 environment and downloads the model + English voices once.
set -e
VENV="$HOME/.local/share/fluentloop/tts-venv"
export HF_HOME="$HOME/Library/Application Support/com.fluentloop.app/models/huggingface"
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
if [ ! -x "$UV" ]; then
  echo "Installing uv (Python package manager) into ~/.local/bin"
  curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh
  UV="$HOME/.local/bin/uv"
fi
[ -x "$VENV/bin/python" ] || "$UV" venv --python 3.12 "$VENV"
"$UV" pip install --python "$VENV/bin/python" "kokoro>=0.9.4" soundfile \
  "en-core-web-sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
mkdir -p "$HF_HOME"
"$VENV/bin/python" "$(dirname "$0")/../src-tauri/tts/kokoro_worker.py" --prepare
echo "Done. Model cache: $HF_HOME"
