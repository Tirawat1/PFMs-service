# Payment Routing (Paid Via + Category Approver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record *who* is expected to process each reimbursement (Faculty Finance Officer, Faculty Purchasing Officer, or PSAT), let each expense category default that choice, and let a category be assigned to a specific approver track so its verification step is routed to the right role — instead of the current all-or-nothing `verify` permission where anyone with that permission can approve anything.

**Architecture:** `Category` gains `defaultPaidVia` (a label, purely informational) and `approverRole` (`"faculty_finance" | "faculty_purchasing"` — which track owns verification for this category). `Request` gains `paidVia`, copied from the category default at creation and editable by the requester/admin. `Role` gains an optional `approverKey` (nullable — most roles have none) so a specific role can declare "I am the faculty_finance approver" or "I am the faculty_purchasing approver" independently of its `perms` array; this keeps the existing generic `verify` permission working exactly as today for every other check, and only adds a *narrower* check on top of it for the specific case of approving a projection/verifying a request tied to a routed category. `lib/payment-routing.mjs` holds the pure routing decision, tested without touching Prisma.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- This plan does NOT replace or narrow the existing `verify` permission check anywhere it is used today (e.g. `flagDiscrepancy`, `resolveDiscrepancy` still just check `can(me, "verify")` as before). It only ADDS a category-routing check on top of `verify` at the two points named in Task 3 — `approveProjection` and the `advanceRequest` transition into `verified`. A user who already has `verify` continues to pass every check that doesn't reference `approverRole`.
- `admin` always bypasses the routing check, matching the `admin`-short-circuit convention used everywhere else in this codebase (see `lib/auth.js`'s `can()`).
- Same fake-data unit-testing convention as the rest of the codebase — the routing decision must be a pure function testable with plain objects.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — `Category.defaultPaidVia`/`approverRole`, `Request.paidVia`, `Role.approverKey`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Category.defaultPaidVia String @default("finance")`, `Category.approverRole String @default("faculty_finance")`, `Request.paidVia String @default("finance")`, `Role.approverKey String?` — consumed by Task 2 and Task 3.

- [ ] **Step 1: Add the columns**

In `model Category { ... }`, add directly below `allowDirect Boolean @default(false) // may be reimbursed without a projected-expense advance`:

```prisma
  defaultPaidVia String @default("finance") // finance | purchasing | psat — who typically processes this category's payments
  approverRole   String @default("faculty_finance") // faculty_finance | faculty_purchasing — which approver track verifies this category
```

In `model Request { ... }`, add directly below `vendorExists Boolean?`:

```prisma
  paidVia           String   @default("finance")
```

In `model Role { ... }`, add directly below `canSeeAdvances Boolean @default(false)`:

```prisma
  approverKey String? // faculty_finance | faculty_purchasing | null — which category approver track this role represents, if any
```

- [ ] **Step 2: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push` (or `npx prisma validate` if no DB is reachable).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add paidVia and category approver-routing columns"
```

---

### Task 2: Pure routing decision — `canApproveCategory`

**Files:**
- Create: `lib/payment-routing.mjs`
- Test: `tests/payment-routing.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `canApproveCategory({ admin, hasVerifyPerm, roleApproverKey, categoryApproverRole }) => boolean` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tests/payment-routing.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { canApproveCategory } from "../lib/payment-routing.mjs";

test("admin can approve any category regardless of routing", () => {
  assert.equal(canApproveCategory({ admin: true, hasVerifyPerm: false, roleApproverKey: null, categoryApproverRole: "faculty_purchasing" }), true);
});

test("a role with the matching approverKey and verify permission can approve", () => {
  assert.equal(canApproveCategory({ admin: false, hasVerifyPerm: true, roleApproverKey: "faculty_finance", categoryApproverRole: "faculty_finance" }), true);
});

test("a role with verify permission but the wrong approverKey is rejected", () => {
  assert.equal(canApproveCategory({ admin: false, hasVerifyPerm: true, roleApproverKey: "faculty_purchasing", categoryApproverRole: "faculty_finance" }), false);
});

test("a role with no approverKey at all falls back to the plain verify permission (unrouted categories stay open to any verifier)", () => {
  assert.equal(canApproveCategory({ admin: false, hasVerifyPerm: true, roleApproverKey: null, categoryApproverRole: "faculty_finance" }), true);
});

test("a role without verify permission is always rejected, routed or not", () => {
  assert.equal(canApproveCategory({ admin: false, hasVerifyPerm: false, roleApproverKey: "faculty_finance", categoryApproverRole: "faculty_finance" }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/payment-routing.test.mjs` — expected FAIL, `lib/payment-routing.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/payment-routing.mjs`:

```js
// Whether a user may approve/verify a request or projection tied to a given category.
// admin always passes. Otherwise, the base requirement is the existing "verify"
// permission (unchanged everywhere else in the app) — this only adds a NARROWER check
// on top: if the acting role has declared an approverKey, it must match the category's
// approverRole. Roles with no approverKey (the common case — most roles don't represent
// a specific approver track) are unaffected and fall back to the plain verify check, so
// this never locks an unrouted category away from its existing verifiers.
export function canApproveCategory({ admin, hasVerifyPerm, roleApproverKey, categoryApproverRole }) {
  if (admin) return true;
  if (!hasVerifyPerm) return false;
  if (!roleApproverKey) return true;
  return roleApproverKey === categoryApproverRole;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/payment-routing.test.mjs` — expected PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/payment-routing.mjs tests/payment-routing.test.mjs
git commit -m "feat: add canApproveCategory routing decision"
```

---

### Task 3: Wire routing into `approveProjection` and the `verified` transition; `paidVia` into `createRequest`/`editRequest`

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `canApproveCategory` from Task 2; `Category.approverRole`/`Role.approverKey`/`Request.paidVia` from Task 1.
- Produces: extends `"createRequest"`, `"approveProjection"`, `"advanceRequest"`; adds `"updateCategoryPaymentRouting"` (admin), `"updateRoleApproverKey"` (admin).

- [ ] **Step 1: Import the new function**

Add, alongside the other `lib/*` imports:

```js
import { canApproveCategory } from "@/lib/payment-routing.mjs";
```

- [ ] **Step 2: Stamp `paidVia` in `createRequest`**

In `case "createRequest": { ... }`, destructure `paidVia` from `body` (add it to the existing destructuring line), and add `paidVia: paidVia || cat.defaultPaidVia,` to the `data` object passed to `prisma.request.create`.

- [ ] **Step 3: Route `approveProjection` through `canApproveCategory`**

In `case "approveProjection": { ... }`, change:

```js
        if (!can(me, "verify") && !admin) return err("Forbidden", 403);
```

to:

```js
        const projCat = await prisma.category.findUnique({ where: { id: proj.categoryId } });
        if (!canApproveCategory({ admin, hasVerifyPerm: can(me, "verify"), roleApproverKey: me.role.approverKey, categoryApproverRole: projCat?.approverRole })) {
          return err("This expense category is routed to another approver.");
        }
```

(Note: `proj` is looked up earlier in this case — reuse it; move this check to directly after the existing `if (!proj) return err("Not found", 404);` line, before the `proj.status !== "submitted"` check, since it needs `proj.categoryId` and doesn't depend on status.)

- [ ] **Step 4: Route the `advanceRequest` transition into `verified`**

In `case "advanceRequest": { ... }`, directly after the existing `if (!admin && !can(me, ADV_PERM[next])) return err("Forbidden", 403);` line, add:

```js
        if (next === "verified") {
          const rCat = await prisma.category.findUnique({ where: { id: r.categoryId } });
          if (!canApproveCategory({ admin, hasVerifyPerm: can(me, "verify"), roleApproverKey: me.role.approverKey, categoryApproverRole: rCat?.approverRole })) {
            return err("This expense category is routed to another approver.");
          }
        }
```

- [ ] **Step 5: Add admin-only routing-management actions**

Directly after the existing `case "updateCategoryAccount": { ... }` block, add:

```js
      case "updateCategoryPaymentRouting": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        await prisma.category.update({
          where: { id: c.id },
          data: { defaultPaidVia: body.defaultPaidVia || "finance", approverRole: body.approverRole || "faculty_finance" },
        });
        await audit(me, "Updated payment routing for category " + c.name);
        return NextResponse.json({ ok: true });
      }
```

Directly after the existing `case "createRole": { ... }` block, add:

```js
      case "updateRoleApproverKey": {
        if (!admin) return err("Forbidden", 403);
        const role = await prisma.role.findUnique({ where: { id: body.id } });
        if (!role) return err("Not found", 404);
        const key = body.approverKey || null;
        if (key && !["faculty_finance", "faculty_purchasing"].includes(key)) return err("Unknown approver key.");
        await prisma.role.update({ where: { id: role.id }, data: { approverKey: key } });
        await audit(me, "Set approver key for role " + role.name + " to " + (key || "none"));
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 6: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. Set a category's `approverRole` to `faculty_purchasing`. Set one role's `approverKey` to `faculty_finance` and another's to `faculty_purchasing`. As a user in the `faculty_finance`-keyed role, attempt to advance a request in that category into `verified` — confirm it's rejected with "This expense category is routed to another approver." As a user in the `faculty_purchasing`-keyed role (with `verify` permission), confirm the same action succeeds. Confirm a role with no `approverKey` set (but with `verify`) can still approve either category, unaffected.

- [ ] **Step 7: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: wire paidVia and category approver routing into RPC actions"
```

---

### Task 4: UI — "Paid via" field, category routing controls, role approver-key control

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: RPC actions from Task 3; `Request.paidVia`, `Category.defaultPaidVia`/`approverRole`, `Role.approverKey`.
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Add "Paid via" to the new-request form and request detail**

On the `newRequest` modal body, add a `select` bound to `form.paidVia` with options `finance` ("Faculty Finance Officer"), `purchasing` ("Faculty Purchasing Officer"), `psat` ("PSAT"), defaulting to the selected category's `defaultPaidVia` (set this default in the same place `form.categoryId`'s onChange already sets other category-derived defaults, or on modal open). Include `paidVia: form.paidVia` in the `createRequest` payload built by `Modal`'s `submit()`.

On `Detail`, show "Paid via" as a read-only field in the Details panel (map `paidVia` to the same three labels).

- [ ] **Step 2: Add routing controls to `CatEdit`**

Add two `select` controls: "Default paid via" (finance/purchasing/psat) and "Approver track" (Faculty Finance / Faculty Purchasing), both calling `updateCategoryPaymentRouting` with `{ id: c.id, defaultPaidVia, approverRole }` on change.

- [ ] **Step 3: Add an approver-key control to the Users & Roles role cards**

On each role card in `Users`, add a small `select` (admin-only, else read-only text) bound to `role.approverKey` with options "None", "Faculty Finance approver", "Faculty Purchasing approver", calling `updateRoleApproverKey` with `{ id: r.id, approverKey }` on change.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`. Set a category's approver track to Faculty Purchasing, set a role's approver key to match, log in as that role, and confirm the "Verify" action on a request in that category succeeds while it's rejected for a role with the other approver key (but otherwise identical permissions).

- [ ] **Step 5: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add paid-via and category approver-routing UI"
```

---

## Self-Review Notes

- **Spec coverage:** `paidVia` recorded per request with a category default (Task 1/3/4), category-to-approver routing narrowing (not replacing) the existing `verify` gate (Task 2/3/4), admin controls for both category routing and role approver keys (Task 3/4) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Backward compatibility:** explicitly verified by Task 2's test 4 — a role with no `approverKey` behaves exactly as it does today. This is the key safety property of the whole plan and is called out in both the Architecture section and the pure function's own comment.
- **Explicit non-goal:** this plan does not add a third approver track for PSAT-routed categories (the mockup's `paidVia` includes `psat` as a payment-processor label, but no `approverRole` value routes to it) — extending routing to a third track is a natural follow-up but out of scope here to keep the diff reviewable.
