#!/bin/sh
# Sync generated site/ -> publish copy (site/ and docs/). docs/CNAME (custom domain) is protected: never deleted.
# Usage: tools/sync_publish.sh [/workspace/publish]
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"; PUB="${1:-/workspace/publish}"
SITE_URL="${SITE_URL:-https://localllmadvisor.com}" node "$SRC/tools/generate_pages.js" >/dev/null
mirror() { # mirror <src> <dst>: replace contents but keep CNAME and .nojekyll
  mkdir -p "$2"; find "$2" -mindepth 1 -maxdepth 1 ! -name CNAME ! -name .nojekyll -exec rm -rf {} +
  cp -a "$1"/. "$2"/
}
mirror "$SRC/site" "$PUB/site"; mirror "$SRC/site" "$PUB/docs"
touch "$PUB/docs/.nojekyll"
# CNAME is written by tools/seo.js (from SITE_URL) into site/ and mirrored above; verify it is exactly one line
test "$(wc -l < "$PUB/docs/CNAME")" = 1 && test -s "$PUB/docs/CNAME"
# IndexNow: record changed URLs (no network). After push + deploy run: node tools/indexnow.js --submit
node "$SRC/tools/indexnow.js"
echo "synced to $PUB (docs/CNAME: $(cat "$PUB/docs/CNAME"))"
