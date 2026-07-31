# Inline Transaction Amount Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator correct a mistaken transaction amount (e.g. an extra zero entered when adding funds) directly from the Accounts page, with the account balance adjusted atomically to match, a mandatory reason captured, and the correction logged to the Audit Trail — instead of the only current fix being deleting and re-creating rows by hand.

**Architecture:** A pure function computes the balance delta for changing a `Txn`'s amount (accounting for whether the transaction is `"in"` or `"out"`). A `$transaction`-wrapped function applies the amount change and the account balance delta atomically, mirroring the compare-and-swap-free but atomic-write style already used by `advanceRequestTx` (transactions here don't need CAS since a `Txn` row has no workflow `status` to race on — the risk is two edits of the *same* row racing, which is out of scope for a single-admin correction flow and is called out as a non-goal). The RPC route adds an admin-only `editTransaction` action requiring a `reason` string. The Accounts page UI adds a pencil icon per transaction row opening a small form (amount + reason), matching the existing per-row action-icon pattern already used elsewhere on that page.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- `Txn.type` is either `"in"` or `"out"` (see `prisma/schema.prisma`'s `Txn` model) — the balance delta must respect this: increasing an `"in"` txn's amount increases the account balance by the same delta; increasing an `"out"` txn's amount *decreases* the account balance by that delta.
- Admin-only mutations follow the existing `if (!admin) return err("Forbidden", 403);` pattern.
- Every correction requires a non-empty `reason` (minimum 3 characters, matching the validation style already used for other reason fields such as `flagDiscrepancy`'s note) and is logged via `audit()`.
- Same fake-Prisma unit-testing convention as the rest of the codebase.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Pure delta calculation — `txnAmountDelta`

**Files:**
- Create: `lib/txn-edit.mjs`
- Test: `tests/txn-edit.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `txnAmountDelta({ type, oldAmount, newAmount }) => number` (the amount to add to the account's balance) — consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `tests/txn-edit.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { txnAmountDelta } from "../lib/txn-edit.mjs";

test("increasing an 'in' transaction increases the balance by the difference", () => {
  assert.equal(txnAmountDelta({ type: "in", oldAmount: 1000, newAmount: 1500 }), 500);
});

test("decreasing an 'in' transaction decreases the balance by the difference", () => {
  assert.equal(txnAmountDelta({ type: "in", oldAmount: 1000, newAmount: 100 }), -900);
});

test("increasing an 'out' transaction decreases the balance by the difference", () => {
  assert.equal(txnAmountDelta({ type: "out", oldAmount: 1000, newAmount: 10000 }), -9000);
});

test("decreasing an 'out' transaction increases the balance by the difference", () => {
  assert.equal(txnAmountDelta({ type: "out", oldAmount: 1000, newAmount: 100 }), 900);
});

test("an unchanged amount produces a zero delta", () => {
  assert.equal(txnAmountDelta({ type: "in", oldAmount: 500, newAmount: 500 }), 0);
  assert.equal(txnAmountDelta({ type: "out", oldAmount: 500, newAmount: 500 }), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/txn-edit.test.mjs`
Expected: FAIL — `lib/txn-edit.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/txn-edit.mjs`:

```js
// The amount to add to an account's balance when a transaction's amount changes from
// oldAmount to newAmount. An "in" txn contributes its amount directly to the balance,
// so the delta is (newAmount - oldAmount). An "out" txn subtracts its amount, so the
// delta is inverted: -(newAmount - oldAmount).
export function txnAmountDelta({ type, oldAmount, newAmount }) {
  const diff = newAmount - oldAmount;
  return type === "in" ? diff : -diff;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/txn-edit.test.mjs`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/txn-edit.mjs tests/txn-edit.test.mjs
git commit -m "feat: add txnAmountDelta helper"
```

---

### Task 2: Atomic edit transaction — `editTxnTx`

**Files:**
- Modify: `lib/txn-edit.mjs`
- Test: `tests/txn-edit.test.mjs`

**Interfaces:**
- Consumes: `txnAmountDelta` from Task 1.
- Produces: `editTxnTx(prisma, { id, acctId, type, oldAmount, newAmount }) => Promise<{ delta: number }>` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Append to `tests/txn-edit.test.mjs`:

```js
import { editTxnTx } from "../lib/txn-edit.mjs";

function makeFakePrisma({ balance }) {
  const state = { balance, txnUpdates: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        txn: {
          update: async ({ data }) => {
            state.txnUpdates.push(data);
          },
        },
        account: {
          update: async ({ data }) => {
            state.balance += data.balance.increment;
          },
        },
      }),
  };
}

test("editTxnTx updates the txn amount and adjusts the account balance atomically", async () => {
  const prisma = makeFakePrisma({ balance: 5000 });
  const result = await editTxnTx(prisma, { id: "t1", acctId: "faculty", type: "out", oldAmount: 1000, newAmount: 100 });
  assert.equal(result.delta, 900);
  assert.equal(prisma.state.balance, 5900);
  assert.equal(prisma.state.txnUpdates.length, 1);
  assert.deepEqual(prisma.state.txnUpdates[0], { amount: 100 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/txn-edit.test.mjs`
Expected: FAIL — `editTxnTx` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/txn-edit.mjs`:

```js
// Atomically updates a Txn's amount and applies the resulting balance delta to its
// account. No compare-and-swap is needed here (unlike advanceRequestTx) because a Txn
// row carries no workflow status to race against — see this plan's non-goal note on
// concurrent edits of the same row.
export async function editTxnTx(prisma, { id, acctId, type, oldAmount, newAmount }) {
  const delta = txnAmountDelta({ type, oldAmount, newAmount });
  return prisma.$transaction(async (tx) => {
    await tx.txn.update({ where: { id }, data: { amount: newAmount } });
    if (delta !== 0) {
      await tx.account.update({ where: { id: acctId }, data: { balance: { increment: delta } } });
    }
    return { delta };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/txn-edit.test.mjs`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/txn-edit.mjs tests/txn-edit.test.mjs
git commit -m "feat: add editTxnTx atomic transaction correction"
```

---

### Task 3: RPC action — `editTransaction`

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `editTxnTx` from Task 2.
- Produces: RPC action `"editTransaction"`.

- [ ] **Step 1: Import the new function**

Add, alongside the other `lib/*` imports at the top of the file:

```js
import { editTxnTx } from "@/lib/txn-edit.mjs";
```

- [ ] **Step 2: Add the action**

Directly after the existing `case "addFunds": { ... }` block, add:

```js
      case "editTransaction": {
        if (!admin) return err("Forbidden", 403);
        const newAmount = Number(body.amount);
        const reason = (body.reason || "").trim();
        if (!Number.isFinite(newAmount) || newAmount < 0) return err("Enter a valid amount (zero or more).");
        if (reason.length < 3) return err("A reason is required for every figure change.");
        const txn = await prisma.txn.findUnique({ where: { id: body.id } });
        if (!txn) return err("Not found", 404);
        if (newAmount === txn.amount) return err("The amount is unchanged.");
        const { delta } = await editTxnTx(prisma, {
          id: txn.id, acctId: txn.acctId, type: txn.type, oldAmount: txn.amount, newAmount,
        });
        await audit(me, "Correction — transaction \"" + txn.desc + "\" changed from " + fmt(txn.amount) + " to " + fmt(newAmount) + ". Reason: " + reason);
        return NextResponse.json({ ok: true, delta });
      }
```

- [ ] **Step 3: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. As admin, note an account's current balance and an existing transaction's amount and type. Call `editTransaction` with a corrected amount and a reason (via browser devtools `fetch`, same pattern as other plans' manual-verification steps). Confirm the transaction's amount and the account's balance both update consistently with `txnAmountDelta`'s rule, and an Audit Trail entry appears with the reason text.
Expected: balance matches hand-computed expectation exactly; non-admin call rejected with 403; empty/short reason rejected with the validation message.

- [ ] **Step 4: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: add editTransaction RPC action"
```

---

### Task 4: UI — pencil icon + correction modal on the Accounts page

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `editTransaction` RPC action (Task 3).
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Locate the Accounts page's transaction row rendering**

Run: `grep -n "txnRows\|Accounts\b" components/App.jsx` to find the component rendering each account's transaction list, and confirm the existing per-row action-icon pattern used elsewhere in the app (e.g. the edit-pencil icons already present on category chips or user rows) so the new icon matches existing markup/classes exactly.

- [ ] **Step 2: Add the pencil icon and correction form**

Per transaction row, visible only when the current user is admin, add a small pencil icon that opens a form with: the transaction's description and current amount shown read-only, a numeric input for the corrected amount, and a required textarea for the reason. Submitting calls `editTransaction` with `{ id: txn.id, amount, reason }`.

- [ ] **Step 3: Manual verification in the browser**

Run: `npm run dev`. As admin, open the Accounts page, click the pencil icon on a transaction, submit a correction with a reason, confirm the row's amount and the account's balance update in the UI without a full page reload (via whatever refetch/optimistic-update mechanism the rest of the page already uses), and confirm the Audit Trail page shows the correction.
Expected: no console errors; UI and server state agree after the edit.

- [ ] **Step 4: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add inline transaction amount correction UI"
```

---

## Self-Review Notes

- **Spec coverage:** inline amount correction (Task 1/2/3/4), balance stays consistent for both `"in"` and `"out"` transactions (Task 1's 5 tests cover all four increase/decrease × in/out combinations plus the zero-delta case), mandatory audited reason (Task 3), admin-only UI affordance (Task 4) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Type/name consistency:** `txnAmountDelta`'s `{ type, oldAmount, newAmount }` parameter shape matches `editTxnTx`'s destructuring in Task 2, which matches the RPC call site in Task 3.
- **Explicit non-goal:** concurrent edits to the *same* transaction row are not guarded with a compare-and-swap (unlike `advanceRequestTx`/`approveProjectionTx`) because this is a low-frequency, admin-only manual correction rather than a race-prone multi-user workflow step — called out explicitly in the Architecture section and Task 2's code comment rather than silently omitted.
