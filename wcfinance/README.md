# WCFinance

Project-finance expense management for a faculty-run congress. Departments file
projected expenses and reimbursement requests; Faculty Finance verifies the
documents; Project Finance routes the funds and attaches proof of payment;
Faculty Purchasing issues purchase orders.

    Next.js 14 · Postgres 16 · Prisma · Docker Compose

---

## Quick start

    cp .env.example .env      # then fill in the secrets it names
    docker compose up -d --build
    docker compose exec app npx prisma migrate deploy
    docker compose exec app node prisma/seed.mjs

Open <http://localhost:3000> and sign in with the seeded admin. Change that
password immediately.

Full instructions, TLS and backups: **[docs/deployment.md](docs/deployment.md)**.

## Without Docker

    npm ci
    cp .env.example .env
    npm run check:env
    npx prisma migrate deploy && npm run db:seed
    npm run build && npm start

Needs Node 20+ and Postgres 14+.

---

## What's in the box

| Path | |
| --- | --- |
| `app/` | Next.js routes; `app/api/` is the JSON API |
| `components/` | Shared React components |
| `lib/` | Money, auth, workflow and audit logic — pure and tested |
| `prisma/` | Schema, migrations, seed data |
| `public/app.html` | The shipped UI, one self-contained file |
| `scripts/` | Env check, backup, restore, prototype import |
| `tests/` | `node:test` suites over `lib/` |
| `docs/` | Deployment, architecture, migration, operations |

## Features

- **Projected vs reimbursed** — coverage overall and per department, on the
  dashboard, with grouped bars, a pipeline distribution bar, purse allocation
  and monthly disbursed-against-projected.
- **Document-gated reimbursement** — per-category checklists with attachable
  examples, and per-document discrepancies that send a request back.
- **Split approval and payment** — Faculty Finance verifies; Project Finance
  disburses; Faculty Purchasing issues ใบสั่งจ้าง.
- **Payment details** — the department supplies the receiving bank account;
  Project Finance attaches proof of payment. Both audit-logged.
- **Direct claims** — categories that skip the projection step entirely.
- **Ledger-derived balances** — every purse sums to its account.
- **Full audit trail** — every state change, with actor and timestamp.

## Commands

    npm run dev          # development server
    npm run build        # production build
    npm start            # run the build
    npm test             # node:test over lib/
    npm run check:env    # fail loudly on a bad environment
    npm run db:migrate   # apply committed migrations
    npm run db:seed      # roles, accounts, categories, admin
    npm run db:studio    # browse the database
    npm run backup       # pg_dump into backups/

## Coming from the prototype?

The single-file app keeps its data in browser local storage — each browser has
its own copy. **[docs/migration.md](docs/migration.md)** walks through exporting
it and importing into Postgres, and lists what does not transfer.

## Before first real use

- Set a strong `AUTH_SECRET` and `POSTGRES_PASSWORD`; never ship the examples.
- Replace every seeded demo account and password.
- Terminate TLS in front of the app and set `APP_URL` to the https origin.
- Schedule `npm run backup`, and restore one into a scratch database to prove it.

## License

MIT — see [LICENSE](LICENSE).
