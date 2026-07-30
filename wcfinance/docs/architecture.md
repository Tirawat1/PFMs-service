# Architecture

## Shape

    browser ──► Next.js (node:20, standalone) ──► Postgres 16
                    │
                    └── public/app.html   the single-file UI

One container for the app, one for the database, one volume for the data. No
queue, no cache, no object store — the load is a few dozen staff during one
congress cycle, and every added moving part is another thing to back up.

## Why the UI is one file

`public/app.html` is a self-contained build of the design prototype: markup,
styles, fonts, icons and logic inlined, no network calls at runtime. It works
from `file://` for demos and is served by Next in production, so there is
exactly one artifact to hand over and one origin to secure.

It keeps its data in browser local storage. That is fine for a single reviewer
and wrong for a shared deployment — which is what the API in `app/api/` and the
schema in `prisma/` exist to replace. See `docs/migration.md`.

## Data model

Ten tables, grouped:

- **identity** — `roles`, `users`. A role carries a permission array; `*` is the
  wildcard. Everything downstream keys off `can(permissions, …)`.
- **money** — `accounts` (faculty, project), `streams` (the purses inside the
  project account), `transactions` (the ledger). Account and stream balances are
  *derived* from the ledger, never hand-written.
- **catalog** — `categories`, each with its document checklist, default source
  account, paid-via route, approver role, and direct-claim flag.
- **workflow** — `requests` + `request_docs`, `projections`, `revenues`.
- **trail** — `audit_entries`, `notifications`, `settings`.

Amounts are `BigInt` satang everywhere. Floats are never allowed near money.

## The two flows

**Projected → reimbursed.** A department files a projection; Project Finance
approves it (optionally advancing funds); the department later files the actual
reimbursement request, which links back to its projection. The dashboard's
coverage figure is the ratio of these two, overall and per department.

**Direct claim.** Categories with `allowDirect` skip the projection entirely.
The request inherits the category's account, route, approver and checklist, and
is tagged as a direct claim in the audit trail.

## Request pipeline

    notified → docs_submitted → verified → disbursed → purchase_complete → closed

Faculty Finance verifies documents and can raise a per-document discrepancy that
sends the request back to the department. Project Finance moves money and
attaches proof of payment. Faculty Purchasing issues the ใบสั่งจ้าง once a
request is verified. Each transition writes an audit line and a notification in
the same transaction — the trail cannot drift from the data.

`lib/workflow.js` is the single definition of that pipeline; the UI, the API and
the tests all read it.

## Payment details

Before money moves, the receiving department supplies a bank account (holder,
bank, account number, branch, PromptPay, note) stored on the request. After
disbursement, Project Finance attaches proof of payment (slip link, reference,
date). Both are stamped with who and when, both are audit-logged, and both
notify the other side. Reversing a disbursement clears the proof.
