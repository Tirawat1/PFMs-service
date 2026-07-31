# Direct Claim Reimbursements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator mark specific expense categories as "direct claim allowed" so departments can submit a reimbursement for those categories without first going through the Projected Expenses / Advance approval flow (from `docs/superpowers/plans/2026-07-31-advance-payments.md`). Requests submitted this way are tagged `directClaim` and shown with a "Direct claim" badge, matching the read-only signal already designed in that earlier plan's UI mockup but never enforced server-side.

**Architecture:** Adds one boolean column to `Category` (`allowDirect`) and one to `Request` (`directClaim`). A pure validation function decides, given a category and an optional `projectionId`, whether a request submission is allowed and what `directClaim` value to stamp — unit tested without touching Prisma. `createRequest` in the RPC route enforces that decision. A new admin-only RPC action toggles the category flag. The category-edit and request-detail UI surfaces the toggle and the badge respectively.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- This plan assumes `docs/superpowers/plans/2026-07-31-advance-payments.md` has already shipped (it adds `Request.projectionId` and the `Projection` model that this plan's validation logic reads). If that plan has not been applied yet, apply Task 1 of it first.
- Same fake-Prisma testing convention as the rest of the codebase (see `tests/requests.test.mjs`) — no test may require a live database.
- Admin-only mutations follow the existing `if (!admin) return err("Forbidden", 403);` pattern already used by every other category-editing RPC action (`updateCategoryNotes`, `updateCategoryAccount`, `closeCategory`).
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — `Category.allowDirect` + `Request.directClaim`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Category.allowDirect Boolean @default(false)`, `Request.directClaim Boolean @default(false)` — consumed by Task 2 and Task 3.

- [ ] **Step 1: Add the columns**

In `prisma/schema.prisma`, in `model Category { ... }`, add directly below `active Boolean @default(true) // soft-close, never hard-delete — existing requests still reference categoryId`:

```prisma
  allowDirect   Boolean @default(false) // may be reimbursed without a projected-expense advance
```

In `model Request { ... }`, add directly below `projectionId      String?` (added by the Advance Payments plan; if that plan has not shipped yet, add this line directly below `acctId String?` instead):

```prisma
  directClaim       Boolean  @default(false)
```

- [ ] **Step 2: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push`
Expected: no errors. If no local database is reachable, run `npx prisma validate` instead to confirm the schema file alone is well-formed.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add Category.allowDirect and Request.directClaim columns"
```

---

### Task 2: Pure validation — `resolveRequestSource`

**Files:**
- Create: `lib/direct-claim.mjs`
- Test: `tests/direct-claim.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveRequestSource({ projectionId, projectionStatus, categoryAllowDirect }) => { error: string } | { directClaim: boolean }` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tests/direct-claim.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRequestSource } from "../lib/direct-claim.mjs";

test("a projection id with status 'advanced' is accepted as a non-direct claim", () => {
  const result = resolveRequestSource({ projectionId: "PJ-2000", projectionStatus: "advanced", categoryAllowDirect: false });
  assert.deepEqual(result, { directClaim: false });
});

test("a projection id with any other status is rejected", () => {
  const result = resolveRequestSource({ projectionId: "PJ-2000", projectionStatus: "submitted", categoryAllowDirect: false });
  assert.equal(result.error, "This projection has no available advance.");
});

test("no projection id is accepted as a direct claim when the category allows it", () => {
  const result = resolveRequestSource({ projectionId: null, projectionStatus: null, categoryAllowDirect: true });
  assert.deepEqual(result, { directClaim: true });
});

