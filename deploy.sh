#!/usr/bin/env bash
# Build and publish to Cloudflare Pages.
#
# Usage:  ./deploy.sh [project-name]
#
# Publishes a directory containing only the page itself, so the Artifacts
# fragment and the duplicate build in dist/ never end up served.
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${1:-yozakura-qr-tree}"

python3 build.py

rm -rf .deploy
mkdir -p .deploy
cp dist/index.html .deploy/index.html

echo
echo "Publishing .deploy/ to Cloudflare Pages project '$PROJECT'…"
wrangler pages deploy .deploy --project-name="$PROJECT" --commit-dirty=true
