#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  SUDO="sudo"
else
  SUDO=""
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script currently supports Debian/Ubuntu systems with apt-get." >&2
  exit 1
fi

pick_package() {
  for pkg in "$@"; do
    if apt-cache show "$pkg" >/dev/null 2>&1; then
      printf '%s\n' "$pkg"
      return 0
    fi
  done

  return 1
}

packages=(
  ca-certificates
  fonts-liberation
  libatk-bridge2.0-0
  libatk1.0-0
  libatspi2.0-0
  libcairo2
  libdbus-1-3
  libdrm2
  libexpat1
  libgbm1
  libglib2.0-0
  libnspr4
  libnss3
  libpango-1.0-0
  libudev1
  libvulkan1
  libx11-6
  libxcb1
  libxcomposite1
  libxdamage1
  libxext6
  libxfixes3
  libxkbcommon0
  libxrandr2
  wget
  xdg-utils
)

packages+=("$(pick_package libasound2t64 libasound2)")
packages+=("$(pick_package libcups2t64 libcups2)")
packages+=("$(pick_package libgtk-3-0t64 libgtk-3-0 libgtk-4-1)")

echo "Installing browser runtime dependencies..."
$SUDO apt-get update
$SUDO apt-get install -y "${packages[@]}"
