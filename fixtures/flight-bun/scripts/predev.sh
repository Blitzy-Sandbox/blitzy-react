#!/bin/bash
# Pre-development script for flight-bun fixture.
# Copies the latest React experimental build artifacts into node_modules.
# Run from the React monorepo root: yarn build --r=experimental
# Then run this script or use: bun run predev

set -e

# Resolve directories
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FIXTURE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$FIXTURE_DIR/../../build/oss-experimental"
NODE_MODULES_DIR="$FIXTURE_DIR/node_modules"

# Verify build artifacts exist
if [ ! -d "$BUILD_DIR" ]; then
  echo "Error: Build directory not found at $BUILD_DIR"
  echo "Run 'yarn build --r=experimental' from the React root first."
  exit 1
fi

# Create node_modules if needed
mkdir -p "$NODE_MODULES_DIR"

# Copy build artifacts
cp -r "$BUILD_DIR"/* "$NODE_MODULES_DIR"/

# Clean stale caches
rm -rf "$NODE_MODULES_DIR/.cache" 2>/dev/null || true

echo "Successfully copied experimental build artifacts to node_modules."
