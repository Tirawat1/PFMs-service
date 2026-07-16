# Multi-account Disbursement Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded single-account disbursement in PFMS with arbitrary admin-managed accounts, category-driven default account routing (overridable at disburse time), a required proof-of-transfer link on disbursement, a backdatable `eventDate` on requests, and a spent/remaining rollup on the Accounts page.

**Architecture:** Three Prisma schema additions (`Account.active`, `Category.defaultAcctId`, `Request.eventDate`/`acctId`/`disburseProofLink`), one core transaction function change (`advanceRequestTx` takes a caller-supplied `acctId` instead of a hardcoded `"project"`), five new/extended RPC actions in the single `app/api/rpc/route.js` mutation endpoint, and UI changes confined to `components/App.jsx` (the app's one SPA component).

**Tech Stack:** Next.js 14 App Router, Prisma + PostgreSQL, plain React state (no form library), `node --test` for the existing test suite.

## Global Constraints

- No migrations directory — schema changes ship via `npx prisma db push` (per CLAUDE.md), never `prisma migrate`.
- No new PERMKEYS — all new admin actions (account management, category routing) reuse the existing `admin` (`"*"`) check, per the design decision that account management stays admin-only.
- Every RPC action follows the existing pattern in `app/api/rpc/route.js`: a `case` in the `switch(action)` block, its own permission check, `err(msg, status)` for failures, `audit(me, "...")` for state changes worth logging.
- `Account` rows are never hard-deleted (`closeAccount` sets `active: false`) — `Txn.acctId` and `Request.acctId` have no FK constraint but existing rows must keep resolving.
- Follow existing code style in the touched files: no semicolon-per-statement changes, no reformatting unrelated lines, minimal diffs.

---

### Task 1: Schema changes

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Account.active` (Boolean, default true), `Category.defaultAcctId` (String?), `Request.eventDate` (DateTime, default now), `Request.acctId` (String?), `Request.disburseProofLink` (String, default "") — all later tasks depend on these fields existing.

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, change the `Account` model:

```prisma
model Account {
  id      String  @id @default(cuid()) // "faculty" | "project" seeded explicitly; new accounts get a generated id
  name    String
  nameTh  String  @default("")
  icon    String  @default("ph-bank")
  balance Float   @default(0)
  active  Boolean @default(true)
}
```

(`@default(cuid())` only applies when `prisma.account.create` is called without an explicit `id` — Task 5's `createAccount` relies on this; the existing `"faculty"`/`"project"` seeded rows, which always pass an explicit `id`, are unaffected.)

Change the `Category` model:

```prisma
model Category {
  id            String  @id @default(cuid())
  name          String
  nameTh        String  @default("")
  icon          String  @default("ph-tag")
  docs          Json // array of document names
  notes         String  @default("")
  defaultAcctId String?
}
```

Change the `Request` model:

```prisma
model Request {
  id                String   @id // e.g. RB-1042
  title             String
  categoryId        String
  amount            Float
  dept              String
  requesterId       String?
  requesterName     String
  status            String   @default("notified")
  desc              String   @default("")
  driveFolder       String   @default("")
  // docs: [{name, submitted, link, fileName,
  //          disc: {open, note, by, ts, fixed, fixedNote} | null}]
  docs              Json
  eventDate         DateTime @default(now())
  acctId            String?
  disburseProofLink String   @default("")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

- [ ] **Step 2: Push the schema and regenerate the client**

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.` followed by a successful `Generated Prisma Client` line (same output shape verified earlier when fixing `DATABASE_URL`).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add account/category/request fields for multi-account disbursement"
```

---

### Task 2: `advanceRequestTx` takes a caller-supplied account and proof link

**Files:**
- Modify: `lib/requests.mjs`
- Modify: `tests/requests.test.mjs`

**Interfaces:**
- Consumes: nothing new from other tasks (pure function change).
- Produces: `advanceRequestTx(prisma, { id, currentStatus, nextStatus, isDisbursement, amount, title, acctId, proofLink })` — Task 4 (RPC `advanceRequest`) calls this with the resolved `acctId`/`proofLink`.

- [ ] **Step 1: Rewrite the test file's fake Prisma and existing tests to key balances by account id**

Replace the full contents of `tests/requests.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceRequestTx } from "../lib/requests.mjs";

// Fakes a single-row compare-and-swap the way `UPDATE ... WHERE id=? AND status=?`
// behaves atomically in Postgres — the check and the write happen as one step.
function makeFakePrisma({ status, balances }) {
  const state = { status, balances: { ...balances }, txns: [], requestUpdates: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        request: {
          updateMany: async ({ where, data }) => {
            if (where.status !== state.status) return { count: 0 };
            state.status = data.status;
            return { count: 1 };
          },
          update: async ({ data }) => {
            state.requestUpdates.push(data);
          },
        },
        account: {
          update: async ({ where, data }) => {
            state.balances[where.id] -= data.balance.decrement;
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

test("advances status and disburses funds from the given account exactly once", async () => {
  const prisma = makeFakePrisma({ status: "verified", balances: { project: 1000 } });
  const result = await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test", acctId: "project", proofLink: "https://example.com/proof",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.status, "disbursed");
  assert.equal(prisma.state.balances.project, 900);
  assert.equal(prisma.state.txns.length, 1);
  assert.equal(prisma.state.txns[0].acctId, "project");
});

test("disburses from the account passed in, not a hardcoded one", async () => {
  const prisma = makeFakePrisma({ status: "verified", balances: { faculty: 5000, project: 1000 } });
  const result = await advanceRequestTx(prisma, {
    id: "RB-2", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 300, title: "Test", acctId: "faculty", proofLink: "https://example.com/proof",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.balances.faculty, 4700);
  assert.equal(prisma.state.balances.project, 1000, "the other account must be untouched");
  assert.equal(prisma.state.txns[0].acctId, "faculty");
});

test("writes the account and proof link onto the request atomically with the disbursement", async () => {
  const prisma = makeFakePrisma({ status: "verified", balances: { project: 1000 } });
  await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test", acctId: "project", proofLink: "https://example.com/proof",
  });
  assert.equal(prisma.state.requestUpdates.length, 1);
  assert.deepEqual(prisma.state.requestUpdates[0], { acctId: "project", disburseProofLink: "https://example.com/proof" });
});

test("advancing a non-disbursement step does not touch the account", async () => {
  const prisma = makeFakePrisma({ status: "docs_submitted", balances: { project: 1000 } });
  const result = await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "docs_submitted", nextStatus: "verified",
    isDisbursement: false, amount: 100, title: "Test",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.balances.project, 1000);
  assert.equal(prisma.state.txns.length, 0);
  assert.equal(prisma.state.requestUpdates.length, 0);
});

test("a stale advance (status already moved on) is rejected as a conflict, not double-applied", async () => {
  const prisma = makeFakePrisma({ status: "disbursed", balances: { project: 900 } });
  const result = await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test", acctId: "project", proofLink: "https://example.com/proof",
  });
  assert.equal(result.conflict, true);
  assert.equal(prisma.state.balances.project, 900, "balance must not move on a rejected conflict");
  assert.equal(prisma.state.txns.length, 0);
});

test("two concurrent disbursement attempts only apply once", async () => {
  const prisma = makeFakePrisma({ status: "verified", balances: { project: 1000 } });
  const args = {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test", acctId: "project", proofLink: "https://example.com/proof",
  };
  const [a, b] = await Promise.all([
    advanceRequestTx(prisma, args),
    advanceRequestTx(prisma, args),
  ]);
  const conflicts = [a.conflict, b.conflict].filter(Boolean).length;
  assert.equal(conflicts, 1, "exactly one of the two concurrent calls must be rejected");
  assert.equal(prisma.state.balances.project, 900, "balance must only be decremented once");
  assert.equal(prisma.state.txns.length, 1);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL — `state.balances[where.id] -= data.balance.decrement` and `prisma.state.requestUpdates` will be `undefined`/errors because `lib/requests.mjs` still hardcodes `"project"` and never calls `tx.request.update`.

- [ ] **Step 3: Rewrite `lib/requests.mjs`**

```js
// Advances a request to `nextStatus`, guarded against a concurrent advance of the
// same request (the status update only applies if `currentStatus` still matches),
// and atomically records the disbursement transaction — debiting the caller-supplied
// `acctId` and stamping the request with which account paid and the transfer proof —
// when the transition pays out funds.
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

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: all tests in `tests/requests.test.mjs` PASS (plus the other test files, unaffected).

- [ ] **Step 5: Commit**

```bash
git add lib/requests.mjs tests/requests.test.mjs
git commit -m "feat: advanceRequestTx disburses from a caller-supplied account with a proof link"
```

---

### Task 3: `createRequest` accepts a backdatable `eventDate`

**Files:**
- Modify: `app/api/rpc/route.js:49-72`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Request.eventDate` populated from request body — Task 11 (frontend detail view) reads it back from the snapshot.

- [ ] **Step 1: Update the `createRequest` case**

In `app/api/rpc/route.js`, replace the `createRequest` case (lines 49-72):

```js
      case "createRequest": {
        if (!can(me, "create")) return err("Forbidden", 403);
        const { title, categoryId, amount, desc, eventDate } = body;
        if (!title || !categoryId) return err("Fill title and category.");
        const cat = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!cat) return err("Unknown category.");
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

- [ ] **Step 2: Manually verify with the running app**

Run: `npm run dev`, log in, create a reimbursement with a backdated `eventDate` (once Task 7 adds the field — until then this is exercised via a direct RPC call):

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/rpc \
  -H "Content-Type: application/json" \
  -d '{"action":"createRequest","title":"Backfill test","categoryId":"<a real category id>","amount":100,"eventDate":"2026-06-01"}'
```

Expected: `{"ok":true,"id":"RB-..."}`. This step is a smoke check — full UI verification happens after Task 7.

- [ ] **Step 3: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: createRequest accepts a backdatable eventDate"
```

---

### Task 4: `advanceRequest` validates and resolves the disbursement account

**Files:**
- Modify: `lib/requests.mjs` (add `resolveDisburseAccount`)
- Create: `tests/resolve-disburse-account.test.mjs`
- Modify: `app/api/rpc/route.js:74-91`

**Interfaces:**
- Consumes: `advanceRequestTx(prisma, { ..., acctId, proofLink })` from Task 2.
- Produces: `resolveDisburseAccount({ providedAcctId, categoryDefaultAcctId, account, proofLink })` — a pure function the RPC route calls before touching the database, returning either `{ error }` or `{ acctId, proofLink }`. `advanceRequest` RPC action now accepts `{ id, acctId?, proofLink? }` in the body — Task 8 (frontend disburse modal) sends these two extra fields only when advancing into `disbursed`.

This mirrors the existing pattern in `lib/permissions.mjs` (`canManageRequestDocs`), where authorization/validation logic that would otherwise be buried in the RPC route is pulled into a plain function so it's unit-testable without a database.

- [ ] **Step 1: Write the failing test**

Create `tests/resolve-disburse-account.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDisburseAccount } from "../lib/requests.mjs";

test("resolves the explicitly provided account when valid", () => {
  const result = resolveDisburseAccount({
    providedAcctId: "faculty", categoryDefaultAcctId: "project",
    account: { id: "faculty", active: true }, proofLink: "https://example.com/proof",
  });
  assert.deepEqual(result, { acctId: "faculty", proofLink: "https://example.com/proof" });
});

test("falls back to the category's default account when none is provided", () => {
  const result = resolveDisburseAccount({
    providedAcctId: null, categoryDefaultAcctId: "project",
    account: { id: "project", active: true }, proofLink: "https://example.com/proof",
  });
  assert.deepEqual(result, { acctId: "project", proofLink: "https://example.com/proof" });
});

test("rejects when no account can be resolved at all", () => {
  const result = resolveDisburseAccount({
    providedAcctId: null, categoryDefaultAcctId: null, account: null, proofLink: "https://example.com/proof",
  });
  assert.equal(result.error, "Select a source account before disbursing.");
});

test("rejects a closed (inactive) account", () => {
  const result = resolveDisburseAccount({
    providedAcctId: "faculty", categoryDefaultAcctId: null,
    account: { id: "faculty", active: false }, proofLink: "https://example.com/proof",
  });
  assert.equal(result.error, "Selected account is not available.");
});

test("rejects a missing/empty proof link", () => {
  const result = resolveDisburseAccount({
    providedAcctId: "faculty", categoryDefaultAcctId: null,
    account: { id: "faculty", active: true }, proofLink: "   ",
  });
  assert.equal(result.error, "Attach a transfer proof link before disbursing.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `resolveDisburseAccount is not a function` (it doesn't exist in `lib/requests.mjs` yet).

- [ ] **Step 3: Implement `resolveDisburseAccount` in `lib/requests.mjs`**

Add this export alongside `advanceRequestTx` in `lib/requests.mjs`:

```js
// Resolves and validates which account a disbursement should be debited from,
// given what the caller explicitly picked, the request's category default, and
// the looked-up Account row (or null if `providedAcctId`/`categoryDefaultAcctId`
// didn't resolve to a real row). Pure — no I/O — so the RPC route does the
// lookups and this just decides pass/reject.
export function resolveDisburseAccount({ providedAcctId, categoryDefaultAcctId, account, proofLink }) {
  const acctId = providedAcctId || categoryDefaultAcctId;
  if (!acctId) return { error: "Select a source account before disbursing." };
  if (!account || account.id !== acctId || !account.active) return { error: "Selected account is not available." };
  const trimmedProof = (proofLink || "").trim();
  if (!trimmedProof) return { error: "Attach a transfer proof link before disbursing." };
  return { acctId, proofLink: trimmedProof };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all 5 new tests in `tests/resolve-disburse-account.test.mjs` PASS.

- [ ] **Step 5: Wire it into the `advanceRequest` RPC case**

Replace the `advanceRequest` case (lines 74-91) in `app/api/rpc/route.js`. Also update the import at the top of the file (line 9) from `import { advanceRequestTx } from "@/lib/requests.mjs";` to:

```js
import { advanceRequestTx, resolveDisburseAccount } from "@/lib/requests.mjs";
```

```js
      case "advanceRequest": {
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        const i = ORDER.indexOf(r.status);
        if (i >= ORDER.length - 1) return err("Already closed.");
        const next = ORDER[i + 1];
        if (!admin && !can(me, ADV_PERM[next])) return err("Forbidden", 403);

        let acctId, proofLink;
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
        }

        const result = await advanceRequestTx(prisma, {
          id: r.id, currentStatus: r.status, nextStatus: next,
          isDisbursement: next === "disbursed", amount: r.amount, title: r.title,
          acctId, proofLink,
        });
        if (result.conflict) return err("This request was just updated by someone else — please refresh and try again.", 409);
        const label = STATUS[next].label + (next === "disbursed" ? " (" + fmt(r.amount) + " transferred)" : "");
        await audit(me, "Advanced " + r.id + " to " + STATUS[next].label + (next === "disbursed" ? " from account " + acctId : ""));
        await notifyUser(r.requesterId !== me.id ? r.requesterId : null, r.id + " — " + label + ".", next);
        await notifyPerm("disburse", r.id + " — " + label + ".", next, me.id);
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 6: Manually verify the two rejection paths end-to-end**

Run: `npm run dev`, sign in as a finance officer, pick a `verified` request whose category has no `defaultAcctId`, and call:

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/rpc \
  -H "Content-Type: application/json" -d '{"action":"advanceRequest","id":"RB-XXXX"}'
```

Expected: `{"error":"Select a source account before disbursing."}`. Then retry with `"acctId":"project"` but no `proofLink`:

Expected: `{"error":"Attach a transfer proof link before disbursing."}`. Then retry with both `acctId` and `proofLink` set:

Expected: `{"ok":true}`, and the request's status is now `disbursed`.

- [ ] **Step 7: Commit**

```bash
git add lib/requests.mjs tests/resolve-disburse-account.test.mjs app/api/rpc/route.js
git commit -m "feat: advanceRequest requires a resolved account and proof link to disburse"
```

---

### Task 5: Account management RPC actions (admin only)

**Files:**
- Modify: `app/api/rpc/route.js` (add new cases after the `removeMasterDoc` case, before the `// ---------- users & roles (admin) ----------` comment at line 212)

**Interfaces:**
- Consumes: nothing new.
- Produces: RPC actions `createAccount`, `updateAccount`, `closeAccount`, `addFunds` — Task 9 (frontend Accounts admin UI) calls these by name with the payloads shown below.

- [ ] **Step 1: Add the four new cases**

Insert this block into `app/api/rpc/route.js` immediately before line 212 (`// ---------- users & roles (admin) ----------`):

```js
      // ---------- accounts (admin) ----------
      case "createAccount": {
        if (!admin) return err("Forbidden", 403);
        if (!body.name) return err("Enter an account name.");
        const acct = await prisma.account.create({
          data: { name: body.name, nameTh: body.nameTh || body.name, icon: body.icon || "ph-bank", balance: 0 },
        });
        await audit(me, "Created account " + acct.name);
        return NextResponse.json({ ok: true, id: acct.id });
      }
      case "updateAccount": {
        if (!admin) return err("Forbidden", 403);
        await prisma.account.update({
          where: { id: body.id },
          data: { name: body.name, nameTh: body.nameTh || body.name, icon: body.icon || "ph-bank" },
        });
        return NextResponse.json({ ok: true });
      }
      case "closeAccount": {
        if (!admin) return err("Forbidden", 403);
        const acct = await prisma.account.update({ where: { id: body.id }, data: { active: false } });
        await audit(me, "Closed account " + acct.name);
        return NextResponse.json({ ok: true });
      }
      case "addFunds": {
        if (!admin) return err("Forbidden", 403);
        const amount = Number(body.amount) || 0;
        if (amount <= 0) return err("Enter a positive amount.");
        const acct = await prisma.account.update({
          where: { id: body.acctId }, data: { balance: { increment: amount } },
        });
        await prisma.txn.create({ data: { acctId: acct.id, type: "in", amount, desc: body.desc || "Funds added" } });
        await audit(me, "Added " + fmt(amount) + " to account " + acct.name);
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 2: Manually verify**

Run: `npm run dev`, sign in as admin, then:

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/rpc \
  -H "Content-Type: application/json" \
  -d '{"action":"createAccount","name":"Dept Petty Cash","nameTh":"เงินสดย่อยฝ่าย"}'
```

Expected: `{"ok":true,"id":"<cuid>"}`. Then `addFunds` with that id and `updateAccount`/`closeAccount` — each should return `{"ok":true}` and a non-admin user calling any of the four should get `{"error":"Forbidden"}` with a 403.

- [ ] **Step 3: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: add admin-only account management RPC actions"
```

---

### Task 6: Category default-account RPC support

**Files:**
- Modify: `app/api/rpc/route.js:166-172` (`createCategory`), add new case near `updateCategoryNotes` (line 173-177)

**Interfaces:**
- Consumes: `Category.defaultAcctId` from Task 1.
- Produces: `createCategory` accepts `defaultAcctId` in its payload; new `updateCategoryAccount` action — Task 10 (frontend CatEdit) calls it as `rpc("updateCategoryAccount", { id, defaultAcctId })`.

- [ ] **Step 1: Update `createCategory` and add `updateCategoryAccount`**

Replace the `createCategory` case:

```js
      case "createCategory": {
        if (!admin) return err("Forbidden", 403);
        if (!body.name) return err("Enter a category name.");
        await prisma.category.create({
          data: { name: body.name, nameTh: body.nameTh || body.name, notes: body.notes || "", docs: [], defaultAcctId: body.defaultAcctId || null },
        });
        await audit(me, "Created category " + body.name);
        return NextResponse.json({ ok: true });
      }
```

Add a new case immediately after `updateCategoryNotes` (after line 177 in the original file):

```js
      case "updateCategoryAccount": {
        if (!admin) return err("Forbidden", 403);
        await prisma.category.update({ where: { id: body.id }, data: { defaultAcctId: body.defaultAcctId || null } });
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 2: Manually verify**

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/rpc \
  -H "Content-Type: application/json" \
  -d '{"action":"updateCategoryAccount","id":"<category id>","defaultAcctId":"project"}'
```

Expected: `{"ok":true}`. Then `GET /api/data` and confirm that category's `defaultAcctId` is `"project"`.

- [ ] **Step 3: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: categories can set a default disbursement account"
```

---

### Task 7: New-request form — `eventDate` field

**Files:**
- Modify: `components/App.jsx:590-596` (the `newRequest` modal block)
- Modify: `components/App.jsx:200`, `:262` (default form values when opening the modal)

**Interfaces:**
- Consumes: `createRequest` accepting `eventDate` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Default `eventDate` when opening the "New reimbursement" modal**

In `components/App.jsx`, both places that open the `newRequest` modal set the initial form. Update line 200 (`Dashboard`):

```jsx
      {can("create") && <button className="btn btn-primary grad" onClick={() => { setForm({ categoryId: data.categories[0]?.id, amount: "", eventDate: new Date().toISOString().slice(0, 10) }); setModal({ type: "newRequest" }); }}><i className="ph ph-plus" /> New reimbursement</button>}
```

And line 262 (`Requests`):

```jsx
      {can("create") && <button className="btn btn-primary grad" onClick={() => { setForm({ categoryId: data.categories[0]?.id, amount: "", eventDate: new Date().toISOString().slice(0, 10) }); setModal({ type: "newRequest" }); }}><i className="ph ph-plus" /> New request</button>}
```

- [ ] **Step 2: Add the date input to the modal**

In the `Modal` function, inside the `modal.type === "newRequest"` block (lines 590-596), add a field after "Amount":

```jsx
        {modal.type === "newRequest" && (<>
          <div className="field"><label className="label">Title</label><input className="input" value={form.title || ""} onChange={set("title")} placeholder="e.g. Snacks for opening ceremony" /></div>
          <div className="field"><label className="label">Expense category</label><select className="input" value={form.categoryId || ""} onChange={set("categoryId")}>{data.categories.map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}</select></div>
          <div className="field"><label className="label">Amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
          <div className="field"><label className="label">Event date (when the expense actually happened)</label><input className="input" type="date" value={form.eventDate || ""} onChange={set("eventDate")} /></div>
          <div className="field"><label className="label">Description</label><textarea className="input" style={{ minHeight: 70, resize: "vertical" }} value={form.desc || ""} onChange={set("desc")} placeholder="Purpose of this expense…" /></div>
          {selCat && selCat.docs.length > 0 && <div className="field"><label className="label">Documents required for this category</label><div className="chipwrap">{selCat.docs.map((d) => <span key={d} className="doc-chip th" style={{ padding: "5px 10px", fontSize: 12 }}>{d}</span>)}</div></div>}
        </>)}
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, open the app, click "New reimbursement", confirm the date field shows today's date pre-filled and can be changed to a past date, submit, then open the request detail (Task 11 will surface `eventDate` there — until then confirm via `GET /api/data` that the created request's `eventDate` matches what was entered).

- [ ] **Step 4: Commit**

```bash
git add components/App.jsx
git commit -m "feat: new-request form captures a backdatable event date"
```

---

### Task 8: Disburse action becomes a modal (account + proof link)

**Files:**
- Modify: `components/App.jsx:296` (`Detail` — `canAdv` button), `:358`
- Modify: `components/App.jsx:567-583` (`Modal` — titles, submit switch)

**Interfaces:**
- Consumes: `advanceRequest` accepting `{ id, acctId, proofLink }` on disburse (Task 4), `Category.defaultAcctId` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Split the advance button — disburse opens a modal, everything else stays a direct call**

In `components/App.jsx`, the `Detail` function needs `data` (already destructured) to look up the category's `defaultAcctId` and the list of active accounts. Replace line 358:

```jsx
        {canAdv && nextKey !== "disbursed" && <button className="btn btn-primary grad" style={{ marginTop: "auto" }} onClick={() => rpc("advanceRequest", { id: r.id }, "Status updated.")}><i className="ph ph-arrow-right" /> {ADV_LABELS[nextKey]}</button>}
        {canAdv && nextKey === "disbursed" && <button className="btn btn-primary grad" style={{ marginTop: "auto" }} onClick={() => { setForm({ acctId: c?.defaultAcctId || "", proofLink: "" }); setModal({ type: "disburse", reqId: r.id }); }}><i className="ph ph-arrow-right" /> {ADV_LABELS[nextKey]}</button>}
```

`Detail`'s function signature already receives `setForm`/`setModal` via `ctx` — no signature change needed since it's spread as `{...ctx}` in the parent (line 122: `{screen === "detail" && <Detail {...ctx} />}`), and `ctx` already includes `data`.

- [ ] **Step 2: Add the `disburse` modal type**

In the `Modal` function, update the `titles` map (line 570):

```jsx
  const titles = { newRequest: "New reimbursement request", newUser: "Add user", newRole: "Add role", newCategory: "New expense category", attach: "Submit document (Google Drive link)", flagDisc: "Flag discrepancy", markFixed: "Document changed", disburse: "Disburse funds" };
```

Update `submit` (lines 573-583) to add a branch:

```jsx
  const submit = async () => {
    let ok = false;
    if (modal.type === "newRequest") ok = await rpc("createRequest", form, "Reimbursement submitted.");
    else if (modal.type === "newUser") ok = await rpc("createUser", form, "User added.");
    else if (modal.type === "newRole") ok = await rpc("createRole", form, "Role created.");
    else if (modal.type === "newCategory") ok = await rpc("createCategory", form, "Category created.");
    else if (modal.type === "attach") ok = await rpc("attachDoc", { id: modal.reqId, idx: modal.idx, link: form.link, fileName: form.fileName }, "Document submitted.");
    else if (modal.type === "flagDisc") ok = await rpc("flagDiscrepancy", { id: modal.reqId, idx: modal.idx, note: form.note }, "Discrepancy flagged — requester notified.");
    else if (modal.type === "markFixed") ok = await rpc("markFixed", { id: modal.reqId, idx: modal.idx, note: form.note }, "Officer notified of the change.");
    else if (modal.type === "disburse") ok = await rpc("advanceRequest", { id: modal.reqId, acctId: form.acctId, proofLink: form.proofLink }, "Funds disbursed.");
    if (ok) close();
  };
```

Add the modal body — insert after the `markFixed` block (after line 645, before the submit button at line 647):

```jsx
        {modal.type === "disburse" && (<>
          <div className="field"><label className="label">Source account</label><select className="input" value={form.acctId || ""} onChange={set("acctId")}>
            <option value="" disabled>Select an account…</option>
            {data.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
          <div className="field"><label className="label">Transfer proof link</label><input className="input" value={form.proofLink || ""} onChange={set("proofLink")} placeholder="https://… (bank transfer slip / statement)" /></div>
          <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>Funds will be deducted from this account immediately.</div>
        </>)}
```

Update the final submit button's disabled state and label (line 647):

```jsx
        <button className="btn btn-primary grad" style={{ width: "100%", marginTop: 6 }} onClick={submit} disabled={modal.type === "disburse" && !(form.acctId && (form.proofLink || "").trim())}><i className="ph ph-check" /> {modal.type === "flagDisc" ? "Flag & notify requester" : modal.type === "markFixed" ? "Notify officer" : modal.type === "disburse" ? "Confirm disbursement" : "Submit"}</button>
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, sign in as a finance officer, open a `verified` request, click the advance button — confirm a modal opens (not an immediate status change), the account dropdown lists active accounts, the confirm button stays disabled until both fields are filled, and after confirming the request moves to `disbursed` and the toast reads "Funds disbursed." Confirm other transitions (e.g. `verify`) still fire immediately with no modal.

- [ ] **Step 4: Commit**

```bash
git add components/App.jsx
git commit -m "feat: disbursement requires picking an account and a proof link via modal"
```

---

### Task 9: Accounts page — admin management + spend rollup

**Files:**
- Modify: `components/App.jsx:420-444` (`Accounts` function)
- Modify: `components/App.jsx:567-583` (`Modal` — new `newAccount`/`addFunds` types)

**Interfaces:**
- Consumes: `createAccount`, `updateAccount`, `closeAccount`, `addFunds` RPC actions (Task 5).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite the `Accounts` function**

Replace lines 420-444 in `components/App.jsx`:

```jsx
/* ---------- Accounts ---------- */
function Accounts({ data, admin, rpc, setModal, setForm }) {
  const totalSpent = data.txns.filter((t) => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const totalRemaining = data.accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0);
  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Accounts</h1><p className="sub">Cash inflows and outflows by account, with current available balances.</p></div>
      {admin && <button className="btn btn-primary grad" onClick={() => { setForm({ name: "", nameTh: "", icon: "ph-bank" }); setModal({ type: "newAccount" }); }}><i className="ph ph-plus" /> New account</button>}
    </div>
    <div className="stats">
      <div className="stat"><div className="stat-ic" style={{ background: "rgba(255,107,154,.14)", color: "#ff6b9a" }}><i className="ph ph-arrow-up-right" /></div><div className="stat-v mono">{fmt(totalSpent)}</div><div className="stat-l">Total spent</div><div className="stat-s dim">disbursed reimbursements</div></div>
      <div className="stat"><div className="stat-ic" style={{ background: "var(--soft)", color: "#ff8bb5" }}><i className="ph ph-vault" /></div><div className="stat-v mono">{fmt(totalRemaining)}</div><div className="stat-l">Total remaining</div><div className="stat-s dim">across active accounts</div></div>
    </div>
    <div className="grid2">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {data.accounts.map((a) => {
          const inf = data.txns.filter((t) => t.acctId === a.id && t.type === "in").reduce((s, t) => s + t.amount, 0);
          const outf = data.txns.filter((t) => t.acctId === a.id && t.type === "out").reduce((s, t) => s + t.amount, 0);
          return (
            <div key={a.id} className="panel" style={a.active ? {} : { opacity: 0.55 }}>
              <div className="fx ac gap14">
                <div className="acct-ic grad" style={{ width: 48, height: 48, fontSize: 23 }}><i className={"ph " + a.icon} /></div>
                <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 16 }}>{a.name}{!a.active && <span className="dim" style={{ fontSize: 11.5, marginLeft: 8 }}>(closed)</span>}</div><div className="dim th" style={{ fontSize: 12.5 }}>{a.nameTh}</div></div>
                {admin && a.active && (
                  <div className="fx gap8">
                    <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ acctId: a.id, amount: "", desc: "" }); setModal({ type: "addFunds", acctId: a.id, acctName: a.name }); }}><i className="ph ph-plus" /> Add funds</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => rpc("closeAccount", { id: a.id }, "Account closed.")}><i className="ph ph-x" /> Close</button>
                  </div>
                )}
              </div>
              <div className="fx" style={{ marginTop: 16, gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 120, background: "#180d15", borderRadius: 12, padding: "12px 14px" }}><div className="dim" style={{ fontSize: 11.5, fontWeight: 700 }}>BALANCE</div><div className="mono" style={{ fontWeight: 800, fontSize: 20 }}>{fmt(a.balance)}</div></div>
                <div style={{ flex: 1, minWidth: 100, background: "#180d15", borderRadius: 12, padding: "12px 14px" }}><div className="dim" style={{ fontSize: 11.5, fontWeight: 700 }}>IN</div><div className="mono pos" style={{ fontWeight: 800, fontSize: 16 }}>{fmt(inf)}</div></div>
                <div style={{ flex: 1, minWidth: 100, background: "#180d15", borderRadius: 12, padding: "12px 14px" }}><div className="dim" style={{ fontSize: 11.5, fontWeight: 700 }}>OUT</div><div className="mono neg" style={{ fontWeight: 800, fontSize: 16 }}>{fmt(outf)}</div></div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="panel"><h3 className="panel-t" style={{ marginBottom: 14 }}>Transactions</h3><div style={{ display: "flex", flexDirection: "column" }}>{data.txns.map((t) => <TxnRow key={t.id} t={t} accounts={data.accounts} />)}</div></div>
    </div>
  </>);
}
```

Note: `fmt` is the module-level helper already defined at the top of the file (line 5) — no import change needed.

- [ ] **Step 2: Add `newAccount` and `addFunds` modal bodies**

In the `Modal` function, update `titles` (already touched in Task 8 — extend the same line):

```jsx
  const titles = { newRequest: "New reimbursement request", newUser: "Add user", newRole: "Add role", newCategory: "New expense category", attach: "Submit document (Google Drive link)", flagDisc: "Flag discrepancy", markFixed: "Document changed", disburse: "Disburse funds", newAccount: "New account", addFunds: "Add funds" };
```

Extend `submit`:

```jsx
    else if (modal.type === "disburse") ok = await rpc("advanceRequest", { id: modal.reqId, acctId: form.acctId, proofLink: form.proofLink }, "Funds disbursed.");
    else if (modal.type === "newAccount") ok = await rpc("createAccount", form, "Account created.");
    else if (modal.type === "addFunds") ok = await rpc("addFunds", { acctId: modal.acctId, amount: form.amount, desc: form.desc }, "Funds added.");
    if (ok) close();
```

Add the two modal bodies after the `disburse` block from Task 8:

```jsx
        {modal.type === "newAccount" && (<>
          <div className="field"><label className="label">Account name (EN)</label><input className="input" value={form.name || ""} onChange={set("name")} placeholder="e.g. Department Petty Cash" /></div>
          <div className="field"><label className="label">ชื่อบัญชี (TH)</label><input className="input th" value={form.nameTh || ""} onChange={set("nameTh")} /></div>
        </>)}

        {modal.type === "addFunds" && (<>
          <div className="drive-banner" style={{ marginBottom: 18 }}><i className="ph ph-bank" /><span>Adding funds to — <b>{modal.acctName}</b></span></div>
          <div className="field"><label className="label">Amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
          <div className="field"><label className="label">Description</label><input className="input" value={form.desc || ""} onChange={set("desc")} placeholder="e.g. Faculty budget allocation" /></div>
        </>)}
```

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, sign in as admin, go to Accounts, confirm the two new stat tiles show a spent/remaining figure, click "New account", create one, use "Add funds" on it, then "Close" it and confirm it greys out and disappears from the disburse-modal dropdown (Task 8) while still showing in the accounts list.

- [ ] **Step 4: Commit**

```bash
git add components/App.jsx
git commit -m "feat: admin account management and spend/remaining rollup on the Accounts page"
```

---

### Task 10: Category edit — default account dropdown

**Files:**
- Modify: `components/App.jsx:384-418` (`CatEdit` function)

**Interfaces:**
- Consumes: `updateCategoryAccount` RPC action (Task 6), `data.accounts` (already in snapshot).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the dropdown**

In `CatEdit`, the function signature at line 384 is `function CatEdit({ data, go, rpc, catId })` — no new props needed since `data.accounts` is already present. Insert a new field into the first `panel` div, right after the category-note `textarea` block (after line 399, still inside the same `<div className="panel">` that closes at line 400):

```jsx
        <div style={{ marginTop: 20 }}>
          <label className="label">Category note (thresholds, vendor rules, deadlines…)</label>
          <textarea className="input th" style={{ minHeight: 80, resize: "vertical" }} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => rpc("updateCategoryNotes", { id: c.id, notes: note })} />
        </div>
        <div style={{ marginTop: 16 }}>
          <label className="label">Default source account</label>
          <select className="input" value={c.defaultAcctId || ""} onChange={(e) => rpc("updateCategoryAccount", { id: c.id, defaultAcctId: e.target.value || null })}>
            <option value="">No default — officer picks at disbursement</option>
            {data.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
```

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, sign in as admin, open a category, set a default account, navigate away and back to confirm it persisted, then open a request in that category as a finance officer and confirm the disburse modal (Task 8) prefills that account.

- [ ] **Step 3: Commit**

```bash
git add components/App.jsx
git commit -m "feat: categories can be assigned a default disbursement account"
```

---

### Task 11: Request detail — show event date, account, and proof link

**Files:**
- Modify: `components/App.jsx:302-361` (`Detail` function)

**Interfaces:**
- Consumes: `Request.eventDate`/`acctId`/`disburseProofLink` (Task 1), `fmtDate` helper (already defined at line 6).
- Produces: nothing (terminal task).

- [ ] **Step 1: Show `eventDate` in the header line**

Replace line 305:

```jsx
      <div><h1 className="h1 dsp" style={{ fontSize: 27 }}>{r.title}</h1><div className="dim" style={{ fontSize: 13, marginTop: 4 }}>{r.id} · event {fmtDate(r.eventDate)} · created {fmtDate(r.createdAt)}</div></div>
```

- [ ] **Step 2: Show account + proof link once disbursed**

In the "Details" panel, after the category-note block (line 357, right before the `canAdv` button), add:

```jsx
        {r.acctId && (
          <div style={{ padding: "13px 15px", borderRadius: 12, background: "#180d15", border: "1px solid var(--line2)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 5 }}><i className="ph ph-bank" /> Disbursed from</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{data.accounts.find((a) => a.id === r.acctId)?.name || r.acctId}</div>
            {r.disburseProofLink && <a href={r.disburseProofLink} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "#7cb3ff" }}>View transfer proof ↗</a>}
          </div>
        )}
```

`data` is already destructured in `Detail`'s signature (line 289: `function Detail({ me, data, admin, can, lang, catName, catAlt, go, rpc, setModal, setForm, detailId })`) — no signature change needed.

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, open a `disbursed` request, confirm the header shows the event date, and the "Disbursed from" box shows the correct account name and a working proof-link anchor. Open a request that hasn't been disbursed yet and confirm the box is absent.

- [ ] **Step 4: Commit**

```bash
git add components/App.jsx
git commit -m "feat: show event date and disbursement account/proof on request detail"
```

---

### Task 12: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests across `tests/permissions.test.mjs`, `tests/requests.test.mjs`, `tests/snapshot.test.mjs` PASS.

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: `prisma generate` and `prisma db push --accept-data-loss` succeed, followed by a successful Next.js build with no type/lint errors.

- [ ] **Step 3: End-to-end manual walkthrough**

Run: `npm run dev`. As admin: create a second account, set a category's default account, create a request in that category (with a backdated event date), advance it through `docs_submitted` → `verified` → open the disburse modal and confirm the account is prefilled → disburse with a proof link → confirm the Accounts page's "Total spent"/"Total remaining" stats update and the request detail shows the account + proof link.

- [ ] **Step 4: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore: fix issues found during multi-account disbursement regression pass"
```
