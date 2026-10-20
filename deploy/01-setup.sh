#!/usr/bin/env bash
# Stack & Study — step 1: install your own Postgres 17 + PostgREST on this server.
# Run as root on the server:   bash 01-setup.sh
# Safe to re-run. Touches nothing that already runs here (Bleskomat, Caddy, the app):
# Postgres and PostgREST listen on 127.0.0.1 only.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
PGV=17
BASE=/opt/shalakasi/pg
PGREST_VER=v12.2.3
DB=stackstudy

echo "== 1/6 Installing PostgreSQL $PGV (official PostgreSQL apt repo)"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg lsb-release xz-utils openssl >/dev/null
if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
fi
apt-get install -y -qq "postgresql-$PGV" "postgresql-client-$PGV" >/dev/null
# Make sure it only listens on localhost.
PGCONF="/etc/postgresql/$PGV/main/postgresql.conf"
grep -q "^listen_addresses *= *'localhost'" "$PGCONF" || { sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" "$PGCONF"; systemctl restart "postgresql@$PGV-main"; }
PGPORT=$(pg_lsclusters | awk -v v="$PGV" '$1==v && $2=="main"{print $3}')
echo "   Postgres $PGV is running on 127.0.0.1:$PGPORT"
PSQL="sudo -u postgres psql -p $PGPORT -v ON_ERROR_STOP=1 -q"

echo "== 2/6 Secrets"
install -d -m 755 "$BASE"
if [ ! -f "$BASE/secrets.env" ]; then
  umask 077
  {
    echo "AUTHPW=$(openssl rand -hex 24)"
    echo "PGREST_JWT_SECRET=$(openssl rand -hex 32)"
  } > "$BASE/secrets.env"
fi
set -a; . "$BASE/secrets.env"; set +a

echo "== 3/6 Database + tables"
if ! sudo -u postgres psql -p "$PGPORT" -Atc "select 1 from pg_database where datname='$DB'" | grep -q 1; then
  sudo -u postgres createdb -p "$PGPORT" "$DB"
  cp "$HERE/schema_complete.sql" /tmp/schema_complete.sql; chmod 644 /tmp/schema_complete.sql
  $PSQL -d "$DB" -f /tmp/schema_complete.sql >/dev/null
  rm -f /tmp/schema_complete.sql
else
  echo "   database $DB already exists — leaving its tables alone"
fi
cp "$HERE/roles.sql" /tmp/roles.sql; chmod 644 /tmp/roles.sql
$PSQL -d "$DB" -v authpw="$AUTHPW" -f /tmp/roles.sql >/dev/null
rm -f /tmp/roles.sql

echo "== 4/6 PostgREST $PGREST_VER"
id postgrest >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin postgrest
if [ ! -x /opt/postgrest/postgrest ]; then
  install -d /opt/postgrest
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$PGREST_VER/postgrest-$PGREST_VER-linux-static-x64.tar.xz" -o /tmp/postgrest.tar.xz
  tar -xJf /tmp/postgrest.tar.xz -C /opt/postgrest
  rm -f /tmp/postgrest.tar.xz
fi
PGREST_PORT=3401
cat > "$BASE/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:$AUTHPW@127.0.0.1:$PGPORT/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$PGREST_JWT_SECRET"
server-host = "127.0.0.1"
server-port = $PGREST_PORT
CONF
chown root:postgrest "$BASE/postgrest.conf"; chmod 640 "$BASE/postgrest.conf"

cat > /etc/systemd/system/postgrest.service <<UNIT
[Unit]
Description=PostgREST (Stack & Study database API, localhost only)
After=postgresql@$PGV-main.service
Requires=postgresql@$PGV-main.service

[Service]
User=postgrest
ExecStart=/opt/postgrest/postgrest $BASE/postgrest.conf
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now postgrest >/dev/null 2>&1
systemctl restart postgrest

echo "== 5/6 Service key for the app"
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
H=$(printf '{"alg":"HS256","typ":"JWT"}' | b64)
P=$(printf '{"role":"service_role","iss":"stack-and-study"}' | b64)
SIG=$(printf '%s.%s' "$H" "$P" | openssl dgst -sha256 -hmac "$PGREST_JWT_SECRET" -binary | b64)
SERVICE_KEY="$H.$P.$SIG"
umask 077
echo "$SERVICE_KEY" > "$BASE/service_key.txt"
echo "POSTGREST_PORT=$PGREST_PORT" > "$BASE/info.env"
echo "PGPORT=$PGPORT" >> "$BASE/info.env"

echo "== 6/6 Check"
sleep 2
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SERVICE_KEY" "http://127.0.0.1:$PGREST_PORT/chapters?limit=1")
anon=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PGREST_PORT/students?limit=1")
echo "   with the service key: HTTP $code (want 200)"
echo "   without a key:        HTTP $anon (want 401 or 403 — locked)"
[ "$code" = 200 ] && echo "OK — your own database is ready (still empty). Nothing has changed for students." || { echo "Something is off — send me the lines above."; exit 1; }
