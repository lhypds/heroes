#!/bin/bash
set -e
cd "$(dirname "$0")"
pm2 reload ecosystem.config.cjs --update-env
