# Revenue & Purses (Projected Revenue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Project Finance track incoming money the same way outgoing money is tracked — project a revenue item (sponsor payment, registration fee, etc.), mark it received once the money actually lands, and route it into a named "purse" (a labelled sub-total inside the `project` account) so the Accounts page can show a breakdown like "Advance", "Registration fees", "Sponsorship" instead of one opaque balance.

**Architecture:** Two new Prisma models: `Stream` (a purse — always scoped to the `project` account in this plan, mirrors `Account`'s shape but nested one level deeper) and `Revenue` (mirrors `Projection`'s shape/status-machine: `projected` → `received`, own id sequence `RV-3000+`). `Txn` gains an optional `streamId` so every purse's balance is derivable from its txns, but — matching the existing `Account.balance` pattern already used everywhere in this codebase — `Stream.balance` is a denormalized column updated atomically alongside the txn write, not computed on read. `lib/revenue.mjs` holds `receiveRevenueTx`, tested against the same fake-Prisma convention as `lib/projections.mjs`. Two RPC actions (`createRevenue`, `receiveRevenue`) plus an admin-only `createStream`. A "Projected Revenue" nav page plus a purse breakdown on the existing Accounts page.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- Every DB-touching business rule must go through a pure function testable with a fake Prisma object (see `tests/projections.test.mjs` for the exact fake-prisma shape to reuse) — no test may require a real Postgres connection.
- Money fields are `Float`, formatted with the existing `fmt()` helper — do not introduce a second currency formatter.
- IDs follow the existing human-readable sequence convention: revenues use `RV-3000`, `RV-3001`, ... via a dedicated `Counter` row (`prisma.counter.update({ where: { id: "revenue" }, ... })`), exactly like `projection`/`request`.
- All RPC actions require `getSessionUser()` to succeed (401 otherwise) and check `can(me, <permKey>)` or `admin` before doing anything.
- Every state-changing RPC action calls `audit(me, "...")` exactly once on success.
- This plan scopes purses to the `project` account only (matching the WC Finance mockup this was extracted from) — a purse belonging to `faculty` is out of scope; do not generalize beyond what's specified.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — `Stream`, `Revenue`, `Txn.streamId`, counter seed

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/seed-data.mjs`

**Interfaces:**
- Produces: `Stream { id, acctId, name, nameTh, color, balance }`, `Revenue { id, title, source, acctId, streamId, amount, expectedDate, status, receivedAt, createdAt }`, `Txn.streamId String?` — consumed by Task 2 and Task 3.

- [ ] **Step 1: Add the `Stream` and `Revenue` models to `prisma/schema.prisma`**

Add after the existing `model Account { ... }` block:

```prisma
model Stream {
  id      String  @id @default(cuid()) // a "purse" — a named sub-total inside an Account
  acctId  String
  name    String
  nameTh  String  @default("")
  color   String  @default("#f0378a")
  balance Float   @default(0)
  active  Boolean @default(true)
}
```

Add after the existing `model Projection { ... }` block:

```prisma
model Revenue {
  id         String    @id // e.g. RV-3000
  title      String
  source     String    @default("")
  acctId     String    @default("project")
  streamId   String?
  amount     Float
  expectedDate DateTime @default(now())
  status     String    @default("projected") // projected | received
  receivedAt DateTime?
  createdAt  DateTime  @default(now())
}
```

- [ ] **Step 2: Add `streamId` to `Txn`**

In `model Txn { ... }`, add directly below `acctId String`:

```prisma
  streamId String?
```

- [ ] **Step 3: Seed the `revenue` counter and a default "General" stream**

In `lib/seed-data.mjs`, directly below the existing `await prisma.counter.create({ data: { id: "projection", value: 2000 } });` line, add:

```js
  await prisma.counter.create({ data: { id: "revenue", value: 3000 } });
```

Directly below wherever `faculty`/`project` accounts are created in the same file, add:

```js
  await prisma.stream.create({ data: { id: "s_advance", acctId: "project", name: "Advance", nameTh: "เงินยืมทดรอง", color: "#f0378a" } });
  await prisma.stream.create({ data: { id: "s_general", acctId: "project", name: "General", nameTh: "ทั่วไป", color: "#0e7490" } });
```

- [ ] **Step 4: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push` (or `npx prisma validate` if no DB is reachable).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma lib/seed-data.mjs
git commit -m "feat: add Stream and Revenue models, Txn.streamId"
```

---

### Task 2: `lib/revenue.mjs` — receive a projected revenue

**Files:**
- Create: `lib/revenue.mjs`
- Test: `tests/revenue.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `receiveRevenueTx(prisma, { id, currentStatus, amount, acctId, streamId, title }) => Promise<{ conflict: boolean }>` — consumed by Task 3's `receiveRevenue` RPC action.

- [ ] **Step 1: Write the failing tests**

