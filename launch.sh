#!/bin/bash

# Synapse Launcher — double-click this file to open Synapse
# (On first use, right-click → Open if macOS blocks it)

cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "First launch — installing dependencies (this may take a minute)..."
  npm install
fi

# Build and launch
npm start
