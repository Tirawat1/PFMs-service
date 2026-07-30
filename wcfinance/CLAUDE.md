# WCFinance — working notes

Read this before changing anything.

## What this is

Expense management for a faculty-run congress: departments file projected
expenses and reimbursement requests, Faculty Finance verifies the documents,
Project Finance moves the money, Faculty Purchasing issues purchase orders.

Two Thai-university specifics that drive the whole design:

- The **faculty** account and the **project** account are separate. Money is
  advanced from one to the other, and both sides have to reconcile.
- Reimbursement is **document-gated**. Each expense category has its own required
  paperwork; a single wrong customer name on a receipt sends it back.

## Non-negotiables

1. **Money is BigInt satang.** Never a float, never a Number. `lib/money.js` has
   the conversions. A rounding bug here is a real accounting discrepancy.
2. **Balances derive from the ledger.** Account and stream balances are computed
   from `transactions`. Never write a balance directly.
3. **Every state change writes an audit line, in the same transaction.** If the
   trail can diverge from the data, the system is not usable for an audit.
4. **Permissions are enforced in the query.** Scope by department in the `where`
   clause. Hiding a row in the UI is not access control.
5. **The pipeline lives in `lib/workflow.js`.** No status string literals
   anywhere else.

## Layout

    app/          Next.js routes; app/api/* is the JSON API
    components/   shared React components (see components/README.md)
    lib/          pure logic — money, auth, workflow, audit. Tested.
    prisma/       schema, migrations, seed
    public/       app.html — the shipped single-file UI
    scripts/      env check, backup, restore, prototype import
    tests/        node:test over lib/
    docs/         deployment, architecture, migration, operations

## The UI is one file

`public/app.html` is a self-contained build — inlined styles, fonts, icons and
logic, no build step, no network calls. It is edited as a design source
elsewhere and rebuilt whole; **do not hand-patch it here.** Ports to real Next.js
routes go in `app/`, screen by screen.

## Conventions

- Thai labels sit alongside English (`name` / `nameTh`). Keep both.
- Dates are stored UTC, displayed in Asia/Bangkok.
- Ids are human-readable and meaningful: `RB-` requests, `PJ-` projections,
  `RV-` revenues. Keep the prefixes.
- Comments explain *why*, not *what*.

## Before you ship

    npm run check:env && npm test && npm run build
