# Vendor-Required Enforcement at Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Some expense categories (hotel bookings, museum entry, catering, etc.) always involve an external supplier — for those, the vendor question from `docs/superpowers/plans/2026-07-31-vendor-registration-docs.md` should not be an optional follow-up asked later on the request-detail page; it should be mandatory *at the moment the reimbursement is submitted*, blocking submission until a vendor name is given.

**Architecture:** Adds `Category.vendorRequired` (distinct from `Category.allowDirect` — a category can require a vendor and still need a projection, or allow direct claims and still require a vendor; the two flags are independent). `createRequest` is extended: when the chosen category has `vendorRequired: true`, `body.vendor` must be a non-empty string or the submission is rejected — mirroring the source design's `if(cat.vendorRequired && !(form.vendor||'').trim())` check exactly. This does not replace the existing post-creation `reportVendor` flow from the earlier vendor-registration-docs plan — a vendor-required request is still created with `vendorExists: null` and still goes through the "is this an already-registered vendor?" question on the detail page; this plan only makes sure the vendor's *name* can never be missing for these categories in the first place.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- This plan assumes `docs/superpowers/plans/2026-07-31-vendor-registration-docs.md` has already shipped (it added `Request.vendor`/`vendorExists` and the `reportVendor` action this plan builds alongside).
- Same fake-data unit-testing convention as the rest of the codebase — the enforcement rule must be a pure function.
- Admin-only mutations follow the existing `if (!admin) return err("Forbidden", 403);` pattern.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — `Category.vendorRequired`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Category.vendorRequired Boolean @default(false)` — consumed by Task 2 and Task 3.

- [ ] **Step 1: Add the column**

In `model Category { ... }`, add directly below `allowDirect Boolean @default(false) // may be reimbursed without a projected-expense advance`:

```prisma
  vendorRequired Boolean @default(false) // this category always involves an external supplier — vendor name is mandatory at submission
```

- [ ] **Step 2: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push` (or `npx prisma validate` if no DB is reachable).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add Category.vendorRequired"
```

---

### Task 2: Pure validation — `validateVendorAtSubmission`

**Files:**
- Create: `lib/vendor-required.mjs`
- Test: `tests/vendor-required.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `validateVendorAtSubmission({ categoryVendorRequired, vendor }) => { error: string } | { ok: true }` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tests/vendor-required.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateVendorAtSubmission } from "../lib/vendor-required.mjs";

test("a category that does not require a vendor accepts a blank vendor", () => {
  assert.deepEqual(validateVendorAtSubmission({ categoryVendorRequired: false, vendor: "" }), { ok: true });
});

test("a category that requires a vendor rejects a blank vendor", () => {
  const result = validateVendorAtSubmission({ categoryVendorRequired: true, vendor: "" });
  assert.equal(result.error, "This category requires a vendor — enter vendor details.");
});

test("a category that requires a vendor rejects a whitespace-only vendor", () => {
  const result = validateVendorAtSubmission({ categoryVendorRequired: true, vendor: "   " });
  assert.equal(result.error, "This category requires a vendor — enter vendor details.");
});

test("a category that requires a vendor accepts a non-empty vendor", () => {
  assert.deepEqual(validateVendorAtSubmission({ categoryVendorRequired: true, vendor: "Acme Catering Co." }), { ok: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/vendor-required.test.mjs` — expected FAIL, `lib/vendor-required.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/vendor-required.mjs`:

```js
// Rejects submission when the category demands a vendor and none was given. Pure — no
// I/O — the RPC route reads Category.vendorRequired and body.vendor, this just applies
// the rule.
export function validateVendorAtSubmission({ categoryVendorRequired, vendor }) {
  if (categoryVendorRequired && !(vendor || "").trim()) {
    return { error: "This category requires a vendor — enter vendor details." };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/vendor-required.test.mjs` — expected PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/vendor-required.mjs tests/vendor-required.test.mjs
