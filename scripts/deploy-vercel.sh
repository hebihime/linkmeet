#!/usr/bin/env bash
# One-shot Vercel deploy.
#   bash scripts/deploy-vercel.sh <vercel-token>
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN="${1:?Usage: bash scripts/deploy-vercel.sh <vercel-token>}"
SCOPE="${2:-jps-projects-c7adf5bf}"

V() { npx --yes vercel "$@" --token "$TOKEN" --scope "$SCOPE"; }

echo "==> Linking Vercel project (creates 'linkmeet' if new)…"
V link --yes --project linkmeet

echo "==> Pushing env vars from .env.local…"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ""|\#*) continue ;; esac
  key="${line%%=*}"
  val="${line#*=}"
  [ -z "$key" ] && continue
  [ -z "$val" ] && continue
  for target in production preview; do
    V env rm "$key" "$target" -y >/dev/null 2>&1 || true
    printf '%s' "$val" | V env add "$key" "$target" >/dev/null 2>&1 \
      && echo "    set $key ($target)" \
      || echo "    FAILED $key ($target)"
  done
done < .env.local

echo "==> Deploying to production…"
V --prod --yes
