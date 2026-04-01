#!/bin/bash

# Synapse Launcher — double-click to open Synapse
# This file can be moved anywhere (Desktop, Dock, etc.)
# On first use, right-click → Open if macOS blocks it

# Load shell profile so npm/node are in PATH
source "$HOME/.zshrc" 2>/dev/null || source "$HOME/.bash_profile" 2>/dev/null || true
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# On first run from the Synapse directory, remember where it lives
CONFIG="$HOME/.synapse-path"

if [ ! -f "$CONFIG" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  if [ -f "$SCRIPT_DIR/package.json" ]; then
    echo "$SCRIPT_DIR" > "$CONFIG"
  else
    echo "Error: Run this once from the Synapse folder so it can remember the location."
    echo "Press any key to close..."
    read -n 1
    exit 1
  fi
fi

SYNAPSE_DIR="$(cat "$CONFIG")"

if [ ! -d "$SYNAPSE_DIR" ]; then
  echo "Error: Synapse directory not found at $SYNAPSE_DIR"
  echo "Delete ~/.synapse-path and run this from the Synapse folder again."
  echo "Press any key to close..."
  read -n 1
  exit 1
fi

cd "$SYNAPSE_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "First launch — installing dependencies (this may take a minute)..."
  npm install
fi

# Build and launch
npm run dev
