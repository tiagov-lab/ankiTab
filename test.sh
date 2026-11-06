#!/bin/sh
set -e
cd "$(dirname "$0")"
docker run --rm -v "$PWD":/w -w /w node:22-alpine sh -c "npm install --no-audit --no-fund --loglevel=error && npx vitest run $*"
