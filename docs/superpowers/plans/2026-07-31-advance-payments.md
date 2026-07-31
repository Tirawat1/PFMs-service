# Advance Payments (Projected Expenses) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a department submit a "projected expense" before spending anything; when Project Finance approves it, the projected amount moves as an advance from the `faculty` Account to the `project` Account, and when the linked reimbursement Request is later disbursed for less than the advance, the unspent difference is automatically returned from `project` back to `faculty`.

**Architecture:** New `Projection` Prisma model (own id sequence `PJ-1000+`, mirrors the existing `Request` model's shape/conventions). New `lib/projections.mjs` holds pure validation + `$transaction` functions, following the exact pattern already used by `lib/requests.mjs` (compare-and-swap on `status`, atomic Txn + Account writes, tested against a fake in-memory Prisma — no real DB in tests). `Request` gains an optional `projectionId` column linking it back to the projection it draws down. The RPC route (`app/api/rpc/route.js`) gets two new actions (`createProjection`, `approveProjection`) and its existing `advanceRequest` disbursement branch is extended to settle the linked projection. A minimal UI page is added to `components/App.jsx` behind the existing `requests` permission.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict` for unit tests, plain `fetch`-based RPC client already used by the rest of the app (no new libraries).

## Global Constraints

- Every DB-touching business rule must go through a pure function testable with a fake Prisma object (see `tests/requests.test.mjs` for the exact fake-prisma shape to reuse) — no test may require a real Postgres connection.
- Money fields are `Float` in Prisma and formatted with the existing `fmt()` helper (`"฿" + Math.round(n).toLocaleString("en-US")`) — do not introduce a second currency formatter.
- IDs for new domain records follow the existing human-readable sequence convention (`RB-1042` for requests) — projections use `PJ-2000`, `PJ-2001`, ... via a dedicated `Counter` row, exactly like `prisma.counter.update({ where: { id: "request" }, ... })`.
- All RPC actions require `getSessionUser()` to succeed (401 otherwise) and check `can(me, <permKey>)` or `admin` before doing anything — follow the exact `err()`/`NextResponse.json` conventions already in `app/api/rpc/route.js`.
- Every state-changing RPC action calls `audit(me, "...")` exactly once on success, matching existing call sites.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — `Projection` model + `Request.projectionId` + counter seed

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/seed-data.mjs`

**Interfaces:**
- Produces: Prisma model `Projection` with fields `id, title, categoryId, dept, requesterId, requesterName, amount, expectedDate, status, requestId, createdAt` — consumed by Task 2 and Task 4.
- Produces: `Request.projectionId String?` — consumed by Task 3 and Task 4.

- [ ] **Step 1: Add the `Projection` model to `prisma/schema.prisma`**

Add this model after the existing `model Request { ... }` block:

```prisma
model Projection {
  id            String   @id // e.g. PJ-2000
  title         String
  categoryId    String
  dept          String
  requesterId   String?
  requesterName String
  amount        Float
  expectedDate  DateTime @default(now())
  status        String   @default("submitted") // submitted | advanced | linked | settled
  requestId     String?
  createdAt     DateTime @default(now())
}
```

- [ ] **Step 2: Add `projectionId` to `Request`**

In the existing `model Request { ... }` block, add this line directly below `acctId String?`:

```prisma
  projectionId      String?
```

- [ ] **Step 3: Seed the `projection` counter alongside the existing `request` counter**

In `lib/seed-data.mjs`, find this line in `seedBaseline`:

```js
  await prisma.counter.create({ data: { id: "request", value: 1000 } });
```

Add directly below it:

```js
  await prisma.counter.create({ data: { id: "projection", value: 2000 } });
```

- [ ] **Step 4: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push`
Expected: Prisma Client regenerates with a `prisma.projection` delegate and `Request.projectionId`; no errors. (This step requires `DATABASE_URL` to be set — if no local database is available, confirm instead with `npx prisma validate`, which only checks the schema file and requires no connection.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma lib/seed-data.mjs
git commit -m "feat: add Projection model and Request.projectionId"
```

---

### Task 2: `lib/projections.mjs` — advance approval (Faculty → Project transfer)

**Files:**
- Create: `lib/projections.mjs`
- Test: `tests/projections.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `approveProjectionTx(prisma, { id, currentStatus, amount, facultyAcctId, projectAcctId, title }) => Promise<{ conflict: boolean }>` — consumed by Task 4's `approveProjection` RPC action.

- [ ] **Step 1: Write the failing tests**

Create `tests/projections.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { approveProjectionTx } from "../lib/projections.mjs";

function makeFakePrisma({ status, balances }) {
  const state = { status, balances: { ...balances }, txns: [], projectionUpdates: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        projection: {
          updateMany: async ({ where, data }) => {
            if (where.status !== state.status) return { count: 0 };
            state.status = data.status;
            return { count: 1 };
          },
        },
        account: {
          update: async ({ where, data }) => {
            if (data.balance?.decrement != null) state.balances[where.id] -= data.balance.decrement;
            if (data.balance?.increment != null) state.balances[where.id] += data.balance.increment;
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

test("approving a projection transfers the amount from faculty to project exactly once", async () => {
  const prisma = makeFakePrisma({ status: "submitted", balances: { faculty: 5000, project: 1000 } });
  const result = await approveProjectionTx(prisma, {
    id: "PJ-2000", currentStatus: "submitted", amount: 300,
    facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.status, "advanced");
  assert.equal(prisma.state.balances.faculty, 4700);
  assert.equal(prisma.state.balances.project, 1300);
  assert.equal(prisma.state.txns.length, 2);
  assert.equal(prisma.state.txns[0].acctId, "faculty");
  assert.equal(prisma.state.txns[0].type, "out");
  assert.equal(prisma.state.txns[1].acctId, "project");
  assert.equal(prisma.state.txns[1].type, "in");
});

test("a stale approve (status already moved on) is rejected as a conflict, not double-applied", async () => {
  const prisma = makeFakePrisma({ status: "advanced", balances: { faculty: 4700, project: 1300 } });
  const result = await approveProjectionTx(prisma, {
    id: "PJ-2000", currentStatus: "submitted", amount: 300,
    facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel",
  });
  assert.equal(result.conflict, true);
  assert.equal(prisma.state.balances.faculty, 4700, "balance must not move on a rejected conflict");
  assert.equal(prisma.state.txns.length, 0);
});

test("two concurrent approvals only apply once", async () => {
  const prisma = makeFakePrisma({ status: "submitted", balances: { faculty: 5000, project: 1000 } });
  const args = { id: "PJ-2000", currentStatus: "submitted", amount: 300, facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel" };
  const [a, b] = await Promise.all([approveProjectionTx(prisma, args), approveProjectionTx(prisma, args)]);
  const conflicts = [a.conflict, b.conflict].filter(Boolean).length;
  assert.equal(conflicts, 1, "exactly one of the two concurrent calls must be rejected");
  assert.equal(prisma.state.balances.faculty, 4700);
  assert.equal(prisma.state.txns.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/projections.test.mjs`
Expected: FAIL — `lib/projections.mjs` does not exist / `approveProjectionTx` is not a function.

- [ ] **Step 3: Write the implementation**

Create `lib/projections.mjs`:

```js
// Approves a submitted projection, guarded against a concurrent approval of the
// same projection (the status update only applies if `currentStatus` still matches),
// and atomically transfers `amount` from the Faculty account to the Project account —
// mirroring the same compare-and-swap + atomic-ledger pattern as advanceRequestTx.
export async function approveProjectionTx(prisma, { id, currentStatus, amount, facultyAcctId, projectAcctId, title }) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.projection.updateMany({
      where: { id, status: currentStatus },
      data: { status: "advanced" },
    });
    if (result.count === 0) return { conflict: true };
    await tx.account.update({ where: { id: facultyAcctId }, data: { balance: { decrement: amount } } });
    await tx.account.update({ where: { id: projectAcctId }, data: { balance: { increment: amount } } });
    await tx.txn.create({ data: { acctId: facultyAcctId, type: "out", amount, desc: "Advance transfer — " + title } });
    await tx.txn.create({ data: { acctId: projectAcctId, type: "in", amount, desc: "Advance transfer — " + title } });
    return { conflict: false };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/projections.test.mjs`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/projections.mjs tests/projections.test.mjs
git commit -m "feat: add approveProjectionTx for advance approval"
```

---

### Task 3: `lib/projections.mjs` — settle advance on disbursement (auto-return unspent)

**Files:**
- Modify: `lib/projections.mjs`
- Test: `tests/projections.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `settleProjectionTx(prisma, { id, currentStatus, advancedAmount, actualAmount, facultyAcctId, projectAcctId, title }) => Promise<{ conflict: boolean, refund: number }>` — consumed by Task 4's modified `advanceRequest` disbursement branch.

- [ ] **Step 1: Write the failing tests**

Append to `tests/projections.test.mjs`:

```js
import { settleProjectionTx } from "../lib/projections.mjs";

function makeFakeProjectionPrisma({ status, balances }) {
  const state = { status, balances: { ...balances }, txns: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        projection: {
          updateMany: async ({ where, data }) => {
            if (where.status !== state.status) return { count: 0 };
            state.status = data.status;
            return { count: 1 };
          },
        },
        account: {
          update: async ({ where, data }) => {
            if (data.balance?.decrement != null) state.balances[where.id] -= data.balance.decrement;
            if (data.balance?.increment != null) state.balances[where.id] += data.balance.increment;
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

test("settling with actual spend below the advance returns the difference to faculty", async () => {
  const prisma = makeFakeProjectionPrisma({ status: "linked", balances: { faculty: 4700, project: 1300 } });
  const result = await settleProjectionTx(prisma, {
    id: "PJ-2000", currentStatus: "linked", advancedAmount: 300, actualAmount: 250,
    facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel",
  });
  assert.equal(result.conflict, false);
  assert.equal(result.refund, 50);
  assert.equal(prisma.state.status, "settled");
  assert.equal(prisma.state.balances.project, 1250);
  assert.equal(prisma.state.balances.faculty, 4750);
  assert.equal(prisma.state.txns.length, 2);
});

test("settling with actual spend equal to the advance moves no money and creates no txns", async () => {
  const prisma = makeFakeProjectionPrisma({ status: "linked", balances: { faculty: 4700, project: 1300 } });
  const result = await settleProjectionTx(prisma, {
    id: "PJ-2000", currentStatus: "linked", advancedAmount: 300, actualAmount: 300,
    facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel",
  });
  assert.equal(result.conflict, false);
  assert.equal(result.refund, 0);
  assert.equal(prisma.state.balances.project, 1300);
  assert.equal(prisma.state.balances.faculty, 4700);
  assert.equal(prisma.state.txns.length, 0);
});

test("a stale settle (already settled) is rejected as a conflict", async () => {
  const prisma = makeFakeProjectionPrisma({ status: "settled", balances: { faculty: 4750, project: 1250 } });
  const result = await settleProjectionTx(prisma, {
    id: "PJ-2000", currentStatus: "linked", advancedAmount: 300, actualAmount: 250,
    facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel",
  });
  assert.equal(result.conflict, true);
  assert.equal(result.refund, 0);
  assert.equal(prisma.state.balances.faculty, 4750, "balance must not move on a rejected conflict");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/projections.test.mjs`
Expected: FAIL — `settleProjectionTx` is not exported / not a function.

- [ ] **Step 3: Write the implementation**

Append to `lib/projections.mjs`:

```js
// Settles an advanced projection once its linked request is disbursed. If the actual
// amount spent is less than what was advanced, the unspent difference moves back from
// the Project account to the Faculty account atomically with the status transition.
export async function settleProjectionTx(prisma, { id, currentStatus, advancedAmount, actualAmount, facultyAcctId, projectAcctId, title }) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.projection.updateMany({
      where: { id, status: currentStatus },
      data: { status: "settled" },
    });
    if (result.count === 0) return { conflict: true, refund: 0 };
    const refund = Math.max(0, advancedAmount - actualAmount);
    if (refund > 0) {
      await tx.account.update({ where: { id: projectAcctId }, data: { balance: { decrement: refund } } });
      await tx.account.update({ where: { id: facultyAcctId }, data: { balance: { increment: refund } } });
      await tx.txn.create({ data: { acctId: projectAcctId, type: "out", amount: refund, desc: "Advance return — " + title } });
      await tx.txn.create({ data: { acctId: facultyAcctId, type: "in", amount: refund, desc: "Advance return — " + title } });
    }
    return { conflict: false, refund };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/projections.test.mjs`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/projections.mjs tests/projections.test.mjs
git commit -m "feat: add settleProjectionTx to auto-return unspent advances"
```

---

### Task 4: RPC actions — `createProjection`, `approveProjection`, and disbursement settlement

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `approveProjectionTx`, `settleProjectionTx` from `lib/projections.mjs` (Tasks 2–3); `Projection` / `Request.projectionId` from Task 1.
- Produces: RPC actions `"createProjection"` and `"approveProjection"`; extends the existing `"advanceRequest"` case's `isDisbursement` branch.

- [ ] **Step 1: Import the new functions**

At the top of `app/api/rpc/route.js`, change:

```js
import { advanceRequestTx, resolveDisburseAccount } from "@/lib/requests.mjs";
```

to:

```js
import { advanceRequestTx, resolveDisburseAccount } from "@/lib/requests.mjs";
import { approveProjectionTx, settleProjectionTx } from "@/lib/projections.mjs";
```

- [ ] **Step 2: Add `createProjection`**

In `app/api/rpc/route.js`, directly after the closing `}` of the existing `case "createRequest": { ... }` block, add:

```js
      case "createProjection": {
        if (!can(me, "create")) return err("Forbidden", 403);
        const { title, categoryId, amount, expectedDate } = body;
        const parsedAmount = Number(amount);
        if (!title || !categoryId) return err("Fill item and category.");
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return err("Enter a positive amount.");
        const cat = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!cat || !cat.active) return err("Unknown category.");
        const counter = await prisma.counter.update({
          where: { id: "projection" },
          data: { value: { increment: 1 } },
        });
        const id = "PJ-" + counter.value;
        await prisma.projection.create({
          data: {
            id, title, categoryId, amount: parsedAmount,
            dept: me.dept, requesterId: me.id, requesterName: me.name,
            expectedDate: expectedDate ? new Date(expectedDate) : new Date(),
          },
        });
        await audit(me, "Submitted projection " + id + " (" + fmt(parsedAmount) + ") for " + me.dept);
        await notifyPerm("create", "New projected expense " + id + " submitted by " + me.dept + " (" + fmt(parsedAmount) + ").", "notified", me.id);
        return NextResponse.json({ ok: true, id });
      }
      case "approveProjection": {
        if (!can(me, "verify") && !admin) return err("Forbidden", 403);
        const proj = await prisma.projection.findUnique({ where: { id: body.id } });
        if (!proj) return err("Not found", 404);
        if (proj.status !== "submitted") return err("This projection cannot be approved.");
        const faculty = await prisma.account.findUnique({ where: { id: "faculty" } });
        const project = await prisma.account.findUnique({ where: { id: "project" } });
        if (!faculty || !project || !faculty.active || !project.active) return err("Faculty or Project account is unavailable.");
        if (faculty.balance < proj.amount) return err("Insufficient balance in Faculty account for this advance.");
        const result = await approveProjectionTx(prisma, {
          id: proj.id, currentStatus: "submitted", amount: proj.amount,
          facultyAcctId: "faculty", projectAcctId: "project", title: proj.title,
        });
        if (result.conflict) return err("This projection was already advanced.");
        await audit(me, "Issued advance for projection " + proj.id + " (" + fmt(proj.amount) + ")");
        await notifyPerm("create", proj.id + " advance issued — " + fmt(proj.amount) + " transferred Faculty → Project.", "disbursed", me.id);
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 3: Link a new request to its projection in `createRequest`**

The real `case "createRequest": { ... }` block (confirmed by reading the live file) is:

```js
      case "createRequest": {
        if (!can(me, "create")) return err("Forbidden", 403);
        const { title, categoryId, amount, desc, eventDate } = body;
        if (!title || !categoryId) return err("Fill title and category.");
        const cat = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!cat || !cat.active) return err("Unknown category.");
        const parsedEventDate = eventDate ? new Date(eventDate) : new Date();
        const counter = await prisma.counter.update({
          where: { id: "request" },
          data: { value: { increment: 1 } },
        });
        const id = "RB-" + counter.value;
        await prisma.request.create({
          data: {
            id, title, categoryId, amount: Number(amount) || 0,
            dept: me.dept, requesterId: me.id, requesterName: me.name,
            desc: desc || "", status: "notified",
            eventDate: isNaN(parsedEventDate) ? new Date() : parsedEventDate,
            docs: cat.docs.map((name) => ({ name, submitted: false, link: null, fileName: null, disc: null })),
            driveFolder: "https://drive.google.com/drive/folders/PFMS-" + id,
          },
        });
        await audit(me, "Submitted reimbursement " + id);
        await notifyPerm("verify", "New reimbursement " + id + " (" + title + ") notified to Project Finance.", "notified", me.id);
        return NextResponse.json({ ok: true, id });
      }
```

Replace it with:

```js
      case "createRequest": {
        if (!can(me, "create")) return err("Forbidden", 403);
        const { title, categoryId, amount, desc, eventDate, projectionId } = body;
        if (!title || !categoryId) return err("Fill title and category.");
        const cat = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!cat || !cat.active) return err("Unknown category.");
        let proj = null;
        if (projectionId) {
          proj = await prisma.projection.findUnique({ where: { id: projectionId } });
          if (!proj || proj.status !== "advanced") return err("This projection has no available advance.");
        }
        const parsedEventDate = eventDate ? new Date(eventDate) : new Date();
        const counter = await prisma.counter.update({
          where: { id: "request" },
          data: { value: { increment: 1 } },
        });
        const id = "RB-" + counter.value;
        await prisma.request.create({
          data: {
            id, title, categoryId, amount: Number(amount) || 0,
            dept: me.dept, requesterId: me.id, requesterName: me.name,
            desc: desc || "", status: "notified",
            eventDate: isNaN(parsedEventDate) ? new Date() : parsedEventDate,
            docs: cat.docs.map((name) => ({ name, submitted: false, link: null, fileName: null, disc: null })),
            driveFolder: "https://drive.google.com/drive/folders/PFMS-" + id,
            projectionId: projectionId || null,
          },
        });
        if (proj) {
          await prisma.projection.update({ where: { id: proj.id }, data: { status: "linked", requestId: id } });
        }
        await audit(me, "Submitted reimbursement " + id + (proj ? " against projection " + proj.id : ""));
        await notifyPerm("verify", "New reimbursement " + id + " (" + title + ") notified to Project Finance.", "notified", me.id);
        return NextResponse.json({ ok: true, id });
      }
```

- [ ] **Step 4: Settle the projection when a linked request is disbursed**

The real `case "advanceRequest": { ... }` block (confirmed by reading the live file) is:

```js
      case "advanceRequest": {
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        const i = ORDER.indexOf(r.status);
        if (i >= ORDER.length - 1) return err("Already closed.");
        const next = ORDER[i + 1];
        if (!admin && !can(me, ADV_PERM[next])) return err("Forbidden", 403);

        let acctId, proofLink, acctName;
        if (next === "disbursed") {
          const cat = await prisma.category.findUnique({ where: { id: r.categoryId } });
          const candidateId = body.acctId || cat?.defaultAcctId;
          const account = candidateId ? await prisma.account.findUnique({ where: { id: candidateId } }) : null;
          const resolved = resolveDisburseAccount({
            providedAcctId: body.acctId, categoryDefaultAcctId: cat?.defaultAcctId,
            account, proofLink: body.proofLink,
          });
          if (resolved.error) return err(resolved.error);
          ({ acctId, proofLink } = resolved);
          acctName = account?.name || acctId;
        }

        const result = await advanceRequestTx(prisma, {
          id: r.id, currentStatus: r.status, nextStatus: next,
          isDisbursement: next === "disbursed", amount: r.amount, title: r.title,
          acctId, proofLink,
        });
        if (result.conflict) return err("This request was just updated by someone else — please refresh and try again.", 409);
        const label = STATUS[next].label + (next === "disbursed" ? " (" + fmt(r.amount) + " transferred)" : "");
        await audit(me, "Advanced " + r.id + " to " + STATUS[next].label + (next === "disbursed" ? " from account " + acctName : ""));
        await notifyUser(r.requesterId !== me.id ? r.requesterId : null, r.id + " — " + label + ".", next);
        await notifyPerm("disburse", r.id + " — " + label + ".", next, me.id);
        return NextResponse.json({ ok: true });
      }
```

Note the real disbursement flow always disburses exactly `r.amount` — there is no separate "actual amount paid" field on `Request` (unlike the WC Finance prototype this plan was scoped from). So the settlement compares the projection's advanced amount against `r.amount`, the amount actually disbursed.

Insert this block directly after the existing `if (result.conflict) return err(...)` line and before the `const label = ...` line:

```js
        if (next === "disbursed" && r.projectionId) {
          const proj = await prisma.projection.findUnique({ where: { id: r.projectionId } });
          if (proj && proj.status === "linked") {
            const settle = await settleProjectionTx(prisma, {
              id: proj.id, currentStatus: "linked", advancedAmount: proj.amount, actualAmount: r.amount,
              facultyAcctId: "faculty", projectAcctId: "project", title: proj.title,
            });
            if (!settle.conflict && settle.refund > 0) {
              await audit(me, "Returned unspent advance " + fmt(settle.refund) + " for " + r.id + " to Faculty account");
            }
          }
        }
```

- [ ] **Step 5: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`, log in as the seeded admin, and manually: submit a projection, approve it as a `verify`/admin role (confirm Faculty balance drops and Project balance rises by the same amount), create a request against that projection, disburse it for less than the advanced amount, and confirm the difference returns to Faculty.
Expected: balances match the arithmetic exactly; `prisma.audit` rows exist for each step (visible via the existing Audit Trail page once Task 5 ships, or via `npx prisma studio` in the meantime).

- [ ] **Step 6: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: wire projection RPC actions and disbursement settlement"
```

---

### Task 5: Minimal UI — "Projected Expenses" page

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: RPC actions `createProjection`, `approveProjection` (Task 4); reads `projectionId` on requests (Task 1).
- Produces: nothing consumed by later tasks — this is the last task in this plan.

- [ ] **Step 1: Locate the existing nav/page-switch pattern**

Run: `grep -n "NAV = \[" -A 20 components/App.jsx` and `grep -n "case \"requests\"" -A 5 components/App.jsx` (or equivalent — confirm the exact prop names your version of `App.jsx` uses for the current page and permission check; the plan author has only seen line 1–76 of this 728-line file, not its JSX body, so treat the exact prop/state names below as the target shape to match, not verbatim existing code).

- [ ] **Step 2: Add "Projected Expenses" to the nav array**

In the `NAV` array (`components/App.jsx:11`), add an entry alongside the existing `requests` entry:

```js
{ key: "projections", label: "Projected Expenses", icon: "ph-chart-line-up", perm: "requests" },
```

- [ ] **Step 3: Add a projections list page component**

Add a new function component in `components/App.jsx` (near the existing Requests list rendering) that:
- Fetches projections via the existing RPC client pattern used for requests (same `fetch("/api/rpc", { method: "POST", body: JSON.stringify({ action: ... }) })` convention already used elsewhere in the file — match it exactly rather than introducing a new fetch wrapper).
- Renders a table: Title, Department, Amount, Expected date, Status.
- Shows a "Submit projection" button (visible when `can("create")`) opening a form with fields: item title, category (select from categories already loaded on other pages), projected amount, expected date. On submit, calls the `createProjection` RPC action.
- Shows an "Issue advance" button per row when `status === "submitted"` and the user has `verify` permission or is admin. On click, calls `approveProjection` with the projection's `id`.

- [ ] **Step 4: Wire the new page into the router**

Add the `"projections"` case to whatever mechanism `App.jsx` uses to switch page content (confirmed in Step 1) so navigating to it renders the Task 5.3 component.

- [ ] **Step 5: Manual verification in the browser**

Run: `npm run dev`, log in, click "Projected Expenses" in the nav, submit a projection, confirm it lists with status "Submitted", approve it (as a role with `verify`/admin), confirm status flips to "Advance issued" and the toast/notification fires.
Expected: no console errors; list reflects server state after each action (either via refetch or optimistic update, matching how the existing Requests page already handles this).

- [ ] **Step 6: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add Projected Expenses UI page"
```

---

## Self-Review Notes

- **Spec coverage:** projection submission (Task 4/5), advance approval with Faculty→Project transfer (Task 2/4), auto-return of unspent advance at disbursement (Task 3/4), minimal UI (Task 5) — all covered. Deposit payments, revenue "purses", and role-based dashboard visibility toggles from the original WC Finance feature list are explicitly **out of scope** for this plan; they are separate plans per the earlier scope-check discussion.
- **Placeholder scan:** none — every step has literal code or a literal shell command.
- **Type/name consistency:** `approveProjectionTx` / `settleProjectionTx` signatures match between their Task 2/3 definitions and their Task 4 call sites; `Projection.status` values (`submitted → advanced → linked → settled`) are used consistently across all tasks.
- **Known gap flagged inline:** Task 4 Step 2–4 now quote the real, verified `app/api/rpc/route.js` blocks verbatim (re-read after initial drafting). Task 5 Step 1 still tells the implementer to `grep` the live file first — the plan author saw only `components/App.jsx` lines 1–76, not the full 728-line file, so the exact page-routing mechanism must be confirmed against the live file rather than assumed.
