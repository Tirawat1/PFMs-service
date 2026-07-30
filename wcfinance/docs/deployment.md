# Deployment

Two supported paths. Docker Compose is the recommended one.

---

## A. Docker Compose (recommended)

Needs Docker 24+ with the Compose plugin. Nothing else — no Node, no Postgres on
the host.

    git clone <your-repo> wcfinance && cd wcfinance
    cp .env.example .env

Edit `.env`:

    openssl rand -base64 48        # paste as AUTH_SECRET
    openssl rand -base64 24        # paste as POSTGRES_PASSWORD

`DATABASE_URL` must contain the same password, with host `db`:

    DATABASE_URL="postgresql://wcfinance:<POSTGRES_PASSWORD>@db:5432/wcfinance?schema=public"

Set `SEED_ADMIN_PASSWORD` to a strong password (12+ chars) and `APP_URL` to the
real origin. Then:

    docker compose up -d --build
    docker compose exec app npx prisma migrate deploy   # first run only
    docker compose exec app node prisma/seed.mjs        # roles, accounts, categories, admin

Check it:

    curl -s localhost:3000/api/health

Open `APP_URL` and sign in with the seeded admin. **Change that password.**

### Day to day

    docker compose logs -f app        # tail logs
    docker compose restart app        # restart
    docker compose down               # stop (data survives in the pgdata volume)
    docker compose pull && docker compose up -d --build   # update

---

## B. Node on the host

Needs Node 20+ and a reachable Postgres 14+.

    npm ci
    cp .env.example .env    # fill in, DATABASE_URL points at your Postgres
    npm run check:env
    npx prisma migrate deploy
    npm run db:seed
    npm run build
    npm start

Put it behind a process manager (systemd, pm2) and a reverse proxy.

---

## TLS

The app speaks plain HTTP on 3000. Terminate TLS in front of it. Caddy is the
shortest path — a two-line Caddyfile gets automatic certificates:

    finance.example.ac.th {
      reverse_proxy localhost:3000
    }

With nginx, proxy to `http://127.0.0.1:3000` and forward `Host`,
`X-Forwarded-For` and `X-Forwarded-Proto`. Once TLS is live, set `APP_URL` to
the `https://` origin and restart — session cookies are issued `secure` in
production and will not stick over plain HTTP.

---

## Backups

`scripts/backup.mjs` writes a compressed `pg_dump` to `backups/` and prunes to
the last 30. From the host, daily at 02:00:

    0 2 * * * cd /srv/wcfinance && docker compose exec -T app node scripts/backup.mjs

Restore into an empty database:

    docker compose exec -T app node scripts/restore.mjs backups/wcfinance-….dump

Test a restore into a scratch database before you need one for real. A backup
you have never restored is not a backup.

---

## Upgrading

    git pull
    docker compose up -d --build     # entrypoint applies new migrations on boot

Migrations are applied by `prisma migrate deploy`, which only runs committed
migrations. Take a backup first when a release touches the schema.
