# Document Phasing (Pre/Post) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split each category's document checklist into two phases — "pre-reimbursement" documents (needed before disbursement, e.g. quotations, approvals) and "closing" documents (needed after the money moves, e.g. receipts, transfer evidence) — with different lock rules for each phase, plus an optional example/sample file per document so requesters know what a valid submission looks like.

**Architecture:** `Category.docs` (a flat `Json` array of document names) is replaced by `Category.docsPre` and `Category.docsPost` (same `Json` array-of-names shape, just two arrays instead of one), plus `Category.docExamples` (a `Json` map of `{ [docName]: { link, name } }`) and `Category.requireCompletionDocs` (whether closing docs are mandatory at all for this category). `Request.docs` items gain a `phase: "pre" | "post"` field alongside the existing `{ name, submitted, link, fileName, disc }` shape — fully additive, so `attachDoc`/`detachDoc`/`flagDiscrepancy` need zero changes. A pure `lib/doc-phase.mjs` function decides whether a given doc is editable given its phase and the request's current status, matching the two lock rules from the source design ("pre-reimbursement documents are locked after verification" / "closing documents open once funds are disbursed").

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- This is a rename-and-split of an existing column (`Category.docs` → `docsPre` + `docsPost`), not an additive change — every place that reads `category.docs` or builds `request.docs` from it must be updated together in Task 1/2, or the app will throw at runtime. Grep for `\.docs\b` across `app/api/rpc/route.js` and `components/App.jsx` before starting and update every call site found, not just the ones listed below (the ones listed are the ones confirmed present at plan-authoring time).
- `Request.docs` entries keep the exact existing shape (`{ name, submitted, link, fileName, disc }`) plus one additive `phase` field — `attachDoc`, `detachDoc`, `flagDiscrepancy`, `resolveDiscrepancy`, `markFixed` in `app/api/rpc/route.js` must NOT need to change, since they only index into the array and mutate fields that already exist.
- Same fake-data unit-testing convention as the rest of the codebase — `lib/doc-phase.mjs` must be pure and testable with plain objects, no Prisma mock needed.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — split `docs` into `docsPre`/`docsPost`, add examples + completion flag

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Category.docsPre Json`, `Category.docsPost Json`, `Category.docExamples Json`, `Category.requireCompletionDocs Boolean` — consumed by Task 2 and Task 3. Removes `Category.docs`.

- [ ] **Step 1: Replace `docs` in `model Category { ... }`**

Change:

```prisma
  docs          Json // array of document names
```

to:

```prisma
  docsPre               Json    @default("[]") // document names required before disbursement
  docsPost              Json    @default("[]") // document names required to close the request, after disbursement
  docExamples           Json    @default("{}") // { [docName]: { link, name } } — an example file shown beside that checklist item
  requireCompletionDocs Boolean @default(true) // whether docsPost must be submitted before the request can reach "closed"
```

- [ ] **Step 2: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push` (or `npx prisma validate` if no DB is reachable). Note this drops the old `docs` column's data on a real database — acceptable in dev, but flag it to your human partner before running against anything with real data.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: split Category.docs into docsPre/docsPost with examples"
```

---

### Task 2: Pure lock-rule function — `isDocEditable`

**Files:**
- Create: `lib/doc-phase.mjs`
- Test: `tests/doc-phase.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `isDocEditable({ phase, status }) => boolean` — consumed by Task 3's `attachDoc`/`detachDoc` enforcement and Task 4's UI.

- [ ] **Step 1: Write the failing tests**

Create `tests/doc-phase.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocEditable } from "../lib/doc-phase.mjs";

test("a pre-reimbursement doc is editable before verification", () => {
  assert.equal(isDocEditable({ phase: "pre", status: "notified" }), true);
  assert.equal(isDocEditable({ phase: "pre", status: "docs_submitted" }), true);
});

test("a pre-reimbursement doc is locked once verified or later", () => {
  assert.equal(isDocEditable({ phase: "pre", status: "verified" }), false);
  assert.equal(isDocEditable({ phase: "pre", status: "disbursed" }), false);
  assert.equal(isDocEditable({ phase: "pre", status: "closed" }), false);
});

test("a closing document is locked before disbursement", () => {
  assert.equal(isDocEditable({ phase: "post", status: "notified" }), false);
  assert.equal(isDocEditable({ phase: "post", status: "verified" }), false);
});

test("a closing document opens once funds are disbursed", () => {
  assert.equal(isDocEditable({ phase: "post", status: "disbursed" }), true);
  assert.equal(isDocEditable({ phase: "post", status: "purchase_complete" }), true);
});

test("a closing document is locked again once the request is closed", () => {
  assert.equal(isDocEditable({ phase: "post", status: "closed" }), false);
});

test("a doc with no phase recorded (legacy) behaves like a pre-reimbursement doc", () => {
  assert.equal(isDocEditable({ phase: undefined, status: "notified" }), true);
  assert.equal(isDocEditable({ phase: undefined, status: "verified" }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/doc-phase.test.mjs` — expected FAIL, `lib/doc-phase.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/doc-phase.mjs`:

