# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WC Finance (PFMS) — role-based reimbursement tracking for a university faculty event. Requests move through a fixed pipeline (`Notified → Docs Submitted → Verified → Funds Disbursed → Purchase Complete → Closed`); each transition is gated by a permission, disbursement moves money between accounts, and a discrepancy workflow lets officers kick documents back to requesters. EN/ไทย toggle, no file storage (documents are Google Drive links only).

**Stack:** Next.js 14 (App Router) · Prisma · PostgreSQL · JWT cookie auth (bcrypt) · Nodemailer (optional).

## Project goals (target requirements)

This is the real-world workflow the app is meant to fully support. Written down here so future work has a fixed target, not just "whatever the code currently does."

- **Multi-department submission, faculty-level review.** Each department (ฝ่าย) submits its own reimbursement requests. A faculty-level office (คณะ) reviews them, split into two distinct staff functions:
  - **Finance officer (การเงิน)** — verifies and disburses funds.
  - **Procurement officer (พัสดุ)** — verifies purchasing-related documents.
  - Which officer/staff a given request actually needs — and which documents are required — depends on the **expense category**, not a single fixed reviewer for everything.
- **Multiple bank accounts, tracked per movement.** Money moves between more than one account, and every request should record which account it came from / went to:
  - The faculty's official government account (บัญชีคณะ/ราชการ) — the primary source of funds.
  - A personal/informal account used to circulate cash between requests (บัญชีบุคคลที่เปิดไว้หมุนเงินกันเอง).
  - Potentially other ad-hoc accounts — e.g. money transferred to a department so that department buys things on its own.
- **End-to-end tracking**, across the whole lifecycle:
  - Document status per request (submitted, missing, flagged).
  - Where the money currently sits (which account, disbursed or not).
  - Request status from initial ask through to the final consolidated receipt submission.
  - Overall project-level money status (how much of the total budget is committed/spent/remaining), not just per-account balances.
- **Full audit trail** — who did what, when, on every request/document/account action.
- **Discrepancy/remark workflow** — an officer can flag a submitted document as wrong and leave a note; the requester fixes it; the officer resolves it.

### Gap check against current implementation (as of 2026-07-16 — closed)

All five gaps identified on 2026-07-15 are now implemented (multi-account disbursement routing feature):
- ✅ Audit trail (`Audit` model + `audit()` helper) logs create/advance/flag/resolve/account-management actions with user, role, timestamp.
- ✅ Discrepancy/remark flow is fully implemented (`flagDiscrepancy` / `fixDiscrepancy` / `resolveDiscrepancy` in `app/api/rpc/route.js`).
- ✅ **Arbitrary accounts** (not just the original `faculty`/`project` pair) — `Account.active` supports soft-close; admin-only RPC actions `createAccount`/`updateAccount`/`closeAccount`/`addFunds` manage them; the Accounts page has admin UI for all four plus a "Total spent"/"Total remaining" rollup.
- ✅ **Category → account routing** — `Category.defaultAcctId` sets a default source account per expense category (editable from the category edit screen); the finance officer can still override it at disburse time.
- ✅ **Per-request account tracking** — `Request.acctId` (set at disburse time) and `Request.disburseProofLink` (a required transfer-proof link) record exactly which account paid a given request and the evidence for it; disbursement is a modal (not a one-click action) that collects both. `advanceRequestTx`/`resolveDisburseAccount` (`lib/requests.mjs`) validate and debit the resolved account instead of a hardcoded `"project"`.
- ✅ **Backdatable event date** — `Request.eventDate` records when the expense actually happened, independent of `createdAt`, for entering historical data.
- ✅ Two distinct staff roles — `faculty_finance` (verify + disburse) and `faculty_purchasing` (verify only) — see `lib/seed-data.mjs`.
- ✅ Category-based document checklists, department field on requests/users, full request pipeline with permission-gated advancement.

Design/plan docs: `docs/superpowers/specs/2026-07-15-multi-account-disbursement-design.md`, `docs/superpowers/plans/2026-07-15-multi-account-disbursement.md`.

## Commands

```bash
cp .env.example .env      # fill in DATABASE_URL + AUTH_SECRET
npm install
npx prisma db push        # sync schema to the DB (no migration files — schema.prisma is the source of truth)
npm run seed              # optional: baseline + demo data (--no-demo to skip demo)
npm run dev               # http://localhost:3000
npm run build             # prisma generate && prisma db push --accept-data-loss && next build
```

There is no test suite and no lint script configured in `package.json`.

Docker: `docker-compose.yml` runs Postgres + the app; `docker-entrypoint.sh` runs `prisma db push` at container start (not at build time, since the DB isn't reachable during image build) and optionally seeds when `SEED_ON_START=true`. See `step_deploy_explained.md` and `terraform/` for the EC2/Terraform deployment path.

## Architecture

This is deliberately a small, flat app — not a typical multi-page Next.js structure:

- **`components/App.jsx`** is the entire frontend: a single client-side SPA component covering all views (dashboard, requests, categories, users/roles, accounts, notifications, settings), rendered from one `app/page.js`. There is no client-side router — navigation is state inside this component. When making UI changes, this is almost always the file to edit.
- **`app/api/data/route.js`** (GET) returns one full "app snapshot" per load — all roles/users/categories/accounts/requests/notifications — filtered down by the caller's permissions server-side. The frontend does not make granular REST calls; it re-fetches this snapshot after mutations.
- **`app/api/rpc/route.js`** (POST) is the single mutation endpoint. Every write in the app — advancing a request, attaching a document, flagging/resolving a discrepancy, managing users/roles/categories — is a `case` in the `switch (action)` block there, each with its own permission check. New mutations go here as a new `action` case, not as a new route.
- **Permissions** are just string keys (`PERMKEYS` in `lib/constants.js`) stored as a JSON array on `Role.perms`; `"*"` means admin/all. Check with `can(user, key)` from `lib/auth.js`. `ADV_PERM` in `lib/constants.js` maps each pipeline status to the permission required to advance a request *into* it.
- **`lib/auth.js`** — JWT session cookie (`jose`), `getSessionUser()` reads it and loads the user + role from Prisma on every request (no separate session store).
- **Notifications**: `notifyUser` / `notifyPerm` in `app/api/rpc/route.js` write in-app `Notification` rows and best-effort email via `lib/mail.js` (`sendMailToUser` no-ops silently if SMTP env vars aren't set — email is always optional).
- **First-run bootstrap**: `app/api/auth/login/route.js` seeds baseline roles/categories/admin user (from `ADMIN_USERNAME`/`ADMIN_PASSWORD`) on first login if the `Role` table is empty (`lib/seed-data.mjs`), so there's no separate "setup" step in normal (non-Docker) use.
- **Requests store their document checklist as JSON** (`Request.docs`), not as a relation — each entry is `{name, submitted, link, fileName, disc}` where `disc` (or `null`) holds the open/fixed discrepancy state. Category document checklists (`Category.docs`) are also JSON arrays of strings, drawn from the admin-managed `MasterDoc` list.
- **No file uploads**: attaching a document just stores a Google Drive URL string; `driveFolder` on each request is a synthesized link (`.../PFMS-<request id>`), not a real created folder.
- Prisma schema has no migrations directory — `prisma db push` is used everywhere (dev, build, and container start) instead of `prisma migrate`.