git commit -m "feat: add validateVendorAtSubmission"
```

---

### Task 3: Wire enforcement into `createRequest` + admin toggle RPC action

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `validateVendorAtSubmission` from Task 2; `Category.vendorRequired` from Task 1.
- Produces: RPC action `"toggleCategoryVendorRequired"`; extends `"createRequest"`.

- [ ] **Step 1: Import the new function**

Add, alongside the other `lib/*` imports:

```js
import { validateVendorAtSubmission } from "@/lib/vendor-required.mjs";
```

- [ ] **Step 2: Enforce the rule in `createRequest`**

In `case "createRequest": { ... }`, destructure `vendor` from `body` (add it to the existing destructuring line), and directly after the existing `if (!cat || !cat.active) return err("Unknown category.");` line, add:

```js
        const vendorCheck = validateVendorAtSubmission({ categoryVendorRequired: cat.vendorRequired, vendor });
        if (vendorCheck.error) return err(vendorCheck.error);
```

Then add `vendor: (vendor || "").trim(),` to the `data` object passed to `prisma.request.create` (this is additive alongside the `directClaim`/`projectionId`/`paidVia` fields other plans already added there — do not remove those).

- [ ] **Step 3: Add the admin toggle action**

Directly after the existing `case "toggleCategoryDirect": { ... }` block (from the Direct Claim plan), add:

```js
      case "toggleCategoryVendorRequired": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        await prisma.category.update({ where: { id: c.id }, data: { vendorRequired: !c.vendorRequired } });
        await audit(me, (c.vendorRequired ? "Disabled" : "Enabled") + " vendor requirement for category " + c.name);
        return NextResponse.json({ ok: true, vendorRequired: !c.vendorRequired });
      }
```

- [ ] **Step 4: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. Toggle `vendorRequired` on for a category, attempt `createRequest` with no `vendor` — confirm rejection with the exact message from Task 2. Retry with a non-empty `vendor` — confirm the request is created with `vendor` set and `vendorExists: null` still (so the existing `reportVendor` question still appears on the detail page).

- [ ] **Step 5: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: enforce vendor-required rule at request submission"
```

---

### Task 4: UI — mandatory vendor field on new-request form + category toggle

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `toggleCategoryVendorRequired` RPC action (Task 3); `Category.vendorRequired`.
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Show the vendor field on the new-request form when the selected category requires it**

On the `newRequest` modal body in `Modal`, add (directly after the category `select`, using the already-computed `selCat` variable):

```jsx
{selCat && selCat.vendorRequired && (
  <div className="field"><label className="label">Vendor / supplier name (required for this category)</label><input className="input" value={form.vendor || ""} onChange={set("vendor")} placeholder="e.g. Acme Catering Co." /></div>
)}
```

Include `vendor: form.vendor` in the `createRequest` payload built by `submit()` (it already forwards the whole `form` object for `newRequest`, so no change is needed there beyond ensuring the input exists).

- [ ] **Step 2: Disable submit until the vendor is filled when required**

On the submit button's existing `disabled` expression in `Modal` (currently only disables for the `disburse` case), extend it to also disable when `modal.type === "newRequest" && selCat?.vendorRequired && !(form.vendor || "").trim()`.

- [ ] **Step 3: Add the toggle to `CatEdit`**

Add a labelled toggle ("Vendor required" / helper text: "This category always involves an external supplier — vendor name must be given at submission.") next to the existing "Allow direct reimbursement" toggle, calling `toggleCategoryVendorRequired` with the category's `id`, reflecting `category.vendorRequired`.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`. Toggle a category's vendor requirement on, open "New request", select that category, confirm the vendor field appears and submit is disabled until filled; confirm the server rejects the raw RPC call too if bypassed. Select a category without the requirement and confirm the field does not appear and submission is unaffected.

- [ ] **Step 5: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add mandatory vendor field UI for vendor-required categories"
```

---

## Self-Review Notes

- **Spec coverage:** category-level vendor requirement (Task 1/3/4), submission blocked without a vendor name when required (Task 2/3/4), independence from `allowDirect` (explicitly separate boolean, Architecture section) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Relationship to the existing vendor-registration-docs plan called out explicitly:** this plan does not change `reportVendor` or the post-creation vendor question at all — `vendorExists` still starts `null` even for a vendor-required request, so the two plans compose cleanly (Global Constraints, Architecture section).
- **Explicit non-goal:** this plan does not auto-attach vendor-registration documents at creation time for vendor-required categories — that still only happens when the requester answers "No — register new vendor" via `reportVendor`, unchanged from the earlier plan.