```js
// Whether a single document on a request's checklist can currently be attached/detached.
// Pre-reimbursement docs lock once the request moves past docs_submitted (an officer has
// started verifying — the paper trail up to that point must not change under them).
// Closing docs are the opposite: irrelevant (and locked) until funds are disbursed, then
// open through purchase_complete, then lock again once the request is fully closed.
const PRE_EDITABLE = new Set(["notified", "docs_submitted"]);
const POST_EDITABLE = new Set(["disbursed", "purchase_complete"]);

export function isDocEditable({ phase, status }) {
  if (phase === "post") return POST_EDITABLE.has(status);
  return PRE_EDITABLE.has(status);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/doc-phase.test.mjs` — expected PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/doc-phase.mjs tests/doc-phase.test.mjs
git commit -m "feat: add isDocEditable phase/status lock rule"
```

---

### Task 3: Wire phasing into `createRequest`, `createCategory`, doc mutations, and category doc-management actions

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `isDocEditable` from Task 2; `Category.docsPre`/`docsPost`/`docExamples`/`requireCompletionDocs` from Task 1.
- Produces: extends `"createRequest"`, `"createCategory"`, `"attachDoc"`/`"detachDoc"`; adds RPC actions `"toggleCatDocPhase"` (replaces the phase-blind `toggleCatDoc`), `"addCatDoc"` (phase-aware), `"setCatDocExample"`, `"clearCatDocExample"`.

- [ ] **Step 1: Import the new function**

Add, alongside the other `lib/*` imports:

```js
import { isDocEditable } from "@/lib/doc-phase.mjs";
```

- [ ] **Step 2: Build `request.docs` from both phases in `createRequest`**

In the `case "createRequest": { ... }` block, change the `docs:` line inside `prisma.request.create`'s `data` from:

```js
            docs: cat.docs.map((name) => ({ name, submitted: false, link: null, fileName: null, disc: null })),
```

to:

```js
            docs: [
              ...cat.docsPre.map((name) => ({ name, phase: "pre", submitted: false, link: null, fileName: null, disc: null })),
              ...cat.docsPost.map((name) => ({ name, phase: "post", submitted: false, link: null, fileName: null, disc: null })),
            ],
```

- [ ] **Step 3: Enforce the lock rule in `attachDoc`/`detachDoc`**

In the combined `case "attachDoc": case "detachDoc": { ... }` block, directly after the existing `if (!doc) return err("Unknown document.");` line, add:

```js
        if (!isDocEditable({ phase: doc.phase, status: r.status })) {
          return err((doc.phase === "post" ? "Closing documents open once funds are disbursed." : "Pre-reimbursement documents are locked after verification."));
        }
```

- [ ] **Step 4: Update `createCategory` to seed empty phased arrays**

In `case "createCategory": { ... }`, change the `data:` object passed to `prisma.category.create` from `docs: []` to:

```js
          data: { name: body.name, nameTh: body.nameTh || body.name, notes: body.notes || "", docsPre: [], docsPost: [], docExamples: {}, defaultAcctId: body.defaultAcctId || null },
```

- [ ] **Step 5: Replace `toggleCatDoc`/`addCatDoc` with phase-aware versions**

Replace the existing `case "toggleCatDoc": { ... }` and `case "addCatDoc": { ... }` blocks with:

```js
      case "toggleCatDoc": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        const field = body.phase === "post" ? "docsPost" : "docsPre";
        const list = c[field];
        const docs = list.includes(body.name) ? list.filter((d) => d !== body.name) : [...list, body.name];
        await prisma.category.update({ where: { id: c.id }, data: { [field]: docs } });
        return NextResponse.json({ ok: true });
      }
      case "addCatDoc": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        const name = (body.name || "").trim();
        if (!name) return err("Empty document name.");
        const field = body.phase === "post" ? "docsPost" : "docsPre";
        if (!c[field].includes(name)) {
          await prisma.category.update({ where: { id: c.id }, data: { [field]: [...c[field], name] } });
          await audit(me, 'Added ' + (field === "docsPost" ? "closing" : "pre-reimbursement") + ' document "' + name + '" to category ' + c.name);
        }
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 6: Add `setCatDocExample`/`clearCatDocExample`**

Directly after the block from Step 5, add:

```js
      case "setCatDocExample": {
        if (!admin) return err("Forbidden", 403);
        if (!body.link) return err("Paste a Drive link for the example.");
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        const docExamples = { ...c.docExamples, [body.name]: { link: body.link.trim(), name: body.fileName || null } };
        await prisma.category.update({ where: { id: c.id }, data: { docExamples } });
        return NextResponse.json({ ok: true });
      }
      case "clearCatDocExample": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        const docExamples = { ...c.docExamples };
        delete docExamples[body.name];
        await prisma.category.update({ where: { id: c.id }, data: { docExamples } });
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 7: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. Create a category, add one pre-doc and one post-doc, set an example link on each. Submit a request for it, confirm `request.docs` has both entries with the correct `phase`. Attach the pre-doc while status is `notified` (should succeed), advance to `verified`, attempt to detach the pre-doc (should be rejected with the lock message). Advance to `disbursed`, attach the post-doc (should now succeed).

- [ ] **Step 8: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: wire document phasing and examples into RPC actions"
```

---

### Task 4: UI — category edit tabs, request detail split checklist, doc examples

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: RPC actions from Task 3; `Request.docs[].phase` (Task 3 Step 2); `isDocEditable` (Task 2, for client-side hint text only — the server is the enforcement authority).
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Split the category-edit checklist into Pre/Post tabs**

On `CatEdit`, replace the single `c.docs.map(...)` chip list with two labelled sections ("Pre-reimbursement documents" / "Closing documents"), each rendering its own `c.docsPre` / `c.docsPost` chip list. Each chip's remove icon calls `toggleCatDoc` with `{ id: c.id, name: d, phase: "pre" }` or `{ ..., phase: "post" }` respectively. The "Add from document menu" and "Add a custom document" controls need a phase selector (a small `seg` toggle: "Pre" / "Post") so `addCatDoc`/`toggleCatDoc` calls carry the right `phase`.

- [ ] **Step 2: Add example-link management per chip**

Next to each doc chip in `CatEdit`, add a small pencil icon (visible only for admin) that opens a minimal inline input for a Drive link, calling `setCatDocExample` with `{ id: c.id, name: d, phase, link }` on submit, and an "x" to call `clearCatDocExample`. Show `category.docExamples[d]` as a small "Example ↗" link when present (reuse the `.doc-view`/`.chip-ex` classes already in the stylesheet for this exact purpose).

- [ ] **Step 3: Split the request-detail checklist into Pre/Post sections**

On `Detail`, replace the single `r.docs.map(...)` loop with two sections, filtering `r.docs` by `d.phase !== "post"` and `d.phase === "post"` respectively. Each section's header shows a small lock icon and the relevant helper text ("Locked after verification" / "Available once funds are disbursed") when the current status makes that phase non-editable, purely as a UI hint — the actual gate is server-side per Task 3 Step 3. Attach/detach buttons remain conditional on `isRequester || can("create") || admin` exactly as today, plus now also hidden (not just erroring) when the phase is locked, to avoid a dead click.

- [ ] **Step 4: Show doc examples on the request-detail checklist**

Per document row on `Detail`, if `category.docExamples[d.name]` exists, render a small "Example ↗" link (reuse `.doc-view` styling) opening that link in a new tab.

- [ ] **Step 5: Manual verification in the browser**

Run: `npm run dev`. On a category with both pre- and post-docs configured with examples, confirm: the request-detail page shows two separate sections, each pre-doc's example link opens correctly, attach/detach buttons disappear once a phase is locked, and re-appear once the request reaches the phase where they unlock.

- [ ] **Step 6: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add document-phase UI (pre/post tabs, examples, lock hints)"
```

---

## Self-Review Notes

- **Spec coverage:** phased checklist (Task 1/3), phase-appropriate lock rule enforced server-side (Task 2/3), document examples (Task 3/4), category-edit and request-detail UI for both (Task 4) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Breaking-change call-out:** Task 1 replaces `Category.docs` rather than adding alongside it — flagged explicitly in Global Constraints and Task 1 Step 2 because it is destructive on a populated database, unlike every additive plan before it.
- **Explicit non-goal:** `requireCompletionDocs` is added to the schema in Task 1 but this plan does not yet enforce it anywhere (e.g. blocking `closed` status until post-docs are submitted) — that enforcement belongs with whichever plan owns the `purchase_complete → closed` transition rule change, to keep this plan's diff focused on the checklist split itself.
