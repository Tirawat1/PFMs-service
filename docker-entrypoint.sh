#!/bin/sh
set -e

echo "Applying Prisma schema to database..."
# invoke the CLI entry directly rather than via node_modules/.bin/prisma — the
# .bin shim resolves its companion prisma_schema_build_bg.wasm relative to its
# own directory, which breaks once copied out of a full node_modules install.
node node_modules/prisma/build/index.js db push --accept-data-loss --skip-generate

if [ "$SEED_ON_START" = "true" ]; then
  echo "SEED_ON_START=true — running seed script..."
  node prisma/seed.mjs
fi

exec "$@"
