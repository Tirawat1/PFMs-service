# Multi-account disbursement routing — design

Date: 2026-07-15
Status: approved (pending user sign-off on this doc)

## Problem

CLAUDE.md's gap-check (2026-07-15) identified that the account model doesn't
match the real workflow: disbursement is hardcoded to a single account
(`"project"`), only two accounts can ever exist, `Category` has no link to a
required source account, `Request` has no field recording which account it
was actually paid from, and there's no rolled-up "total spent / total
remaining" view. This design closes all five gaps in one pass.

Also folded in during design review: requesters need to backdate a request's
`eventDate` to when the expense actually happened, since data entry is
happening after the fact (project already in progress).

## Scope

One cohesive feature: **arbitrary accounts + category-driven default routing
+ per-request account/proof tracking + a spend rollup view.** Not split into
separate specs — the pieces are tightly coupled (you can't sensibly do
per-request account tracking without first supporting more than 2 accounts).

## Data model (`prisma/schema.prisma`)

```prisma
model Account {
  id      String  @id
  name    String
  nameTh  String  @default("")
  icon    String  @default("ph-bank")
  balance Float   @default(0)
  active  Boolean @default(true)   // NEW — soft-close, never hard-delete (Txn/Request still reference acctId)
}

model Category {
  id            String  @id @default(cuid())
  name          String
  nameTh        String  @default("")
  icon          String  @default("ph-tag")
  docs          Json
  notes         String  @default("")
  defaultAcctId String?           // NEW — default source account for this expense type; nullable, officer must pick manually if unset
}

model Request {
  id                String   @id
  title             String
  categoryId        String
  amount            Float
  dept              String
  requesterId       String?
  requesterName     String
  status            String   @default("notified")
  desc              String   @default("")
  driveFolder       String   @default("")
  docs              Json
  eventDate         DateTime @default(now())  // NEW — when the expense/work actually happened, editable/backdatable, independent of createdAt
  acctId            String?                   // NEW — account actually debited, set at disburse time (not creation)
  disburseProofLink String   @default("")     // NEW — proof-of-transfer link, required before disburse completes
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

`Txn` is unchanged — `acctId` on each row will now correctly point at
whichever account was actually debited instead of always `"project"`.

Existing `"faculty"`/`"project"` account rows keep working unmodified;
`defaultAcctId`/`acctId` being nullable means existing categories/requests
don't need a backfill migration beyond `prisma db push`.

## RPC actions (`app/api/rpc/route.js`)

**Accounts (admin-only, mirrors the existing `createCategory` pattern —
`if (!admin) return err("Forbidden", 403)`):**

| action | body | effect |
|---|---|---|
| `createAccount` | `{ name, nameTh, icon }` | creates with `balance: 0`, `active: true` |
| `updateAccount` | `{ id, name, nameTh, icon }` | edits display fields |
| `closeAccount` | `{ id }` | sets `active: false` — hidden from disburse dropdowns, keeps historical `Txn`/`Request` intact |
| `addFunds` | `{ acctId, amount, desc }` | `balance.increment(amount)` + `Txn` row `type:"in"` |

**Category management** — `createCategory` and the update path gain
`defaultAcctId` in the accepted payload (validated against existing active
account ids if provided).

**`createRequest`** — accepts `eventDate` in body; parsed as a `Date`,
defaults to `new Date()` if omitted or unparseable.

**`advanceRequest`**, when `next === "disbursed"` only:

1. Resolve `acctId`: `body.acctId` if provided, else `category.defaultAcctId`, else → `err("Select a source account first.")`.
2. Require `body.proofLink` non-empty → else `err("Attach a transfer proof link before disbursing.")`.
3. Look up the account; if missing or `active: false` → `err("Selected account is not available.")`.
4. Pass `acctId` and `proofLink` into `advanceRequestTx`.

Other transitions (`docs_submitted`, `verified`, `purchase_complete`,
`closed`) are unchanged — no new body fields, same single-click flow.

**`lib/requests.mjs` — `advanceRequestTx`:**

```js
export async function advanceRequestTx(prisma, { id, currentStatus, nextStatus, isDisbursement, amount, title, acctId, proofLink }) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.request.updateMany({
      where: { id, status: currentStatus },
      data: { status: nextStatus },
    });
    if (result.count === 0) return { conflict: true };
    if (isDisbursement) {
      await tx.account.update({ where: { id: acctId }, data: { balance: { decrement: amount } } });
      await tx.txn.create({ data: { acctId, type: "out", amount, desc: "Disbursement — " + title } });
      await tx.request.update({ where: { id }, data: { acctId, disburseProofLink: proofLink } });
    }
    return { conflict: false };
  });
}
```

Audit log messages for `createAccount`/`updateAccount`/`closeAccount`/
`addFunds` follow the existing `audit(me, "...")` convention used by
category/user management.

## Frontend (`components/App.jsx`)

- **Disburse action becomes a modal**, not a one-click button (today every
  transition — including disburse — is `rpc("advanceRequest", { id: r.id })`
  fired directly from the button at line ~358). Only the `disbursed`
  transition needs the modal:
  - Account dropdown, prefilled from `category.defaultAcctId` when set,
    listing only `active` accounts, always editable by the finance officer.
  - Required proof-link text input.
  - Confirm button disabled until both fields are filled; submits
    `rpc("advanceRequest", { id: r.id, acctId, proofLink })`.
  - All other transitions keep today's single-click behavior unchanged.
- **New request form** gains an `eventDate` date picker, defaulting to
  today, freely editable (including backdating).
- **Accounts page** gains an admin-only management section (gated the same
  way the existing Categories/Users admin sections are):
  - "Add account" (name, nameTh, icon).
  - Per-account edit / close (soft-close) actions.
  - "Add funds" action per account.
  - Two new top-of-page stats, computed from existing data (no new schema
    needed): **Total spent** (sum of `Txn` rows where `type === "out"`) and
    **Total remaining** (sum of `balance` across `active` accounts).
- **Category edit screen** gains a "default account" dropdown bound to
  `defaultAcctId`.
- **Request detail card** displays `eventDate`; once disbursed, also shows
  the resolved account name and the proof link (read-only).

## Error handling

- All new admin RPC actions follow the existing `if (!admin) return err(...)`
  gate — no new permission key needed (admin-only per user decision).
- `advanceRequest` validation errors (missing account, missing proof link,
  inactive account) return `err(message, 400)` the same way existing
  validation in that route does, and the frontend modal surfaces them as the
  existing toast/error pattern already used elsewhere in `App.jsx`.
- Optimistic-locking conflict handling (`result.conflict`) is untouched.

## Testing

Extend the existing `node --test` suite (`tests/`) alongside the current
request-transaction-atomicity tests:

- `advanceRequestTx` disburses from the passed `acctId`, not a hardcoded one.
- `advanceRequestTx` writes `acctId`/`disburseProofLink` onto the `Request`
  row atomically with the balance/`Txn` update.
- `advanceRequest` RPC rejects disbursement with no resolvable account and
  with an empty proof link.
- `closeAccount` accounts are excluded from the disburse-dropdown data but
  still resolve correctly for historical requests already pointing at them.

## Out of scope (explicitly deferred)

- Non-admin account management permission (user chose admin-only for now).
- A hard project-level budget ceiling / cap field (user chose to use the
  live sum of account balances as the ceiling instead of a separate stored
  budget number).
- Counting in-flight (not-yet-disbursed) requests as "committed" — only
  `disbursed`-and-later requests count toward spent/remaining, matching
  what the `Txn` ledger already reflects.