Create `tests/revenue.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { receiveRevenueTx } from "../lib/revenue.mjs";

function makeFakePrisma({ status, balances, streamBalances }) {
  const state = { status, balances: { ...balances }, streamBalances: { ...(streamBalances || {}) }, txns: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        revenue: {
          updateMany: async ({ where, data }) => {
            if (where.status !== state.status) return { count: 0 };
            state.status = data.status;
            return { count: 1 };
          },
        },
        account: {
          update: async ({ where, data }) => {
            if (data.balance?.increment != null) state.balances[where.id] = (state.balances[where.id] || 0) + data.balance.increment;
          },
        },
        stream: {
          update: async ({ where, data }) => {
            if (data.balance?.increment != null) state.streamBalances[where.id] = (state.streamBalances[where.id] || 0) + data.balance.increment;
          },
        },
        txn: {
          create: async ({ data }) => {
            state.txns.push(data);
          },
        },
      }),
  };
}

test("receiving a projected revenue with a stream credits both the account and the purse", async () => {
  const prisma = makeFakePrisma({ status: "projected", balances: { project: 1000 }, streamBalances: { s_general: 200 } });
  const result = await receiveRevenueTx(prisma, {
    id: "RV-3000", currentStatus: "projected", amount: 500,
    acctId: "project", streamId: "s_general", title: "Sponsorship — Acme Co.",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.status, "received");
  assert.equal(prisma.state.balances.project, 1500);
  assert.equal(prisma.state.streamBalances.s_general, 700);
  assert.equal(prisma.state.txns.length, 1);
  assert.equal(prisma.state.txns[0].acctId, "project");
  assert.equal(prisma.state.txns[0].streamId, "s_general");
  assert.equal(prisma.state.txns[0].type, "in");
});

test("receiving a revenue with no stream only credits the account", async () => {
  const prisma = makeFakePrisma({ status: "projected", balances: { project: 1000 } });
  const result = await receiveRevenueTx(prisma, {
    id: "RV-3000", currentStatus: "projected", amount: 500,
    acctId: "project", streamId: null, title: "Registration fees",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.balances.project, 1500);
  assert.deepEqual(prisma.state.streamBalances, {});
  assert.equal(prisma.state.txns[0].streamId, null);
});

test("a stale receive (already received) is rejected as a conflict, not double-applied", async () => {
  const prisma = makeFakePrisma({ status: "received", balances: { project: 1500 } });
  const result = await receiveRevenueTx(prisma, {
    id: "RV-3000", currentStatus: "projected", amount: 500,
    acctId: "project", streamId: null, title: "Registration fees",
  });
  assert.equal(result.conflict, true);
  assert.equal(prisma.state.balances.project, 1500, "balance must not move on a rejected conflict");
  assert.equal(prisma.state.txns.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/revenue.test.mjs` — expected FAIL, `lib/revenue.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/revenue.mjs`:

```js
// Marks a projected revenue as received, guarded against a concurrent receive of the
// same revenue (compare-and-swap on status), and atomically credits the target account
// — and, if the revenue is assigned to a purse, that purse's running balance too.
export async function receiveRevenueTx(prisma, { id, currentStatus, amount, acctId, streamId, title }) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.revenue.updateMany({
      where: { id, status: currentStatus },
      data: { status: "received", receivedAt: new Date() },
    });
    if (result.count === 0) return { conflict: true };
    await tx.account.update({ where: { id: acctId }, data: { balance: { increment: amount } } });
    if (streamId) {
      await tx.stream.update({ where: { id: streamId }, data: { balance: { increment: amount } } });
    }
    await tx.txn.create({ data: { acctId, streamId: streamId || null, type: "in", amount, desc: "Revenue — " + title } });
    return { conflict: false };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/revenue.test.mjs` — expected PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/revenue.mjs tests/revenue.test.mjs
