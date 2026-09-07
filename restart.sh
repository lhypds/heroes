#!/bin/bash
set -e
cd "$(dirname "$0")"
git pull
# --include=dev: a server shell with NODE_ENV=production would otherwise skip
# devDependencies, and the build needs vite from there.
npm install --include=dev
npm run build
pm2 restart ecosystem.config.cjs --update-env
