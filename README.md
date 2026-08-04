# WC Finance — Project Finance Management System

Role-based reimbursement tracking for the Faculty of Pharmaceutical Sciences (IPSF World Congress 2026): expense categories with document checklists, Google Drive document links, discrepancy flagging, live account balances, notifications (in-app + optional email), and a full audit trail. EN/ไทย toggle. Mobile friendly.

**Stack:** Next.js 14 (App Router) · Prisma · PostgreSQL · JWT cookie auth (bcrypt) · Nodemailer (optional) · Google Drive / Google Sheets APIs (optional)

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
   - (optional) `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_PARENT_FOLDER_ID` — for real Google Drive folders/uploads
   - (optional) `GOOGLE_SHEETS_BACKUP_ID` — for the Google Sheets backup mirror
4. Deploy. The build runs `prisma db push` automatically to create the tables.
5. Open the site and log in as admin — the baseline data is created on first login.

> Supabase note: use the **connection pooling** string (port 6543) with `?pgbouncer=true` as `DATABASE_URL`.

## How the whole system works — end-to-end flow

This is a small number of building blocks (categories, accounts, purses, requests, projections, revenue) combined into one pipeline. Read top to bottom for the full lifecycle of money in the system.

### 1. Setup (admin, once)

- **Accounts** — real money sits here. Two are seeded by convention: `faculty` (the official government account, the primary funding source) and `project` (used to circulate money between requests). Admin can add more ad-hoc accounts (e.g. money handed to a department to buy things on its own), close/reopen them, and manually add/withdraw funds for corrections.
- **Purses** (a.k.a. streams) — sub-accounts inside any account, for earmarking money (e.g. "Sponsorships", "Registration Fees"). Any account can have purses now; a request or revenue item can be routed through a specific purse instead of the parent account directly.
- **Expense categories** — each defines: a document checklist (split into *pre-reimbursement* and *closing* phases, picked from the shared master Document Menu), whether a vendor name is required, whether direct claims are allowed (see below), the default paid-via track (Finance/Purchasing/PSAT), the approval clearance (which officer role can verify it), and an optional default source account.
- **Roles & permissions** — plain string keys (`dashboard`, `requests`, `create`, `verify`, `disburse`, `accounts`, `notifications`, or `*` for admin) assigned per role. `ADV_PERM` maps each pipeline status to the permission required to advance a request into it.

### 2. Starting an expense — two paths

- **Direct claim** — if a category has `allowDirect: true`, a department can submit a Reimbursement request straight away with no pre-approval.
- **Projected expense → advance** — for categories that don't allow direct claims (the default for most categories), the department first submits a **Projected Expense** (estimated title/amount/date). An officer with `verify` reviews it and either rejects it (with a reason) or **issues an advance**: this immediately transfers the projected amount from the Faculty account to the Project account (two linked transactions), and the projection becomes `advanced`. When the department later creates the actual Reimbursement request, they pick that advanced projection from a dropdown (auto-filling category/title/amount) instead of starting from a category.

### 3. The reimbursement pipeline

```
Notified → Docs Submitted → Verified → Funds Disbursed → Purchase Complete → Closed
```

Each forward step requires the matching permission *and* passes a guard: pre-reimbursement documents must all be submitted before `Docs Submitted`/`Verified`, no discrepancy may be open before `Verified`, and closing documents must all be submitted before `Purchase Complete`/`Closed` (unless the category turns that off). A request can be reversed one step back (refunding any disbursed amount) by whoever holds the permission for its current step.

Along the way, a request also carries optional supporting actions, available whenever relevant:

- **Report vendor** — for categories that require a vendor, the requester states whether the supplier is already a registered vendor; answering "no" auto-adds the vendor-registration documents (company certificate, VAT registration, etc.) to that request's checklist.
- **Issue PO** — records a purchase order (vendor, amount, link) — paperwork only, no money moves.
- **Pay deposit** — records a partial advance payment to the vendor from a chosen purse, reducing what's owed at final disbursement.
- **Route funds** — a one-off manual Faculty → a specific Project purse transfer for a verified request, independent of the projection/advance flow.
- **Discrepancy flagging** — an officer flags a submitted document with a note; the requester is notified, fixes it, marks it changed; the officer resolves it. A request can't reach `Verified` with an open discrepancy.

