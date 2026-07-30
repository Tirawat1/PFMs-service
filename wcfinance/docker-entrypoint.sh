#!/bin/sh
set -e

log() { echo "[entrypoint] $*"; }

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${AUTH_SECRET:?AUTH_SECRET is required — generate with: openssl rand -base64 48}"

# --- wait for postgres ----------------------------------------------------
host=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
port=$(echo "$DATABASE_URL" | sed -n 's|.*@[^:]*:\([0-9]*\).*|\1|p')
port=${port:-5432}

if [ -n "$host" ]; then
  log "waiting for postgres at ${host}:${port}"
  i=0
  until pg_isready -h "$host" -p "$port" >/dev/null 2>&1; do
    i=$((i+1))
    if [ "$i" -gt 60 ]; then
      log "database not reachable after 60s — aborting"
      exit 1
    fi
    sleep 1
  done
  log "postgres is up"
fi

# --- migrations -----------------------------------------------------------
if [ "${RUN_MIGRATIONS_ON_BOOT:-true}" = "true" ]; then
  log "applying migrations"
  npx prisma migrate deploy
else
  log "RUN_MIGRATIONS_ON_BOOT=false — skipping migrations"
fi

# --- first-run seed -------------------------------------------------------
if [ "${SEED_ON_BOOT:-false}" = "true" ]; then
  log "seeding reference data (idempotent)"
  node prisma/seed.mjs || log "seed skipped or already applied"
fi

log "starting: $*"
exec "$@"
