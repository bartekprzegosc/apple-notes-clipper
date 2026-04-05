#!/bin/bash
set -e

echo "🍎 Apple Notes Clipper — Setup"
echo "================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org"
  exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Install dependencies
cd "$(dirname "$0")/local-server"
echo "📦 Installing dependencies..."
npm install

# Run setup (generates token, creates config.json)
node setup.js

# Set up Launch Agent
PLIST_SRC="$(pwd)/com.bartekprzegosc.notesclipper.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.bartekprzegosc.notesclipper.plist"
NODE_PATH="$(which node)"
SERVER_PATH="$(pwd)/server.js"
LOG_PATH="$HOME/Library/Logs/notesclipper.log"

mkdir -p "$HOME/Library/LaunchAgents"

sed -e "s|REPLACE_WITH_NODE_PATH|$NODE_PATH|g" \
    -e "s|REPLACE_WITH_SERVER_PATH|$SERVER_PATH|g" \
    -e "s|REPLACE_WITH_LOG_PATH|$LOG_PATH|g" \
    "$PLIST_SRC" > "$PLIST_DEST"

launchctl load "$PLIST_DEST"

echo ""
echo "✅ Server installed and running!"
echo ""
echo "📦 Next: Load Chrome Extension"
echo "  1. Open Chrome → chrome://extensions"
echo "  2. Enable Developer Mode (top right)"
echo "  3. Click 'Load unpacked'"
echo "  4. Select: $(dirname "$(pwd)")/chrome-extension"
echo ""
echo "⚙️  Then open the extension Options and paste your token."
