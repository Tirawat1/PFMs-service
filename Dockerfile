# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
# node:20-alpine ships no libssl at all — Prisma's engine can't detect an
# OpenSSL version to target and silently defaults to one that isn't present,
# which breaks the query engine at runtime (not just a warning).
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate only — schema push happens at container start (see docker-entrypoint.sh)
# because the DB isn't reachable during image build.
RUN npx prisma generate
RUN npx next build && test -d .next && test -d .next/static

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
# The runtime uses the standard Next.js build output. The `prisma` CLI itself is a
# devDependency and must be copied explicitly so `prisma db push` works at container
# start without reaching out to npm.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/prisma ./prisma

# prisma/seed.mjs (via lib/seed-data.mjs) needs bcryptjs and its own source —
# standalone output only bundles what Next's own server routes reference, and
# it *inlines* bcryptjs into the compiled route chunks rather than leaving it
# as a loose node_modules package. That's invisible to app routes (login
# works fine) but breaks this script, which runs as plain `node` outside
# Next's bundler and needs the real package present on disk.
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/package.json ./package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && chown nextjs:nodejs ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npx", "next", "start", "-p", "3000"]
