#!/bin/bash
set -e

echo "=== Compiling TypeScript ==="
npm run compile

echo "=== Bundling for production ==="
npm run bundle:prod

echo "=== Publishing to VS Code Marketplace ==="
vsce publish

echo "=== Done! ==="
