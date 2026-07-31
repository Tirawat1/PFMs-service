# Vendor Registration Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a department reports that a request's supplier is *not* an already-registered vendor, automatically add a configurable set of "vendor registration" documents to that request's document checklist, so the officer verifying the request can confirm the supplier is properly onboarded before disbursement.

**Architecture:** `MasterDoc` (the existing master list of attachable document names) gains a `vendorDoc` boolean marking which master documents count as vendor-registration paperwork. `Request` gains `vendor` (free-text supplier name) and `vendorExists` (nullable boolean — `null` = not yet asked, `true`/`false` = answered) columns. A pure function merges the current vendor-flagged master docs into a request's existing `docs` JSON array without duplicating entries already present. An admin-only RPC action toggles a master doc's `vendorDoc` flag; a requester/admin RPC action answers the vendor question and, if "not a registered vendor", appends the vendor docs and re-persists `request.docs`.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- `Request.docs` is a `Json` array of `{ name, submitted, link, fileName, disc }` objects (see `prisma/schema.prisma`'s `Request.docs` comment and `app/api/rpc/route.js`'s `attachDoc`/`detachDoc` cases for the exact shape already read/written elsewhere) — new vendor docs appended here must use that identical shape so the existing attach/detach/flag-discrepancy code keeps working on them with zero changes.
- Same fake-data unit-testing convention as the rest of the codebase — the merge function must be pure and testable with plain arrays, no Prisma mock needed.
- Admin-only mutations follow the existing `if (!admin) return err("Forbidden", 403);` pattern (see `addMasterDoc`, `removeMasterDoc` in `app/api/rpc/route.js`).
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — `MasterDoc.vendorDoc`, `Request.vendor`, `Request.vendorExists`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `MasterDoc.vendorDoc Boolean @default(false)`, `Request.vendor String @default("")`, `Request.vendorExists Boolean?` — consumed by Task 2 and Task 3.

- [ ] **Step 1: Add the columns**

In `prisma/schema.prisma`, in `model MasterDoc { ... }`, add:

```prisma
  vendorDoc Boolean @default(false)
```

so the full model reads:

```prisma
model MasterDoc {
  id        String  @id @default(cuid())
  name      String  @unique
  vendorDoc Boolean @default(false)
}
```

In `model Request { ... }`, add directly below `disburseProofLink String   @default("")`:

```prisma
  vendor            String   @default("")
  vendorExists      Boolean?
```

- [ ] **Step 2: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push`
Expected: no errors. If no local database is reachable, run `npx prisma validate` instead.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add MasterDoc.vendorDoc and Request vendor fields"
```

---

### Task 2: Pure merge function — `addVendorDocs`

**Files:**
- Create: `lib/vendor-docs.mjs`
- Test: `tests/vendor-docs.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `addVendorDocs(existingDocs, vendorDocNames) => newDocs[]` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tests/vendor-docs.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { addVendorDocs } from "../lib/vendor-docs.mjs";

test("appends vendor docs not already present, in fresh unsubmitted shape", () => {
  const existing = [{ name: "ใบเสร็จรับเงิน", submitted: true, link: "https://x", fileName: "a.pdf", disc: null }];
  const result = addVendorDocs(existing, ["ข้อมูลผู้ขาย / Vendor details", "ใบเสนอราคา"]);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], existing[0]);
  assert.deepEqual(result[1], { name: "ข้อมูลผู้ขาย / Vendor details", submitted: false, link: null, fileName: null, disc: null, vendorDoc: true });
  assert.deepEqual(result[2], { name: "ใบเสนอราคา", submitted: false, link: null, fileName: null, disc: null, vendorDoc: true });
});

test("does not duplicate a vendor doc that already exists on the request by name", () => {
  const existing = [{ name: "ข้อมูลผู้ขาย / Vendor details", submitted: false, link: null, fileName: null, disc: null }];
  const result = addVendorDocs(existing, ["ข้อมูลผู้ขาย / Vendor details", "ใบเสนอราคา"]);
  assert.equal(result.length, 2);
  assert.equal(result.filter((d) => d.name === "ข้อมูลผู้ขาย / Vendor details").length, 1);
});

test("returns the existing array unchanged (new array, same entries) when there are no vendor docs configured", () => {
  const existing = [{ name: "ใบเสร็จรับเงิน", submitted: true, link: "https://x", fileName: "a.pdf", disc: null }];
  const result = addVendorDocs(existing, []);
  assert.deepEqual(result, existing);
  assert.notEqual(result, existing, "must return a new array, not mutate the input");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/vendor-docs.test.mjs`