git commit -m "feat: add receiveRevenueTx"
```

---

### Task 3: RPC actions — `createStream`, `createRevenue`, `receiveRevenue`

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `receiveRevenueTx` from Task 2; `Stream`/`Revenue`/`Txn.streamId` from Task 1.
- Produces: RPC actions `"createStream"`, `"createRevenue"`, `"receiveRevenue"`.

- [ ] **Step 1: Import the new function**

Add, alongside the other `lib/*` imports:

```js
import { receiveRevenueTx } from "@/lib/revenue.mjs";
```

- [ ] **Step 2: Add the three actions**

Directly after the existing `case "createAccount": { ... }` block, add:

```js
      case "createStream": {
        if (!admin) return err("Forbidden", 403);
        if (!body.name) return err("Enter a purse name.");
        const s = await prisma.stream.create({
          data: { acctId: body.acctId || "project", name: body.name, nameTh: body.nameTh || body.name, color: body.color || "#f0378a" },
        });
        await audit(me, "Created purse " + s.name);
        return NextResponse.json({ ok: true, id: s.id });
      }
      case "createRevenue": {
        if (!admin && !can(me, "accounts")) return err("Forbidden", 403);
        const { title, source, amount, expectedDate, streamId } = body;
        const parsedAmount = Number(amount);
        if (!title) return err("Enter a title.");
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return err("Enter a positive amount.");
        const counter = await prisma.counter.update({ where: { id: "revenue" }, data: { value: { increment: 1 } } });
        const id = "RV-" + counter.value;
        await prisma.revenue.create({
          data: {
            id, title, source: source || "", amount: parsedAmount, streamId: streamId || null,
            expectedDate: expectedDate ? new Date(expectedDate) : new Date(),
          },
        });
        await audit(me, "Projected revenue " + id + " — " + title + " (" + fmt(parsedAmount) + ")");
        return NextResponse.json({ ok: true, id });
      }
      case "receiveRevenue": {
        if (!admin && !can(me, "accounts")) return err("Forbidden", 403);
        const rv = await prisma.revenue.findUnique({ where: { id: body.id } });
        if (!rv) return err("Not found", 404);
        if (rv.status !== "projected") return err("This revenue is already recorded.");
        const acct = await prisma.account.findUnique({ where: { id: rv.acctId } });
        if (!acct || !acct.active) return err("Target account is unavailable.");
        const result = await receiveRevenueTx(prisma, {
          id: rv.id, currentStatus: "projected", amount: rv.amount,
          acctId: rv.acctId, streamId: rv.streamId, title: rv.title,
        });
        if (result.conflict) return err("This revenue was already recorded.");
        await audit(me, "Received revenue " + rv.id + " (" + fmt(rv.amount) + ")");
        await notifyPerm("accounts", rv.id + " — revenue received: " + fmt(rv.amount) + ".", "disbursed", me.id);
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 3: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. As admin, create a stream, project a revenue against it, receive it, and confirm both `Account.balance` and `Stream.balance` increase by the same amount, with one new `Txn` row tagged with that `streamId`.

- [ ] **Step 4: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: add revenue and purse RPC actions"
```

---

### Task 4: Snapshot + UI — Projected Revenue page and purse breakdown

**Files:**
- Modify: `lib/snapshot.mjs`
- Modify: `app/api/data/route.js`
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `createRevenue`, `receiveRevenue`, `createStream` RPC actions (Task 3).
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Expose `streams` and `revenues` in the data snapshot**

In `lib/snapshot.mjs`, add `streams` and `revenues` to the destructured `raw` and the returned object, gated the same way as `accounts` (`admin || canAccounts || canDisburse`):

```js
    streams: admin || canAccounts || canDisburse ? (streams || []) : [],
    revenues: admin || canAccounts || canDisburse ? (revenues || []) : [],
```

In `app/api/data/route.js`, add `prisma.stream.findMany()` and `prisma.revenue.findMany({ orderBy: { createdAt: "desc" } })` to the `Promise.all` array and pass `streams`, `revenues` through to `shapeSnapshot`'s raw object.

- [ ] **Step 2: Add "Revenue" to the `NAV` array**

In `components/App.jsx`'s `NAV` array, add:

```js
{ key: "revenue", label: "Revenue", icon: "ph-trend-up", perm: "accounts" },
```

- [ ] **Step 3: Add a `Revenue` page component**

Add a new function component (near `Accounts`) that:
- Fetches `data.revenues` and `data.streams` (already in the snapshot from Step 1).
- Renders a table: Title, Source, Amount, Expected date, Status.
- Shows a "Projected revenue" button (visible when `can("accounts")` or admin) opening a form with fields: title, source, amount, expected date, purse (`select` from `data.streams`). On submit, calls `createRevenue`.
- Shows a "Mark received" button per row when `status === "projected"`, calling `receiveRevenue` with the row's `id`.

Wire the `"revenue"` case into the same screen-switch mechanism as the other pages (`{screen === "revenue" && <Revenue {...ctx} />}`) and into `titleMap`.

- [ ] **Step 4: Add a purse breakdown to the Accounts page**

On the existing `Accounts` component, for the `project` account row only, render `data.streams.filter(s => s.acctId === 'project')` as small `.purse` chips (name + balance), matching the `.purse`/`.purse-dot` CSS classes already defined in the stylesheet.

- [ ] **Step 5: Manual verification in the browser**

Run: `npm run dev`. Confirm the Revenue page lists projected revenue, marking one received updates both the account balance and its purse chip on the Accounts page without a full reload.

- [ ] **Step 6: Commit**

```bash
git add lib/snapshot.mjs app/api/data/route.js components/App.jsx
git commit -m "feat: add Projected Revenue page and purse breakdown"
```

---

## Self-Review Notes

- **Spec coverage:** purse model scoped to `project` account (Task 1), revenue projected→received status machine with atomic account+purse crediting (Task 2/3), UI for both the revenue list and the purse breakdown (Task 4) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Type/name consistency:** `receiveRevenueTx`'s `{ id, currentStatus, amount, acctId, streamId, title }` shape matches its Task 2 test and Task 3 RPC call site exactly.
- **Explicit non-goal:** purses on the `faculty` account, and a general N-account purse system, are out of scope — this plan only wires the `project` account's purses, matching the source mockup.
- **Depended on by:** the Deposit Payments plan (`2026-08-01-deposit-payments.md`) and the Universal Correction plan (`2026-08-01-universal-correction.md`) both reference `Stream`/`Revenue` added here — apply this plan first if implementing those.
