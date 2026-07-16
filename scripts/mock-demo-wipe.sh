#!/usr/bin/env bash
# Full factory reset of the pfms-app database: drops the Postgres data volume
# entirely and lets docker-entrypoint.sh (`prisma db push`) recreate an empty
# schema on next container start. After this, the DB is completely blank —
# the next admin login re-bootstraps roles/accounts/categories from scratch
# (app/api/auth/login/route.js → lib/seed-data.mjs → seedBaseline).
#
# Use this to remove demo/mock data (including the public demo-user passwords
# loaded by scripts/mock-demo-load.sh) before real users touch the environment.
#
# MUST run ON THE EC2 HOST, from the compose project directory (/opt/pfms) —
# it needs docker compose + the named volume, not just API access.
#
# Usage (on the server):
#   cd /opt/pfms
#   ./scripts/mock-demo-wipe.sh

set -euo pipefail

if [ ! -f docker-compose.yml ]; then
  echo "Run this from the compose project directory (e.g. /opt/pfms), not $(pwd)." >&2
  exit 1
fi

echo "This will PERMANENTLY DELETE ALL DATA in this deployment's Postgres volume:"
echo "  $(pwd)"
docker compose ps 2>/dev/null || true
echo
read -r -p "Type 'wipe' to confirm: " confirm
if [ "$confirm" != "wipe" ]; then
  echo "Aborted — no changes made."
  exit 1
fi

echo
echo "-- Stopping containers and removing volumes --"
docker compose down -v

echo "-- Starting fresh (entrypoint will push a clean schema) --"
docker compose up -d

echo "-- Waiting for app to come back up --"
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/api/auth/me > /dev/null 2>&1; then
    echo "App is up."
    break
  fi
  sleep 2
done

echo
echo "Done. Database is empty. Log in once as the admin user (from .env) to"
echo "re-bootstrap baseline roles/accounts/categories."