Expected: FAIL — `lib/vendor-docs.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/vendor-docs.mjs`:

```js
// Appends the currently-configured vendor-registration documents to a request's
// existing docs array, skipping any name already present so re-answering the vendor
// question never duplicates checklist entries. Pure — returns a new array, never
// mutates `existingDocs`.
export function addVendorDocs(existingDocs, vendorDocNames) {
  const present = new Set(existingDocs.map((d) => d.name));
  const additions = vendorDocNames
    .filter((name) => !present.has(name))
    .map((name) => ({ name, submitted: false, link: null, fileName: null, disc: null, vendorDoc: true }));
  return [...existingDocs, ...additions];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/vendor-docs.test.mjs`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/vendor-docs.mjs tests/vendor-docs.test.mjs
git commit -m "feat: add addVendorDocs merge helper"
```

---

### Task 3: RPC actions — `toggleMasterDocVendor`, `reportVendor`

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `addVendorDocs` from Task 2; `canManageRequestDocs` (already imported from `@/lib/permissions.mjs`) for the requester-or-admin check.
- Produces: RPC actions `"toggleMasterDocVendor"` and `"reportVendor"`.

- [ ] **Step 1: Import the new function**

Change:

```js
import { advanceRequestTx, resolveDisburseAccount } from "@/lib/requests.mjs";
```

to (adding this line without disturbing any other import lines already added by other plans):

```js
import { advanceRequestTx, resolveDisburseAccount } from "@/lib/requests.mjs";
import { addVendorDocs } from "@/lib/vendor-docs.mjs";
```

- [ ] **Step 2: Add `toggleMasterDocVendor`**

Directly after the existing `case "removeMasterDoc": { ... }` block, add:

```js
      case "toggleMasterDocVendor": {
        if (!admin) return err("Forbidden", 403);
        const doc = await prisma.masterDoc.findUnique({ where: { id: body.id } });
        if (!doc) return err("Not found", 404);
        await prisma.masterDoc.update({ where: { id: doc.id }, data: { vendorDoc: !doc.vendorDoc } });
        await audit(me, (doc.vendorDoc ? "Removed" : "Added") + ' vendor-registration document "' + doc.name + '"');
        return NextResponse.json({ ok: true, vendorDoc: !doc.vendorDoc });
      }
