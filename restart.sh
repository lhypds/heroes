#!/bin/bash
set -e
cd "$(dirname "$0")"
git pull
# --prod=false: a server shell with NODE_ENV=production would otherwise skip
# devDependencies, and the build needs vite from there.
pnpm install --prod=false
pnpm run build
pm2 restart ecosystem.config.cjs --update-env
