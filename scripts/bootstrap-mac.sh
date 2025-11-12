#!/usr/bin/env zsh
set -euo pipefail

# Bootstrap script for macOS (zsh) to prepare a development environment for simplehome.
# This script is intended to be run interactively. It will:
# - Install nvm (if missing)
# - Ensure Node 18 is installed and active
# - Run npm install in the project

echo "Starting bootstrap for simplehome (macOS, zsh)"

# Check for nvm
if ! command -v nvm >/dev/null 2>&1; then
  echo "nvm not found. Installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.6/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
else
  echo "nvm found"
fi

echo "Installing Node 18 (LTS) and using it"
nvm install 18
nvm use 18

echo "Node version: $(node -v)"
echo "npm  version: $(npm -v)"

echo "Installing project dependencies (npm install)"
npm install

echo "Bootstrap complete. To start the dev server, run: npm run dev"
echo "If you need to set API keys or other environment variables, add them to ~/.zshrc"

exit 0
