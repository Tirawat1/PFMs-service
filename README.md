# WC Finance — Project Finance Management System

Role-based reimbursement tracking for the Faculty of Pharmaceutical Sciences (IPSF World Congress 2026): expense categories with document checklists, Google Drive document links, discrepancy flagging, live account balances, notifications (in-app + optional email), and a full audit trail. EN/ไทย toggle. Mobile friendly.

**Stack:** Next.js 14 (App Router) · Prisma · PostgreSQL · JWT cookie auth (bcrypt) · Nodemailer (optional)

## Quick start (local)

```bash
cp .env.example .env      # fill in DATABASE_URL + AUTH_SECRET
npm install
npx prisma db push        # creates tables
npm run seed              # optional: baseline + demo data (add --no-demo to skip demo)
npm run dev               # http://localhost:3000
```

If you skip the seed, the first login attempt bootstraps the database automatically (roles, categories, document menu, accounts) and creates the admin account from `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Just sign in with those credentials. The admin can then load the demo dataset from **Settings → Load demo data**.

### Demo logins (after seeding with demo data)

- `Pikajuz` / `WCFin` — Admin (Project Finance)
- `pm` / `pm123` — Project Manager
- `finance` / `fin123` — Faculty Finance Officer (verify + disburse)
- `purchasing` / `pur123` — Faculty Purchasing Officer (verify)
- `dept` / `dept123` — Department User (create requests)

Change all passwords before real use (delete + recreate users in **Users & Roles**).

## Deploy to Vercel

1. Create a Postgres database (Neon, Vercel Postgres, or Supabase) and copy its connection string.
2. Push this folder to a GitHub repo, then **Import** it in Vercel.
3. Set environment variables in Vercel → Project → Settings → Environment Variables:
   - `DATABASE_URL` — the Postgres connection string
   - `AUTH_SECRET` — `openssl rand -hex 32`
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD` — first admin account
   - (optional) `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — for email notifications
4. Deploy. The build runs `prisma db push` automatically to create the tables.
5. Open the site and log in as admin — the baseline data is created on first login.

> Supabase note: use the **connection pooling** string (port 6543) with `?pgbouncer=true` as `DATABASE_URL`.

## Features & roles

- **Pipeline:** Notified → Docs Submitted → Verified → Funds Disbursed → Purchase Complete → Closed. Each step is advanced only by roles holding the matching permission (`create`, `verify`, `disburse`); disbursement deducts the project account and records a transaction.
- **Documents:** each expense category defines a checklist (from the admin-managed master Document Menu). Requesters attach Google Drive links — no files are stored on the server.
- **Discrepancy workflow:** an officer (verify permission) or admin flags a submitted document with a note → requester is notified → requester marks "I changed the document" (officer notified) → officer marks **Case solved** (requester notified).
- **Email notifications:** per-user toggle in Settings. Emails send only when SMTP is configured; in-app notifications always work.
- **Admin:** users, roles + permissions, categories, master document menu, audit trail.

## Project structure

```
app/
  page.js, layout.js, globals.css   UI shell
  api/auth/…                        login / logout / me
  api/data/route.js                 permission-filtered app snapshot
  api/rpc/route.js                  all mutations (permission-checked)
components/App.jsx                  the whole frontend (SPA)
lib/                                db, auth, mail, constants, seed data
prisma/schema.prisma                database schema
prisma/seed.mjs                     seed script
```
