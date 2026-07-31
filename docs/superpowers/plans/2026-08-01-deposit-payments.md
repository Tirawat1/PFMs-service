# Deposit Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Project Finance pay a deposit against a request from a purse before the full amount is due (e.g. a venue booking that requires 30% upfront), then have the final disbursement automatically deduct only the remaining balance instead of the full request amount.

**Architecture:** Depends on `docs/superpowers/plans/2026-08-01-revenue-purses.md` for the `Stream` model (a deposit is paid out of a named purse). `Request` gains `depositAmount` (nullable, the amount paid as deposit), `depositPaid` (boolean), and `depositStreamId` (which purse it came from). `lib/deposit.mjs` holds `payDepositTx` (atomic: decrements the purse and the `project` account, creates one `Txn`, stamps the request) — same fake-Prisma testing convention as `lib/projections.mjs`. A new RPC action `payDeposit`. The existing disbursement branch of `advanceRequest` (in `app/api/rpc/route.js`) is extended so that when `r.depositPaid` is true, the amount transferred at disbursement is `r.amount - r.depositAmount`, not the full `r.amount` — the deposit already moved the money earlier.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- This plan assumes `docs/superpowers/plans/2026-08-01-revenue-purses.md` has already shipped (it adds the `Stream` model this plan pays deposits out of). If that plan has not shipped, apply its Task 1 first.
- A deposit can only be paid once per request in this plan's scope — `depositPaid` is a boolean, not a running total. Paying a second "deposit" on the same request is out of scope (would need a different data shape to track multiple partial payments) and is explicitly rejected rather than silently double-applied.
- The remaining-balance math at disbursement must never go negative — if a deposit somehow exceeds the request amount (a data-entry mistake elsewhere), disbursement of a negative or zero amount must be rejected with a clear error rather than silently transferring nothing or a negative number.
- Same fake-Prisma testing convention as the rest of the codebase.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — `Request.depositAmount`/`depositPaid`/`depositStreamId`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Request.depositAmount Float?`, `Request.depositPaid Boolean @default(false)`, `Request.depositStreamId String?` — consumed by Task 2 and Task 3.

- [ ] **Step 1: Add the columns**

In `model Request { ... }`, add directly below `vendorExists Boolean?`:

```prisma
  depositAmount     Float?
  depositPaid       Boolean  @default(false)
  depositStreamId   String?
```

- [ ] **Step 2: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push` (or `npx prisma validate` if no DB is reachable).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add Request deposit-payment columns"
```

---

### Task 2: `lib/deposit.mjs` — pay a deposit, compute the remaining balance

**Files:**
- Create: `lib/deposit.mjs`
- Test: `tests/deposit.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `payDepositTx(prisma, { reqId, streamId, amount, projectAcctId, title }) => Promise<{ ok: true }>` and `remainingAfterDeposit({ requestAmount, depositAmount, depositPaid }) => { error: string } | { amount: number }` — the latter consumed by Task 3's disbursement branch.

- [ ] **Step 1: Write the failing tests**

Create `tests/deposit.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { payDepositTx, remainingAfterDeposit } from "../lib/deposit.mjs";

function makeFakePrisma({ streamBalance, acctBalance, request }) {
  const state = { streamBalance, acctBalance, request: { ...request }, txns: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        stream: { update: async ({ data }) => { state.streamBalance -= data.balance.decrement; } },
        account: { update: async ({ data }) => { state.acctBalance -= data.balance.decrement; } },
        txn: { create: async ({ data }) => { state.txns.push(data); } },
        request: { update: async ({ data }) => { Object.assign(state.request, data); } },
      }),
  };
}

test("paying a deposit debits the purse and the project account and stamps the request", async () => {
  const prisma = makeFakePrisma({ streamBalance: 5000, acctBalance: 20000, request: { depositPaid: false } });
  await payDepositTx(prisma, { reqId: "RB-1042", streamId: "s_advance", amount: 3000, projectAcctId: "project", title: "Venue booking" });
  assert.equal(prisma.state.streamBalance, 2000);
  assert.equal(prisma.state.acctBalance, 17000);
  assert.equal(prisma.state.txns.length, 1);
  assert.equal(prisma.state.txns[0].type, "out");
  assert.equal(prisma.state.txns[0].streamId, "s_advance");
  assert.deepEqual(prisma.state.request, { depositPaid: true, depositAmount: 3000, depositStreamId: "s_advance" });
});

test("remainingAfterDeposit subtracts the deposit from the full request amount", () => {
  const result = remainingAfterDeposit({ requestAmount: 10000, depositAmount: 3000, depositPaid: true });
  assert.deepEqual(result, { amount: 7000 });
});

test("remainingAfterDeposit returns the full amount when no deposit was paid", () => {
  const result = remainingAfterDeposit({ requestAmount: 10000, depositAmount: null, depositPaid: false });
  assert.deepEqual(result, { amount: 10000 });
});

test("remainingAfterDeposit rejects a deposit that would leave nothing (or less) to disburse", () => {
  const result = remainingAfterDeposit({ requestAmount: 10000, depositAmount: 10000, depositPaid: true });
  assert.equal(result.error, "The deposit already covers the full amount — nothing remains to disburse.");
  const over = remainingAfterDeposit({ requestAmount: 10000, depositAmount: 12000, depositPaid: true });
  assert.equal(over.error, "The deposit already covers the full amount — nothing remains to disburse.");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/deposit.test.mjs` — expected FAIL, `lib/deposit.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/deposit.mjs`:

