# Universal Correction & Migration Status Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the figure-correction pattern already shipped for transactions (`docs/superpowers/plans/2026-07-31-inline-transaction-edit.md`) to every other numeric record in the system — account balances, purse balances, and the amount fields on requests/projections/revenues — plus let transactions be deleted outright (with the balance reversed), and let a designated data-migration operator force a record's `status` directly when importing pre-existing historical data that didn't go through the normal workflow.

**Architecture:** Depends on `docs/superpowers/plans/2026-08-01-revenue-purses.md` for `Stream`/`Revenue` (this plan corrects their balances/amounts alongside everything else — if that plan hasn't shipped, skip the `stream`/`revenue` kinds per Task 2 Step 3's note and ship the rest). Generalizes `lib/txn-edit.mjs`'s pattern into `lib/corrections.mjs`: one `editAmountTx` function parameterized by `kind` (`"account"`, `"stream"`, `"request"`, `"projection"`, `"revenue"`) that either adjusts a balance directly (account/stream) or overwrites a plain field (request.amount, projection.amount, revenue.amount — these have no independent ledger, so "correcting" them is just a direct write, unlike a `Txn` whose amount change must ripple into its account's balance), plus `deleteTxnTx` (reverses the balance, deletes the row). A second pure function `applyStatusOverride` backs a `setRecordStatus` RPC action, gated by a new `Role.isMigrationOperator` flag (mirroring the source design's dedicated "Data Migration" account) rather than plain `admin`, so this bypass-the-workflow capability is opt-in per role instead of automatically available to every admin.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- This plan does not touch `lib/txn-edit.mjs` or the existing `editTransaction` RPC action from the Inline Transaction Edit plan — that plan's `editTxnTx`/`txnAmountDelta` remain the single source of truth for transaction-amount correction (including the stream-balance side effect, extended in Task 1 below). `lib/corrections.mjs` in this plan covers every *other* kind, plus adds `deleteTxnTx` for transactions specifically (deletion, not amount-editing, so it belongs in the new file rather than the old one).
- `Role.isMigrationOperator` is a narrow, separate flag from `admin` — an admin does NOT automatically get status-override power in this plan; only a role with this flag set does. This deliberately narrows the source design's single hardcoded "Data Migration" demo account into a real, assignable role capability. Every status-override RPC call must check this flag, never `admin` alone.
- Every correction (of any kind) requires a non-empty `reason` (minimum 3 characters, matching `editTransaction`'s existing validation) and is logged via `audit()`, exactly like the existing transaction-edit action.
- Same fake-Prisma testing convention as the rest of the codebase.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Extend `editTxnTx` to reverse a transaction's stream-balance side effect too

**Files:**
- Modify: `lib/txn-edit.mjs`
- Test: `tests/txn-edit.test.mjs`

**Interfaces:**
- Consumes: `Txn.streamId` from `docs/superpowers/plans/2026-08-01-revenue-purses.md`.
- Produces: extends `editTxnTx`'s existing signature with an optional `streamId` argument.

- [ ] **Step 1: Write the failing test**

Append to `tests/txn-edit.test.mjs`:

```js
test("editTxnTx also adjusts a purse balance when the transaction is tagged with a streamId", async () => {
  const state = { balance: 5000, streamBalance: 800, txnUpdates: [] };
  const prisma = {
    state,
    $transaction: async (fn) =>
      fn({
        txn: { update: async ({ data }) => { state.txnUpdates.push(data); } },
        account: { update: async ({ data }) => { state.balance += data.balance.increment; } },
        stream: { update: async ({ data }) => { state.streamBalance += data.balance.increment; } },
      }),
  };
  const result = await editTxnTx(prisma, { id: "t1", acctId: "project", streamId: "s_advance", type: "in", oldAmount: 300, newAmount: 500 });
  assert.equal(result.delta, 200);
  assert.equal(state.balance, 5200);
  assert.equal(state.streamBalance, 1000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/txn-edit.test.mjs` — expected FAIL, `editTxnTx` does not yet touch `tx.stream`.

- [ ] **Step 3: Update the implementation**

In `lib/txn-edit.mjs`, change `editTxnTx`'s signature and body from:

```js
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

to:

```js
export async function editTxnTx(prisma, { id, acctId, streamId, type, oldAmount, newAmount }) {
  const delta = txnAmountDelta({ type, oldAmount, newAmount });
  return prisma.$transaction(async (tx) => {
    await tx.txn.update({ where: { id }, data: { amount: newAmount } });
    if (delta !== 0) {
      await tx.account.update({ where: { id: acctId }, data: { balance: { increment: delta } } });
      if (streamId) {
        await tx.stream.update({ where: { id: streamId }, data: { balance: { increment: delta } } });
      }
    }
    return { delta };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/txn-edit.test.mjs` — expected PASS, all prior tests plus the new one green (the fake-Prisma objects in the earlier tests don't define `tx.stream` — confirm they still pass unchanged since `streamId` defaults to `undefined` and the `if (streamId)` branch is skipped).

- [ ] **Step 5: Update the `editTransaction` RPC call site**

In `app/api/rpc/route.js`, in `case "editTransaction": { ... }`, change the call to `editTxnTx` from:

```js
        const { delta } = await editTxnTx(prisma, {
          id: txn.id, acctId: txn.acctId, type: txn.type, oldAmount: txn.amount, newAmount,
        });
```

to:

```js
        const { delta } = await editTxnTx(prisma, {
          id: txn.id, acctId: txn.acctId, streamId: txn.streamId, type: txn.type, oldAmount: txn.amount, newAmount,
        });
```

- [ ] **Step 6: Commit**

```bash
git add lib/txn-edit.mjs tests/txn-edit.test.mjs app/api/rpc/route.js
git commit -m "feat: extend editTxnTx to reverse a transaction's purse balance too"
```

---

### Task 2: `lib/corrections.mjs` — generalized amount correction + transaction deletion

**Files:**
- Create: `lib/corrections.mjs`
- Test: `tests/corrections.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `editAmountTx(prisma, { kind, id, field, newValue }) => Promise<{ ok: true }>` and `deleteTxnTx(prisma, { id }) => Promise<{ ok: true }>` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tests/corrections.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { editAmountTx, deleteTxnTx } from "../lib/corrections.mjs";

function makeFakePrisma() {
  const state = { account: null, stream: null, request: null, projection: null, revenue: null, txns: [{ id: "t1", acctId: "project", type: "out", amount: 500 }], accountBalance: 1000 };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        account: {
          update: async ({ where, data }) => { state.account = { id: where.id, balance: data.balance }; state.accountBalance = data.balance; },
        },
        stream: {
          update: async ({ where, data }) => { state.stream = { id: where.id, balance: data.balance }; },
        },
        request: {
          update: async ({ where, data }) => { state.request = { id: where.id, ...data }; },
        },
        projection: {
          update: async ({ where, data }) => { state.projection = { id: where.id, ...data }; },
        },
        revenue: {
          update: async ({ where, data }) => { state.revenue = { id: where.id, ...data }; },
        },
        txn: {
          findUnique: async ({ where }) => state.txns.find((t) => t.id === where.id) || null,
          delete: async ({ where }) => { state.txns = state.txns.filter((t) => t.id !== where.id); },
        },
      }),
  };
}

test("editAmountTx directly sets an account's balance", async () => {
  const prisma = makeFakePrisma();
  await editAmountTx(prisma, { kind: "account", id: "faculty", field: "balance", newValue: 9000 });
  assert.deepEqual(prisma.state.account, { id: "faculty", balance: 9000 });
});

test("editAmountTx directly sets a purse's balance", async () => {
  const prisma = makeFakePrisma();
  await editAmountTx(prisma, { kind: "stream", id: "s_advance", field: "balance", newValue: 4000 });
  assert.deepEqual(prisma.state.stream, { id: "s_advance", balance: 4000 });
});

test("editAmountTx directly sets a request's amount field with no balance side effect", async () => {
  const prisma = makeFakePrisma();
  await editAmountTx(prisma, { kind: "request", id: "RB-1042", field: "amount", newValue: 18000 });
  assert.deepEqual(prisma.state.request, { id: "RB-1042", amount: 18000 });
  assert.equal(prisma.state.accountBalance, 1000, "correcting a request amount must not touch any account balance");
});

test("editAmountTx works for projection and revenue amounts the same way", async () => {
  const prisma = makeFakePrisma();
  await editAmountTx(prisma, { kind: "projection", id: "PJ-2000", field: "amount", newValue: 250 });
  assert.deepEqual(prisma.state.projection, { id: "PJ-2000", amount: 250 });
  await editAmountTx(prisma, { kind: "revenue", id: "RV-3000", field: "amount", newValue: 6000 });
  assert.deepEqual(prisma.state.revenue, { id: "RV-3000", amount: 6000 });
});

test("editAmountTx rejects an unknown kind rather than silently doing nothing", async () => {
  const prisma = makeFakePrisma();
  await assert.rejects(() => editAmountTx(prisma, { kind: "bogus", id: "x", field: "amount", newValue: 1 }));
});

test("deleteTxnTx reverses the balance and removes the row for an 'out' transaction", async () => {
  const prisma = makeFakePrisma();
  await deleteTxnTx(prisma, { id: "t1" });
  assert.equal(prisma.state.txns.length, 0);
  assert.equal(prisma.state.accountBalance, 1500, "deleting an 'out' txn of 500 must add 500 back to the account");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/corrections.test.mjs` — expected FAIL, `lib/corrections.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/corrections.mjs`:

```js
// Directly overwrites one numeric field on one of five kinds of record. Two shapes:
// - "account"/"stream": the field IS the running balance, so this is the balance itself
//   being corrected — no separate ledger entry to reconcile.
// - "request"/"projection"/"revenue": the field is a plain amount with no independent
//   ledger — correcting it has no knock-on balance effect, unlike a Txn (see
//   lib/txn-edit.mjs, which is deliberately kept separate because IT does have a
//   balance side effect).
// Note: if the Revenue & Purses plan (2026-08-01-revenue-purses.md) has not shipped,
// the "stream"/"revenue" kinds are unused dead branches — safe to leave in place, since
// nothing calls them until that plan's models exist.
export async function editAmountTx(prisma, { kind, id, field, newValue }) {
  return prisma.$transaction(async (tx) => {
    if (kind === "account") await tx.account.update({ where: { id }, data: { [field]: newValue } });
    else if (kind === "stream") await tx.stream.update({ where: { id }, data: { [field]: newValue } });
    else if (kind === "request") await tx.request.update({ where: { id }, data: { [field]: newValue } });
    else if (kind === "projection") await tx.projection.update({ where: { id }, data: { [field]: newValue } });
    else if (kind === "revenue") await tx.revenue.update({ where: { id }, data: { [field]: newValue } });
    else throw new Error("Unknown correction kind: " + kind);
    return { ok: true };
  });
}

// Deletes a transaction outright, reversing its effect on the account balance (and the
// purse balance, if it was tagged with one) before removing the row.
export async function deleteTxnTx(prisma, { id }) {
  return prisma.$transaction(async (tx) => {
    const txn = await tx.txn.findUnique({ where: { id } });
    if (!txn) return { ok: true };
    const sign = txn.type === "in" ? -1 : 1;
    await tx.account.update({ where: { id: txn.acctId }, data: { balance: { increment: sign * txn.amount } } });
    if (txn.streamId) {
      await tx.stream.update({ where: { id: txn.streamId }, data: { balance: { increment: sign * txn.amount } } });
    }
    await tx.txn.delete({ where: { id } });
    return { ok: true };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/corrections.test.mjs` — expected PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/corrections.mjs tests/corrections.test.mjs
git commit -m "feat: add editAmountTx and deleteTxnTx generalized corrections"
```

---

### Task 3: Pure status-override rule + RPC actions — `editRecordAmount`, `deleteTransaction`, `setRecordStatus`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `lib/status-override.mjs`
- Test: `tests/status-override.test.mjs`
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `editAmountTx`, `deleteTxnTx` from Task 2.
- Produces: `Role.isMigrationOperator Boolean @default(false)`; a request/projection/revenue field `migrated Boolean @default(false)`; `applyStatusOverride({ isMigrationOperator, chosenStatus }) => { error: string } | { ok: true }`; RPC actions `"editRecordAmount"`, `"deleteTransaction"`, `"setRecordStatus"`.

- [ ] **Step 1: Add the schema columns**

In `model Role { ... }`, add directly below `approverKey String?` (from the Payment Routing plan; if that plan hasn't shipped, add directly below `canSeeAdvances Boolean @default(false)` instead):

```prisma
  isMigrationOperator Boolean @default(false) // may force a record's status directly, bypassing the normal workflow — for importing historical data
```

In `model Request { ... }` and `model Projection { ... }`, add directly below each model's `status` field:

```prisma
  migrated Boolean @default(false)
```

(For `Revenue`, add the same line directly below its `status` field too.)

Run: `npx prisma generate && npx prisma db push` (or `npx prisma validate`).

Commit:

```bash
git add prisma/schema.prisma
git commit -m "feat: add Role.isMigrationOperator and migrated flags"
```

- [ ] **Step 2: Write the failing tests for `applyStatusOverride`**

Create `tests/status-override.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStatusOverride } from "../lib/status-override.mjs";

test("a migration operator can set any non-empty status", () => {
  assert.deepEqual(applyStatusOverride({ isMigrationOperator: true, chosenStatus: "closed" }), { ok: true });
});

test("a non-migration-operator is rejected regardless of the chosen status", () => {
  const result = applyStatusOverride({ isMigrationOperator: false, chosenStatus: "closed" });
  assert.equal(result.error, "Only a data-migration operator can set status directly.");
});

test("an empty chosen status is rejected even for a migration operator", () => {
  const result = applyStatusOverride({ isMigrationOperator: true, chosenStatus: "" });
  assert.equal(result.error, "Choose a status.");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/status-override.test.mjs` — expected FAIL, `lib/status-override.mjs` does not exist.

- [ ] **Step 4: Write the implementation**

Create `lib/status-override.mjs`:

```js
// Guards the "set status directly, bypassing the normal workflow" escape hatch used
// only when importing pre-existing historical data. Deliberately gated on a role flag
// narrower than admin — see this plan's Global Constraints.
export function applyStatusOverride({ isMigrationOperator, chosenStatus }) {
  if (!isMigrationOperator) return { error: "Only a data-migration operator can set status directly." };
  if (!chosenStatus) return { error: "Choose a status." };
  return { ok: true };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/status-override.test.mjs` — expected PASS, all 3 tests green.

- [ ] **Step 6: Add the three RPC actions**

Import, alongside the other `lib/*` imports in `app/api/rpc/route.js`:

```js
import { editAmountTx, deleteTxnTx } from "@/lib/corrections.mjs";
import { applyStatusOverride } from "@/lib/status-override.mjs";
```

Directly after the existing `case "editTransaction": { ... }` block, add:

```js
      case "editRecordAmount": {
        if (!admin) return err("Forbidden", 403);
        const { kind, id, field, reason } = body;
        const newValue = Number(body.newValue);
        if (!["account", "stream", "request", "projection", "revenue"].includes(kind)) return err("Unknown record kind.");
        if (!Number.isFinite(newValue) || newValue < 0) return err("Enter a valid amount (zero or more).");
        if ((reason || "").trim().length < 3) return err("A reason is required for every figure change.");
        const finders = { account: prisma.account, stream: prisma.stream, request: prisma.request, projection: prisma.projection, revenue: prisma.revenue };
        const record = await finders[kind].findUnique({ where: { id } });
        if (!record) return err("Not found", 404);
        const oldValue = record[field];
        if (newValue === oldValue) return err("The amount is unchanged.");
        await editAmountTx(prisma, { kind, id, field, newValue });
        await audit(me, "Correction — " + kind + " " + id + " " + field + " changed from " + fmt(oldValue) + " to " + fmt(newValue) + ". Reason: " + reason.trim());
        return NextResponse.json({ ok: true });
      }
      case "deleteTransaction": {
        if (!admin) return err("Forbidden", 403);
        const reason = (body.reason || "").trim();
        if (reason.length < 3) return err("A reason is required to delete a transaction.");
        const txn = await prisma.txn.findUnique({ where: { id: body.id } });
        if (!txn) return err("Not found", 404);
        await deleteTxnTx(prisma, { id: txn.id });
        await audit(me, 'Deleted transaction "' + txn.desc + '" (' + fmt(txn.amount) + "). Balance reversed. Reason: " + reason);
        return NextResponse.json({ ok: true });
      }
      case "setRecordStatus": {
        const check = applyStatusOverride({ isMigrationOperator: !!me.role.isMigrationOperator, chosenStatus: body.status });
        if (check.error) return err(check.error);
        const { kind, id } = body;
        const finders = { request: prisma.request, projection: prisma.projection, revenue: prisma.revenue };
        if (!finders[kind]) return err("Unknown record kind.");
        const record = await finders[kind].findUnique({ where: { id } });
        if (!record) return err("Not found", 404);
        const from = record.status;
        await finders[kind].update({ where: { id }, data: { status: body.status, migrated: true } });
        await audit(me, "Set status of " + kind + " " + id + ' from "' + from + '" to "' + body.status + '"');
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 7: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. As admin, correct an account balance, a request amount, and (if the Revenue & Purses plan has shipped) a purse balance and a revenue amount — confirm each updates only its own field with no unintended side effects, and each is audited. Delete a transaction — confirm the balance reverses correctly and the row disappears. Grant a role `isMigrationOperator: true` (directly via `npx prisma studio` or a follow-up admin UI), log in as it, and confirm `setRecordStatus` succeeds and stamps `migrated: true`; confirm a role without the flag (even an admin-perm role, if it lacks this specific flag) is rejected.

- [ ] **Step 8: Commit**

```bash
git add lib/status-override.mjs tests/status-override.test.mjs app/api/rpc/route.js
git commit -m "feat: add editRecordAmount, deleteTransaction, setRecordStatus RPC actions"
```

---

### Task 4: UI — pencil icons everywhere, delete-transaction control, migration status control

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `editRecordAmount`, `deleteTransaction`, `setRecordStatus` RPC actions (Task 3).
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Add a shared `EditNumberModal` body**

Add one modal type, `editNumber`, parameterized by `modal.kind`/`modal.id`/`modal.field`/`modal.label`/`modal.orig` (set when opening it from each entry point below), reusing the same input+reason shape already established by the `editTxn` modal from the Inline Transaction Edit plan:

```jsx
{modal.type === "editNumber" && (<>
  <div className="field"><label className="label">{modal.label}</label><div className="muted" style={{ fontSize: 14 }}>Current: {fmt(modal.orig)}</div></div>
  <div className="field"><label className="label">Corrected amount</label><input className="input mono" type="number" value={form.newValue ?? ""} onChange={set("newValue")} /></div>
  <div className="field"><label className="label">Reason for the change</label><textarea className="input" style={{ minHeight: 70, resize: "vertical" }} value={form.reason || ""} onChange={set("reason")} /></div>
</>)}
```

In `submit()`, add:

```js
    else if (modal.type === "editNumber") ok = await rpc("editRecordAmount", { kind: modal.kind, id: modal.id, field: modal.field, newValue: form.newValue, reason: form.reason }, "Correction saved.");
```

- [ ] **Step 2: Add pencil icons to account balances and purse chips**

On the `Accounts` page, add a `<i className="ph ph-pencil-simple numedit">` next to each account's balance (admin-only) opening `editNumber` with `{ kind: "account", id: a.id, field: "balance", label: "Balance — " + a.name, orig: a.balance }`, and next to each purse chip (from the Revenue & Purses plan's Task 4) with `{ kind: "stream", id: s.id, field: "balance", label: "Purse — " + s.name, orig: s.balance }`.

- [ ] **Step 3: Add a delete icon to transaction rows**

On `TxnRow` (used by both `Dashboard` and `Accounts`), add an optional `onDelete` prop rendering a small trash icon (admin-only, passed from `Accounts` the same way `onEdit` already is) that opens a small confirmation modal (`deleteTxn` type: description + reason textarea) calling `deleteTransaction` with `{ id: t.id, reason }`.

- [ ] **Step 4: Add amount-correction pencils to request/projection/revenue amounts**

On `Detail`, next to the displayed request amount (admin-only), add the same pencil pattern opening `editNumber` with `{ kind: "request", id: r.id, field: "amount", label: "Amount — " + r.id, orig: r.amount }`. Do the same on the `Projections` page's amount column (`kind: "projection"`) and, if the Revenue & Purses plan has shipped, the `Revenue` page's amount column (`kind: "revenue"`).

- [ ] **Step 5: Add a migration-status control**

On `Detail` (and the `Projections`/`Revenue` pages), when `me.role.isMigrationOperator` is true, add a small "Data-migration override" `select` (statuses from `ORDER`, plus a distinct label for revenues' `projected`/`received`) that calls `setRecordStatus` with `{ kind, id, status }` on change, styled distinctly (e.g. a purple-tinted banner) to make clear this bypasses the normal workflow.

- [ ] **Step 6: Manual verification in the browser**

Run: `npm run dev`. As admin, correct an account balance and a request amount via their pencil icons, confirm both persist correctly with no cross-contamination. Delete a transaction and confirm the balance reverses in the UI immediately. As a migration-operator role, set a request's status directly and confirm the "migrated" flag is reflected somewhere visible (e.g. a small tag, reusing the existing "Migrated" badge pattern already noted elsewhere in this codebase's conventions).

- [ ] **Step 7: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add universal correction and migration-status UI"
```

---

## Self-Review Notes

- **Spec coverage:** transaction-stream side effect (Task 1), generalized amount correction across account/stream/request/projection/revenue (Task 2/3/4), transaction deletion with balance reversal (Task 2/3/4), migration-operator status override narrower than plain admin (Task 3/4) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Type/name consistency:** `editAmountTx`'s `{ kind, id, field, newValue }` is used identically across its Task 2 test, Task 3 RPC call site, and Task 4 UI dispatch.
- **Deliberate scope narrowing vs. the source design:** the source mockup ties this power to a single hardcoded demo account; this plan instead makes it an assignable `Role.isMigrationOperator` flag, explicitly called out in the Architecture section and Global Constraints as a safety improvement, not a faithfulness gap.
- **Dependencies called out explicitly:** Task 1 and parts of Task 2/3/4 assume `docs/superpowers/plans/2026-08-01-revenue-purses.md` has shipped for the `stream`/`revenue` kinds — each such step notes the fallback (skip those kinds) if it hasn't.