```

- [ ] **Step 3: Add `reportVendor`**

Directly after the `case "resolveDiscrepancy": { ... }` block (in the documents section, alongside `attachDoc`/`flagDiscrepancy`/`markFixed`), add:

```js
      // Requester (or admin) answers whether the supplier is an already-registered vendor
      case "reportVendor": {
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        if (!canManageRequestDocs(me, r, admin)) return err("Forbidden", 403);
        const exists = body.exists === true;
        let docs = r.docs;
        if (!exists) {
          const vendorDocs = await prisma.masterDoc.findMany({ where: { vendorDoc: true } });
          docs = addVendorDocs(r.docs, vendorDocs.map((d) => d.name));
        }
        await prisma.request.update({ where: { id: r.id }, data: { vendorExists: exists, docs } });
        await audit(me, exists ? "Confirmed existing vendor for " + r.id : "Reported new vendor for " + r.id + " — added vendor-registration documents");
        if (!exists) {
          await notifyPerm("verify", r.id + " — supplier is not a registered vendor; vendor-registration documents added to the checklist.", "notified", me.id);
        }
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 4: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. As admin, mark two master documents as vendor docs via `toggleMasterDocVendor`. As the requester of an open request, call `reportVendor` with `exists: false` — confirm the request's `docs` array grows by exactly those two entries (check via `npx prisma studio`), and calling it again does not duplicate them. Call it with `exists: true` on a different request — confirm `docs` is unchanged and `vendorExists` is `true`.
Expected: no duplicate doc names ever appear in `docs`; `vendorExists` reflects the last answer.

- [ ] **Step 5: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: add vendor-registration document RPC actions"
```

---

### Task 4: UI — vendor question on request detail + vendor-doc toggles on Document Menu

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `reportVendor`, `toggleMasterDocVendor` RPC actions (Task 3).
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Locate the existing Document Menu page and doc-checklist rendering**

Run: `grep -n "masterDoc\|Document Menu\|docs.map" components/App.jsx` to find (a) the page listing all master documents (where `addMasterDoc`/`removeMasterDoc` are already wired) and (b) the request-detail component that renders `request.docs` as a checklist (where `attachDoc`/`detachDoc`/`flagDiscrepancy` are already wired). Match both existing patterns exactly rather than introducing new list/toggle components.

- [ ] **Step 2: Add a vendor-doc toggle per row on the Document Menu page**

Next to each master document row, add a toggle/checkbox labeled "Vendor doc" that calls `toggleMasterDocVendor` with that document's `id` and reflects its current `vendorDoc` value.

- [ ] **Step 3: Add the vendor question to the request-detail page**

On the request-detail component (found in Step 1), when `request.vendorExists` is `null` and the current user can manage the request's docs (requester or admin — reuse whatever client-side check already gates document attach/detach), render:
- A text input bound to `request.vendor` for the supplier name (persisted via whatever existing "edit request field" mechanism the app already uses, or a new minimal input that calls a `reportVendor`-adjacent update if none exists — prefer reusing the existing request-edit RPC path if `vendor` was already added to it by another plan's UI work).
- Two buttons: "Yes, existing vendor" and "No — register new vendor", each calling `reportVendor` with `{ id: request.id, exists: true }` / `{ id: request.id, exists: false }`.

When `request.vendorExists` is not `null`, render a small status line instead ("Existing registered vendor" or "New vendor — registration documents added to the checklist"), and stop rendering the question.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`. Mark a master doc as a vendor doc from the Document Menu. Open a request detail page as its requester, answer "No — register new vendor", confirm the vendor-registration document appears in the checklist immediately and can be attached like any other document (reusing the existing attach flow — no special-casing needed since it uses the identical `docs` shape).
Expected: no console errors; the new checklist entry behaves identically to a normal required document.

- [ ] **Step 5: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add vendor question UI and vendor-doc toggles"
```

---

## Self-Review Notes

- **Spec coverage:** admin-configurable vendor-doc set (Task 1/3/4 Document Menu), automatic checklist augmentation on "not a registered vendor" (Task 2/3), no duplicate entries on repeated answers (Task 2 test 2), requester-facing question UI (Task 4) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Type/name consistency:** the `{ name, submitted, link, fileName, disc }` doc shape in `addVendorDocs` (Task 2) matches exactly what `attachDoc`/`detachDoc`/`flagDiscrepancy` already read and write in `app/api/rpc/route.js` (confirmed by reading those cases in Task 3's context) — the added `vendorDoc: true` field is additive and ignored by that existing code, so nothing breaks.
- **Explicit non-goal:** this plan does not make `vendor` a required field or block disbursement pending a vendor answer — that policy question (should unanswered-vendor requests be blocked at verification?) is left to a product decision, not assumed here.