```js
// Pays a deposit for a request out of a named purse, debiting both the purse and the
// project account atomically, and stamps the request so the later disbursement step
// knows to deduct only the remaining balance. No compare-and-swap is needed — a request
// can only have one deposit paid in this plan's scope (see the plan's non-goal note),
// and the RPC layer is responsible for rejecting a second attempt before calling this.
export async function payDepositTx(prisma, { reqId, streamId, amount, projectAcctId, title }) {
  return prisma.$transaction(async (tx) => {
    await tx.stream.update({ where: { id: streamId }, data: { balance: { decrement: amount } } });
    await tx.account.update({ where: { id: projectAcctId }, data: { balance: { decrement: amount } } });
    await tx.txn.create({ data: { acctId: projectAcctId, streamId, type: "out", amount, desc: "Deposit — " + title } });
    await tx.request.update({ where: { id: reqId }, data: { depositAmount: amount, depositPaid: true, depositStreamId: streamId } });
    return { ok: true };
  });
}

// The amount still owed once a (possible) deposit is accounted for.
export function remainingAfterDeposit({ requestAmount, depositAmount, depositPaid }) {
  if (!depositPaid) return { amount: requestAmount };
  const remaining = requestAmount - (depositAmount || 0);
  if (remaining <= 0) return { error: "The deposit already covers the full amount — nothing remains to disburse." };
  return { amount: remaining };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/deposit.test.mjs` — expected PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/deposit.mjs tests/deposit.test.mjs
