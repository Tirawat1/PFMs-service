# Disbursement modal richness

Ref: `docs/design_PFMS_feature.md` §6 (priority #1 gap). Closes the gap between our
disbursement flow (source account + proof link only) and the mockup's richer modal:
payment route, purse (stream) selection, and an officer-editable actual-paid amount
that can be less than the requested amount.

## Goal

At the `disbursed` transition, the officer can:
1. Pick a **payment route** — `direct` (straight to supplier), `advance` (already
   advanced into Project, now settling), or `selfpay` (transfer to a department member
   who pays the supplier — requires `payee` name + a mandatory `payNote`).
2. Pick a **purse (Stream)** to debit from, when the chosen account has active purses —
   debits both the stream and the account, same pattern as `payDepositTx`.
3. Enter an **actual amount paid**, defaulting to `r.amount`, which may be less (never
   more) — the disbursed amount is `actualAmount − deposit already paid`. When the
   request is linked to a projection, this `actualAmount` (not `r.amount`) is what
   `settleProjectionTx` compares against the advanced amount to compute the Faculty
   refund — letting an under-budget actual invoice trigger a refund even for
   projection-linked requests where `r.amount` alone wouldn't reveal it.

## Schema (`prisma/schema.prisma`, `Request` model)

```prisma
payRoute      String  @default("direct") // direct | advance | selfpay
payee         String  @default("")
payNote       String  @default("")
actualAmount  Float?
streamId      String? // purse that funded the disbursement, when acctId has purses
```

## `lib/requests.mjs`

Add a pure validator:

```js
const PAY_ROUTES = ["direct", "advance", "selfpay"];

export function validateDisbursement({ route, payee, payNote, actualAmount, requestAmount }) {
  if (!PAY_ROUTES.includes(route)) return { error: "Invalid payment route." };
  if (route === "selfpay") {
    if (!(payee || "").trim()) return { error: "Enter who will receive the funds." };
    if (!(payNote || "").trim()) return { error: "A note is required for a self-pay disbursement." };
  }
  const actual = actualAmount === undefined || actualAmount === null || actualAmount === "" ? requestAmount : Number(actualAmount);
  if (!Number.isFinite(actual) || actual <= 0) return { error: "Enter a valid actual amount paid." };
  if (actual > requestAmount) return { error: "Actual amount paid cannot exceed the requested amount." };
  return { actual };
}
```

Extend `advanceRequestTx` to accept `streamId, payRoute, payee, payNote, actualAmount`
and, when disbursing: decrement the stream balance too (if `streamId`), tag the `Txn`
with `streamId`, and persist all the new fields onto the request alongside `acctId` /
`disburseProofLink`.

## `app/api/rpc/route.js` (`advanceRequest`, `next === "disbursed"` branch)

- Validate via `validateDisbursement` using `body.route, body.payee, body.payNote,
  body.actualAmount, requestAmount: r.amount` → `actualAmount`.
- Compute `remaining` via the existing `remainingAfterDeposit` but with
  `requestAmount: actualAmount` instead of `r.amount`.
- If `body.streamId` given: look up the stream, require `active` and
  `stream.acctId === acctId` and `stream.balance >= remaining.amount`.
- Pass `streamId, payRoute: route, payee, payNote, actualAmount` into `advanceRequestTx`.
- When settling a linked projection, pass `actualAmount: actualAmount` (not `r.amount`)
  to `settleProjectionTx`.
- Audit line includes the route (and payee, for selfpay).

## `components/App.jsx`

- Opening the disburse modal: seed `form` with `route: "direct", payee: "", payNote: "",
  actualAmount: r.amount, streamId: ""`; pass `reqAmount: r.amount` on the modal object.
- Disburse modal body: payment-route select; when `selfpay`, show payee + payNote
  inputs; purse select shown only when `(data.streams||[]).filter(s => s.active &&
  s.acctId === form.acctId)` is non-empty; "Actual amount paid" number input.
- Submit guard: require `acctId`, `proofLink`, and if `selfpay` also `payee`/`payNote`,
  and a positive `actualAmount` not exceeding `reqAmount`.
- Detail page: show `payRoute`/`payee` and `actualAmount` (if different from `r.amount`)
  in the existing "Disbursed from" info box.

## Non-goals (this plan)

- Bank-info display in the modal (§7, separate plan).
- The `fundRoute`/"Route Funds" manual Faculty→Project transfer (§7, separate plan).
- Workflow transition guards (§3, separate plan).
