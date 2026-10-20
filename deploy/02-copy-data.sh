#!/usr/bin/env bash
# Stack & Study — step 2: copy all data from Supabase into your own Postgres.
# Run as root on the server:   bash 02-copy-data.sh
# Read-only on the Supabase side. Safe to re-run (it empties our copy first).
# The Supabase database password is typed here, on the server, and never saved.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
BASE=/opt/shalakasi/pg; . "$BASE/info.env"
if grep -qE '^POSTGREST_URL=' /opt/shalakasi/app/.env 2>/dev/null; then
  echo "The app is already running on your own database. Re-running this would erase newer data. Stopping."; exit 1
fi
PGV=17; DB=stackstudy
BIN=/usr/lib/postgresql/$PGV/bin
TABLES="chapters sections students quiz_bank student_progress attempts chat_log ai_decisions chapter_reviews review_answers postgrad_books postgrad_quiz_bank postgrad_progress postgrad_attempts payouts"

echo "Paste the Supabase connection string (Supabase → Connect → 'Session pooler'),"
echo "with your password in place of [YOUR-PASSWORD]. Nothing is shown as you type."
read -rs -p "Connection string: " SRC; echo
[ -n "$SRC" ] || { echo "Nothing entered."; exit 1; }

DUMP=$(mktemp /root/ss-dump.XXXXXX.sql); chmod 600 "$DUMP"
trap 'rm -f "$DUMP"' EXIT
args=(); for t in $TABLES; do args+=(-t "public.$t"); done
echo "== Reading from Supabase…"
"$BIN/pg_dump" "$SRC" --data-only --no-owner --no-privileges --disable-triggers "${args[@]}" -f "$DUMP"

echo "== Loading into your database…"
TL=$(echo $TABLES | sed 's/ /, /g')
sudo -u postgres psql -p "$PGPORT" -d "$DB" -v ON_ERROR_STOP=1 -q -c "truncate $TL restart identity cascade" -f - < "$DUMP" >/dev/null
sudo -u postgres psql -p "$PGPORT" -d "$DB" -q -c "notify pgrst, 'reload schema'" >/dev/null

echo "== Row counts (Supabase | yours) — they must match"
bad=0
for t in $TABLES; do
  a=$("$BIN/psql" "$SRC" -Atc "select count(*) from public.$t")
  b=$(sudo -u postgres psql -p "$PGPORT" -d "$DB" -Atc "select count(*) from public.$t")
  mark=ok; [ "$a" = "$b" ] || { mark="MISMATCH"; bad=1; }
  printf '  %-22s %6s | %-6s %s\n' "$t" "$a" "$b" "$mark"
done
[ $bad = 0 ] && echo "All tables match." || { echo "Some counts differ — do not switch over; send me this output."; exit 1; }
