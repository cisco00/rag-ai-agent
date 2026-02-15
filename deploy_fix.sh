#!/bin/bash
set -e

# Define path to local Node v20
LOCAL_NODE_BIN="$(pwd)/node-v20.11.0-linux-x64/bin"

if [ -d "$LOCAL_NODE_BIN" ]; then
    echo "Using local Node.js v20 from $LOCAL_NODE_BIN"
    export PATH="$LOCAL_NODE_BIN:$PATH"
else
    echo "Warning: Local Node.js v20 not found at $LOCAL_NODE_BIN"
    echo "Attempting to use system node..."
fi

# Print node version
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# Navigate to frontend
cd front-end

# Install dependencies
echo "Installing dependencies..."
npm install

# Build
echo "Building..."
npm run build


# Install Python dependencies just in case (for build environment)
echo "Installing Python dependencies..."
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
else
    echo "Warning: requirements.txt not found."
fi


# Note: Migrations should be run in the start script, not build script.
echo "Skipping migrations in build script."


echo "Build complete! Artifacts are in front-end/dist"