test("no projection id is rejected when the category does not allow direct claims", () => {
  const result = resolveRequestSource({ projectionId: null, projectionStatus: null, categoryAllowDirect: false });
  assert.equal(result.error, "This category requires a projected expense with an issued advance, or must be marked to allow direct reimbursement.");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/direct-claim.test.mjs`
Expected: FAIL — `lib/direct-claim.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/direct-claim.mjs`:

```js
// Decides whether a reimbursement request may be submitted, and whether it should be
// tagged as a direct claim. Pure — no I/O — the RPC route does the Projection lookup
// and category read, this just applies the rule.
export function resolveRequestSource({ projectionId, projectionStatus, categoryAllowDirect }) {
  if (projectionId) {
    if (projectionStatus !== "advanced") return { error: "This projection has no available advance." };
    return { directClaim: false };
  }
  if (!categoryAllowDirect) {
    return { error: "This category requires a projected expense with an issued advance, or must be marked to allow direct reimbursement." };
  }
  return { directClaim: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/direct-claim.test.mjs`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/direct-claim.mjs tests/direct-claim.test.mjs
git commit -m "feat: add resolveRequestSource for direct-claim validation"
```

---

### Task 3: Wire enforcement into `createRequest` + admin toggle RPC action

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `resolveRequestSource` from Task 2; `Category.allowDirect` / `Request.directClaim` from Task 1.
- Produces: RPC action `"toggleCategoryDirect"`; extends `"createRequest"`.

- [ ] **Step 1: Import the new function**

Change:

```js
import { advanceRequestTx, resolveDisburseAccount } from "@/lib/requests.mjs";
```

to:

```js
import { advanceRequestTx, resolveDisburseAccount } from "@/lib/requests.mjs";
import { resolveRequestSource } from "@/lib/direct-claim.mjs";
```

(If the Advance Payments plan already added an `approveProjectionTx`/`settleProjectionTx` import line above or below this one, keep both import lines — do not remove the other.)

- [ ] **Step 2: Enforce the rule in `createRequest`**

Starting from the version of `createRequest` produced by `docs/superpowers/plans/2026-07-31-advance-payments.md` Task 4 Step 3 (which already destructures `projectionId` from `body` and looks up `proj`), change:

```js
        let proj = null;
        if (projectionId) {
          proj = await prisma.projection.findUnique({ where: { id: projectionId } });
          if (!proj || proj.status !== "advanced") return err("This projection has no available advance.");
        }
```

to:

```js
        let proj = null;
        if (projectionId) proj = await prisma.projection.findUnique({ where: { id: projectionId } });
        const source = resolveRequestSource({
          projectionId, projectionStatus: proj?.status || null, categoryAllowDirect: cat.allowDirect,
        });
        if (source.error) return err(source.error);
```

Then in the `data` object passed to `prisma.request.create`, add `directClaim: source.directClaim,` alongside the existing `projectionId: projectionId || null,` line.

(If the Advance Payments plan has not shipped, apply this against the original `createRequest` block shown in `app/api/rpc/route.js:50-74` instead — destructure `projectionId` from `body`, look up `proj` only if `projectionId` is present, and add the same `resolveRequestSource` call and `directClaim` field.)

- [ ] **Step 3: Add the admin toggle action**

Directly after the existing `case "updateCategoryAccount": { ... }` block, add:

```js
      case "toggleCategoryDirect": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        await prisma.category.update({ where: { id: c.id }, data: { allowDirect: !c.allowDirect } });
        await audit(me, (c.allowDirect ? "Disabled" : "Enabled") + " direct reimbursement for category " + c.name);
        return NextResponse.json({ ok: true, allowDirect: !c.allowDirect });
      }
```

- [ ] **Step 4: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. As admin, toggle "allow direct" off (default) for a category, attempt to submit a reimbursement for it with no `projectionId` via the API — confirm it's rejected with the exact message from Task 2. Toggle it on, retry — confirm the request is created with `directClaim: true`.
Expected: rejection message matches; created request's `directClaim` column is `true` only in the second case (check via `npx prisma studio`).

- [ ] **Step 5: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: enforce direct-claim rule and add category toggle action"
```

---

### Task 4: UI — category toggle + request detail badge

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `toggleCategoryDirect` RPC action, `Request.directClaim` (Task 3).
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Locate the category-edit page's existing toggle pattern**

Run: `grep -n "updateCategoryAccount\|defaultAcctId" components/App.jsx` to find how the existing "default source account" control on the category-edit page calls its RPC action, and match that exact pattern (button/select markup, loading/error handling) for the new toggle — do not introduce a new UI pattern for what is functionally identical to an existing control.

- [ ] **Step 2: Add the "Allow direct reimbursement" toggle**

On the category-edit page component found in Step 1, add a labeled toggle control ("Allow direct reimbursement" / helper text: "Departments may submit this category without a projected expense.") that calls the `toggleCategoryDirect` RPC action with the category's `id`, and reflects `category.allowDirect` as its current state.

- [ ] **Step 3: Add the "Direct claim" badge on request detail**

Run: `grep -n "Migrated\|migrated" components/App.jsx` to find the existing "Migrated" tag pattern on the request-detail page (a small pill/badge shown conditionally). Add an equivalent badge shown when `request.directClaim` is `true`, labeled "Direct claim", using the same badge markup/classes as the existing "Migrated" tag for visual consistency.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`. Toggle a category to allow direct claims, submit a reimbursement for it without a projection, open its detail page, and confirm the "Direct claim" badge renders. Toggle a different category off and confirm attempting the same submission is rejected in the UI with the server's error message surfaced to the user (however the existing request-creation form already surfaces RPC errors — match that, do not add a new error-display mechanism).
Expected: badge renders correctly; rejection message is visible to the user, not just logged to console.

- [ ] **Step 5: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add direct-claim category toggle and request detail badge"
```

---

## Self-Review Notes

- **Spec coverage:** category-level opt-in (Task 1/3/4), server-side enforcement rejecting non-direct, non-projection requests (Task 2/3), UI badge to distinguish direct claims on the request detail view (Task 4) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Type/name consistency:** `resolveRequestSource`'s return shape (`{ error }` or `{ directClaim }`) is used identically in its Task 2 definition and Task 3 call site; `allowDirect` / `directClaim` field names match between schema (Task 1), RPC (Task 3), and UI (Task 4).
- **Dependency called out explicitly:** this plan builds on `Request.projectionId` from the Advance Payments plan; Task 3 Step 2 gives an explicit fallback for teams implementing this plan standalone.
