#!/usr/bin/env bash
# Stack & Study — nightly backup of the database + book PDFs. Install:  bash 05-backup.sh install
# Keeps the last 14 days in /opt/shalakasi/backups. COPY THEM OFF THE SERVER too (see README).
set -euo pipefail
OUT=/opt/shalakasi/backups
if [ "${1:-}" = install ]; then
  [ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
  install -d -m 700 "$OUT"
  cp "$0" /usr/local/bin/stackstudy-backup; chmod 755 /usr/local/bin/stackstudy-backup
  echo "17 2 * * * root /usr/local/bin/stackstudy-backup >> /var/log/stackstudy-backup.log 2>&1" > /etc/cron.d/stackstudy-backup
  /usr/local/bin/stackstudy-backup && echo "Installed. Runs every night at 02:17."; exit 0
fi
. /opt/shalakasi/pg/info.env
D=$(date +%Y%m%d-%H%M%S)
sudo -u postgres pg_dump -p "$PGPORT" -Fc stackstudy > "$OUT/db-$D.dump"
tar -czf "$OUT/books-$D.tar.gz" -C /opt/shalakasi books 2>/dev/null || true
chmod 600 "$OUT"/*"$D"*
find "$OUT" -type f -mtime +14 -delete
echo "$(date -Is) backup ok: $(ls -1 "$OUT" | wc -l) files, $(du -sh "$OUT" | cut -f1)"
