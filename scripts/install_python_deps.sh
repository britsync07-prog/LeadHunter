#!/usr/bin/env bash
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "[setup:python] python3 not found; skipping Python dependency install."
  exit 0
fi

if ! python3 -m pip --version >/dev/null 2>&1; then
  echo "[setup:python] pip is unavailable; attempting bootstrap via ensurepip."
  if python3 -m ensurepip --upgrade >/dev/null 2>&1; then
    echo "[setup:python] pip bootstrap succeeded."
  else
    echo "[setup:python] Unable to bootstrap pip; skipping Python dependency install."
    exit 0
  fi
fi

python3 -m pip install --upgrade pip --break-system-packages
python3 -m pip install -r requirements.txt --break-system-packages
