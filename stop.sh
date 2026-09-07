#!/bin/bash
set -e
cd "$(dirname "$0")"
pm2 stop ecosystem.config.cjs
