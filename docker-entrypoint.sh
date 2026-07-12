#!/bin/sh
set -e

echo "Applying Prisma schema to database..."
./node_modules/.bin/prisma db push --accept-data-loss --skip-generate

if [ "$SEED_ON_START" = "true" ]; then
  echo "SEED_ON_START=true — running seed script..."
  node prisma/seed.mjs
fi

exec "$@"
