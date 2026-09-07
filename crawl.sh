#!/bin/bash
set -e
cd "$(dirname "$0")"

# People who might be heroes, anyone with a hundred public repositories and a
# hundred of them their own and not forks, into data/crawl.db. Starts from
# everyone under data/heros/ unless handles are given; data/crawl.js lists
# every flag:
#   ./crawl.sh
#   ./crawl.sh alice bob
#   ./crawl.sh --search       everyone on GitHub with a hundred repositories
#   ./crawl.sh --report       who was found
#   ./crawl.sh --fresh        forget everything and start over
# Needs a GitHub token: GITHUB_TOKEN in the environment or in .env, or the
# GitHub CLI signed in (gh auth login).

if [ -z "$GITHUB_TOKEN" ] && [ -f .env ]; then
  GITHUB_TOKEN="$(grep '^GITHUB_TOKEN=..*' .env | head -1 | cut -d= -f2-)"
  export GITHUB_TOKEN
fi
if [ -z "$GITHUB_TOKEN" ] && ! gh auth token >/dev/null 2>&1; then
  echo "Needs a GitHub token: set GITHUB_TOKEN in the environment or in .env, or run 'gh auth login'."
  exit 1
fi

node data/crawl.js "$@"
