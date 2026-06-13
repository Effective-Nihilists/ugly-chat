#!/usr/bin/env bash
# Local dev launcher for ugly-chat.
#  - self auth mode (mint test tokens with AUTH_SECRET; see scripts/verify-chat.mjs)
#    NOTE: requires `.uglyapp` to have {"auth":{"mode":"self"}} locally. That change
#    is kept out of git via `git update-index --skip-worktree .uglyapp` so production
#    stays ugly.bot-federated.
#  - UGLY_BOT_TOKEN sourced from the project token file so bot textGen routes through
#    ugly.bot (real AI replies); falls back to a canned reply if absent.
set -euo pipefail
export DATABASE_URL="${DATABASE_URL:-postgres://app:app@localhost:5432/ugly_chat}"
export AUTH_SECRET="${AUTH_SECRET:-ugly-chat-dev-secret-local-only}"
# Live trackDocs (realtime) needs NATS — use the local docker NATS.
export NATS_URL="${NATS_URL:-nats://localhost:4222}"
TOKEN_FILE="$HOME/.ugly-bot/11tm1kplpe.json"
if [ -f "$TOKEN_FILE" ]; then
  export UGLY_BOT_TOKEN="$(node -e "console.log(require('$TOKEN_FILE').token)")"
fi
exec pnpm run dev