git commit -m "feat: add payDepositTx and remainingAfterDeposit"
```

---

### Task 3: RPC action — `payDeposit`; wire remaining-balance math into disbursement

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `payDepositTx`, `remainingAfterDeposit` from Task 2; `Stream` from the Revenue & Purses plan.
- Produces: RPC action `"payDeposit"`; extends the `next === "disbursed"` branch of `"advanceRequest"`.

- [ ] **Step 1: Import the new functions**

Add, alongside the other `lib/*` imports:

```js
import { payDepositTx, remainingAfterDeposit } from "@/lib/deposit.mjs";
```

- [ ] **Step 2: Add `payDeposit`**

Directly after the existing `case "advanceRequest": { ... }` block, add:

```js
      case "payDeposit": {
        if (!admin && !can(me, "disburse")) return err("Forbidden", 403);
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        if (r.depositPaid) return err("A deposit has already been paid for this request.");
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) return err("Enter a positive deposit amount.");
        if (amount >= r.amount) return err("The deposit cannot be the full (or more than the full) request amount — use normal disbursement instead.");
        const stream = await prisma.stream.findUnique({ where: { id: body.streamId } });
        if (!stream || !stream.active) return err("Purse is unavailable.");
        if (stream.balance < amount) return err("Insufficient balance in this purse for the deposit.");
        await payDepositTx(prisma, { reqId: r.id, streamId: stream.id, amount, projectAcctId: "project", title: r.title });
        await audit(me, "Paid deposit " + fmt(amount) + " for " + r.id + " from " + stream.name + " purse");
        await notifyUser(r.requesterId !== me.id ? r.requesterId : null, r.id + " — deposit of " + fmt(amount) + " paid from " + stream.name + ".", "disbursed");
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 3: Deduct only the remaining balance at disbursement**

In `case "advanceRequest": { ... }`, inside the `if (next === "disbursed") { ... }` block, directly after the existing `if (resolved.error) return err(resolved.error);` line, add:

```js
          const remaining = remainingAfterDeposit({ requestAmount: r.amount, depositAmount: r.depositAmount, depositPaid: r.depositPaid });
          if (remaining.error) return err(remaining.error);
```

Then, in the call to `advanceRequestTx(prisma, { ... })` a few lines below, change `amount: r.amount,` to `amount: r.depositPaid ? remaining.amount : r.amount,` (leave every other argument in that call unchanged — this affects only the amount actually transferred, not `r.amount` itself, which stays the full request amount for display and for the Advance Payments plan's settlement math to keep comparing against the true total).

- [ ] **Step 4: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. Pay a ฿3,000 deposit on a ฿10,000 request from a purse with sufficient balance — confirm the purse and project account both drop by ฿3,000 and one `Txn` is created. Disburse the request — confirm only ฿7,000 moves at disbursement (not ฿10,000), and the linked account's balance reflects exactly that. Attempt a second `payDeposit` on the same request — confirm it's rejected.

- [ ] **Step 5: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: wire payDeposit and remaining-balance disbursement math"
```

---

### Task 4: UI — "Pay deposit" modal + disbursement banner

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `payDeposit` RPC action (Task 3); `Request.depositAmount`/`depositPaid`/`depositStreamId`.
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Add the `payDeposit` modal**

In `Modal`'s `titles` map, add `payDeposit: "Pay deposit"`. In `submit()`, add:

```js
    else if (modal.type === "payDeposit") ok = await rpc("payDeposit", { id: modal.reqId, amount: form.amount, streamId: form.streamId }, "Deposit paid.");
```

Add the modal body:

```jsx
{modal.type === "payDeposit" && (<>
  <div className="field"><label className="label">Purse</label><select className="input" value={form.streamId || ""} onChange={set("streamId")}>{data.streams.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name} ({fmt(s.balance)})</option>)}</select></div>
  <div className="field"><label className="label">Deposit amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
</>)}
```

- [ ] **Step 2: Add the "Pay deposit" action and banner on request detail**

On `Detail`, add (visible when `admin || can("disburse")`, and only before a deposit is already paid):

```jsx
{(admin || can("disburse")) && !r.depositPaid && r.status !== "closed" && <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ amount: "", streamId: data.streams[0]?.id || "" }); setModal({ type: "payDeposit", reqId: r.id }); }}><i className="ph ph-coins" /> Pay deposit</button>}
```

When `r.depositPaid`, render a small banner: `Deposit of {fmt(r.depositAmount)} already paid — only the remaining balance will be deducted at disbursement.` (reuse the `.drive-banner` class for visual consistency with other informational banners already on this page).

- [ ] **Step 3: Show the same banner inside the disburse modal**

In the `disburse` modal body, if `modal.depositPaid` (pass this through when opening the modal from `Detail`, alongside `reqId`), render the same banner so the officer isn't surprised by a smaller transfer amount at the moment of disbursement.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`. Pay a deposit on a request, confirm the banner appears on both the detail page and the disburse modal, and confirm the actual amount transferred at disbursement matches the remaining balance.

- [ ] **Step 5: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add deposit payment UI and remaining-balance banner"
```

---

## Self-Review Notes

- **Spec coverage:** deposit paid from a purse (Task 1/2/3), remaining-balance deduction at disbursement (Task 2/3), one-deposit-per-request guard (Task 3, explicit non-goal in Global Constraints), UI for both paying and the resulting banner (Task 4) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Type/name consistency:** `payDepositTx`'s `{ reqId, streamId, amount, projectAcctId, title }` matches its Task 2 test and Task 3 call site; `remainingAfterDeposit`'s `{ error } | { amount }` return shape is used identically at its one call site.
- **Dependency called out explicitly:** this plan builds on `Stream` from `2026-08-01-revenue-purses.md` — apply that plan's Task 1 first if implementing this one standalone.
