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
# Internal planning notes and drafts stay out of the public repo: remove them from the publish copy and keep them git-ignored there.
INTERNAL="growth-progress.md launch-posts.md awesome-pr-drafts.md seo-plan.md cloud-gpu-referrals.md next-benchmarks-plan.md vast-launch-plan.md benchmark-sweep-plan.md release-playbook.md earnings-log.md reddit-watch.md"
for f in $INTERNAL; do rm -f "$PUB/$f"; grep -qxF "/$f" "$PUB/.gitignore" 2>/dev/null || echo "/$f" >> "$PUB/.gitignore"; done
node "$SRC/tools/indexnow.js"
echo "synced to $PUB (docs/CNAME: $(cat "$PUB/docs/CNAME"))"