### 4. Disbursement

The officer with `disburse` picks: the source account (and purse, if any), the actual amount paid (may be less than requested — the difference is refunded), the payment route (direct to supplier / settled from an advance / self-pay to a department member), and attaches transfer proof — either uploaded straight into the request's Google Drive folder, or pasted as a link if Drive isn't available. If the request is linked to an advance, any unspent difference between the advance and the actual amount automatically flows back from the Project account to Faculty.

### 5. Money tracking

- Every balance change creates a `Txn` (`type: "in" | "out"`), shown on the **Accounts** page split into **Deposits** and **Withdrawals**, searchable by description or account.
- **Revenue** is the intended path for real incoming money (sponsorships, registration fees, donations, grants) — each entry records title, source, target purse, and expected date before being marked "received" and posted to the account. Plain **Add funds** exists on the Accounts page too, but is meant for admin corrections/opening balances, not everyday income — it has no source/audit trail beyond a free-text description.
- **Dashboard** rolls all of this up: total committed vs. spent vs. remaining, spend by category and by department, monthly trend, and open items needing attention per role.

### 6. Corrections & audit trail

Every mutating action — advancing a request, flagging/resolving a discrepancy, managing users/roles/categories/accounts, correcting a figure — goes through a single endpoint (`/api/rpc`) and is permission-checked and logged to the **Audit Trail** (who, what, when). Numeric corrections (account/purse/request/revenue amounts, transaction amounts) always require a reason. The most recent action a user took can be undone from the banner at the top of the app.

### 7. Documents & notifications

No files are stored on this server — every document is a Google Drive link. When Drive OAuth credentials are configured, each request gets a real Drive folder created automatically and files can be uploaded directly through the app (name auto-tagged with date/uploader); without credentials, the app falls back to pasting a link manually. In-app notifications always work; email is sent only when SMTP is configured, and is a per-user opt-in in Settings. Admin can also trigger a one-off mirror of the whole dataset into a Google Sheet as a human-readable backup.

## Features & roles summary

- **Pipeline:** Notified → Docs Submitted → Verified → Funds Disbursed → Purchase Complete → Closed, permission-gated per step (`create`, `verify`, `disburse`).
- **Projected expenses / advances:** pre-approve an estimated cost, advance funds Faculty → Project, settle (and auto-refund unspent) at disbursement.
- **Multi-account, multi-purse money tracking:** any number of accounts, each with its own purses; every movement is a searchable transaction.
- **Revenue tracking:** document incoming money's source before it's marked received.
- **Documents:** category-defined checklists from the shared master Document Menu; Google Drive links, uploaded directly or pasted.
- **Discrepancy workflow:** flag → notify → fix → resolve, with a hard gate before `Verified`.
- **Vendor registration:** auto-adds extra documents when a request's supplier isn't already a registered vendor (for categories that require a vendor).
- **Email notifications:** per-user opt-in; only sends when SMTP is configured, in-app notifications always work.
- **Admin:** users, roles + permissions, accounts, categories, master document menu, audit trail, Google Sheets backup.

## Project structure

```
app/
  page.js, layout.js, globals.css   UI shell
  api/auth/…                        login / logout / me
  api/data/route.js                 permission-filtered app snapshot
  api/rpc/route.js                  all mutations (permission-checked, one action per case)
  api/drive/upload/route.js         real Google Drive file upload (doc attachments + disbursement proof)
  api/cron/backup-sheets/route.js   scheduled Google Sheets backup endpoint
components/App.jsx                  the whole frontend (SPA) — every screen, no router
lib/                                db, auth, mail, constants, seed data, and pure business-logic modules
                                     (requests, projections, revenue, deposit, route-funds, corrections,
                                     transition-guards, drive, file-naming, sheets-backup, …)
prisma/schema.prisma                database schema
prisma/seed.mjs                     seed script
tests/                              node:test unit tests for the lib/ business logic
```
