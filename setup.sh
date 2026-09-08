#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Copied .env.example to .env"
fi

# Ask for a .env value that has none. Already-filled keys are left alone, and
# with no terminal to ask on (ssh deploy, CI) it reports instead of hanging.
ask_env() {
  local key="$1" hint="$2" value
  if grep -q "^$key=..*" .env; then
    echo "$key is already set."
    return 0
  fi
  if [ ! -t 0 ]; then
    echo "$key is not set in $PWD/.env — fill it in and re-run this script."
    return 0
  fi
  echo "$hint"
  read -r -p "$key (press Enter to skip): " value || value=""
  if [ -z "$value" ]; then
    echo "Skipped — $key left empty."
    return 0
  fi
  # Rewrite in place so comments and key order in .env survive. The value goes
  # through the environment, so | / & \ and friends need no escaping.
  if grep -q "^$key=" .env; then
    VALUE="$value" awk -v k="$key" \
      '$0 ~ "^" k "=" && !done { print k "=" ENVIRON["VALUE"]; done=1; next } { print }' \
      .env > .env.tmp
    mv .env.tmp .env
  else
    echo "$key=$value" >> .env
  fi
  echo "Saved $key to .env"
}

echo ""
echo "==> Checking .env..."
ask_env HOST \
  "Public hostname the page is served from, e.g. heroes.example.com — comma-separate several (leave empty for local development)."
ask_env GITHUB_TOKEN \
  "GitHub token for the account check at /api and for ./crawl.sh (leave empty if the GitHub CLI is signed in here)."

echo ""
echo "Installing dependencies..."
# --prod=false: a server shell with NODE_ENV=production would otherwise skip
# devDependencies, and the build needs vite from there.
pnpm install --prod=false

echo "Building..."
pnpm run build

echo ""
echo "Setup complete. Start it with ./start.sh"
