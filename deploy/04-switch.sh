#!/usr/bin/env bash
# Stack & Study — step 4: point the app at your own database (the cutover).
# Run as root on the server:   bash 04-switch.sh        (to go back:  bash 04-switch.sh back)
# Supabase is left untouched. The old keys stay in .env as OLD_* so "back" is instant.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
ENV=/opt/shalakasi/app/.env
BASE=/opt/shalakasi/pg; . "$BASE/info.env"
cp "$ENV" "$ENV.bak-$(date +%Y%m%d-%H%M%S)"
get() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
setkv() { if grep -qE "^$1=" "$ENV"; then sed -i "s|^$1=.*|$1=$2|" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
if [ "${1:-}" = back ]; then
  grep -qE '^OLD_SUPABASE_URL=' "$ENV" || { echo "No OLD_ keys found — nothing to go back to."; exit 1; }
  sed -i '/^POSTGREST_URL=/d' "$ENV"
  setkv SUPABASE_URL "$(get OLD_SUPABASE_URL)"
  setkv SUPABASE_SERVICE_ROLE_KEY "$(get OLD_SUPABASE_SERVICE_ROLE_KEY)"
  systemctl restart shalakasi; sleep 2
  echo "Back on Supabase."; curl -s -o /dev/null -w 'site: HTTP %{http_code}\n' http://127.0.0.1:3300/; exit 0
fi
grep -qE '^OLD_SUPABASE_URL=' "$ENV" || {
  setkv OLD_SUPABASE_URL "$(get SUPABASE_URL)"
  setkv OLD_SUPABASE_SERVICE_ROLE_KEY "$(get SUPABASE_SERVICE_ROLE_KEY)"
}
setkv POSTGREST_URL "http://127.0.0.1:$POSTGREST_PORT"
setkv SUPABASE_SERVICE_ROLE_KEY "$(cat "$BASE/service_key.txt")"
grep -qE '^BOOKS_DIR=' "$ENV" || setkv BOOKS_DIR /opt/shalakasi/books
install -d -o shalakasi -g shalakasi /opt/shalakasi/books 2>/dev/null || install -d /opt/shalakasi/books
chown -R shalakasi:shalakasi /opt/shalakasi/books 2>/dev/null || true
systemctl restart shalakasi; sleep 2
curl -s -o /dev/null -w 'site: HTTP %{http_code}\n' http://127.0.0.1:3300/
journalctl -u shalakasi -n 5 --no-pager
echo "Switched. Now log in as a student and as admin to check. To undo: bash 04-switch.sh back"
