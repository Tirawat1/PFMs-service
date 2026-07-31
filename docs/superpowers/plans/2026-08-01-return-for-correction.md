# Return for Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an officer send an entire reimbursement request back to the requester with one written reason when something is fundamentally wrong with the submission — not just one document (already covered by the existing per-document `flagDiscrepancy`), but the request as a whole (wrong category, wrong amount, wrong event date, etc.) — reverting it to the `notified` stage so the requester can revise and resubmit through the normal flow, with existing attachments left in place.

**Architecture:** `Request` gains `issueReason` (a persistent string, kept as a visible historical annotation on the request — matching the source design where the banner stays visible regardless of how far the request later progresses, since it explains *why* the workflow restarted, not just its current state). A pure `lib/return-correction.mjs` function decides which statuses a request may be returned from (`docs_submitted`, `verified` — matching the source design's `showCorrection` condition exactly: only once documents exist to review, and only up to the point of verification, not after disbursement). A new RPC action `returnForCorrection` requires the same permission as verification (`can(me, "verify")` or admin) and a reason of at least 5 characters (matching the source design's `if(reason.length<5)` check).

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- This is a *whole-request* return, distinct from and complementary to the existing per-document `flagDiscrepancy`/`resolveDiscrepancy` flow — do not modify or replace those actions. A request can have both an open per-document discrepancy and a historical `issueReason` from an earlier whole-request return; they are independent signals.
- `issueReason` is never cleared automatically by this plan — once set, it stays visible on the request permanently as a record of what happened, matching the source design (`detail.hasIssue` shows it regardless of current status). Clearing it (if ever wanted) is a deliberate non-goal, called out explicitly below, not an oversight.
- Same fake-data unit-testing convention as the rest of the codebase — the status-eligibility rule must be a pure function.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — `Request.issueReason`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Request.issueReason String @default("")` — consumed by Task 2 and Task 3.

- [ ] **Step 1: Add the column**

In `model Request { ... }`, add directly below `status String @default("notified")`:

```prisma
  issueReason       String   @default("") // set when an officer returns the whole request for correction — persists as a historical annotation
```

- [ ] **Step 2: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push` (or `npx prisma validate` if no DB is reachable).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add Request.issueReason"
```

---

### Task 2: Pure eligibility rule — `canReturnForCorrection`

**Files:**
- Create: `lib/return-correction.mjs`
- Test: `tests/return-correction.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `canReturnForCorrection({ status, reason }) => { error: string } | { ok: true }` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tests/return-correction.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { canReturnForCorrection } from "../lib/return-correction.mjs";

test("a request in docs_submitted can be returned with a clear reason", () => {
  assert.deepEqual(canReturnForCorrection({ status: "docs_submitted", reason: "Wrong category selected" }), { ok: true });
});

test("a request in verified can be returned with a clear reason", () => {
  assert.deepEqual(canReturnForCorrection({ status: "verified", reason: "Amount does not match receipts" }), { ok: true });
});

test("a request still in notified cannot be returned (nothing to correct yet)", () => {
  const result = canReturnForCorrection({ status: "notified", reason: "Wrong category selected" });
  assert.equal(result.error, "This request cannot be returned for correction from its current status.");
});

test("a request already disbursed cannot be returned (money has already moved)", () => {
  const result = canReturnForCorrection({ status: "disbursed", reason: "Wrong category selected" });
  assert.equal(result.error, "This request cannot be returned for correction from its current status.");
});

test("a reason under 5 characters is rejected regardless of status", () => {
  const result = canReturnForCorrection({ status: "verified", reason: "abcd" });
  assert.equal(result.error, "Enter a clear correction reason.");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/return-correction.test.mjs` — expected FAIL, `lib/return-correction.mjs` does not exist.

- [ ] **Step 3: Write the implementation**

Create `lib/return-correction.mjs`:

```js
// A whole request may only be returned for correction once there is something to
// review (docs_submitted) and no later than verification (verified) — once disbursed,
// money has moved and a return-for-correction no longer makes sense; use the existing
// per-document discrepancy flow, or an explicit reversal, instead.
const RETURNABLE_STATUSES = new Set(["docs_submitted", "verified"]);

export function canReturnForCorrection({ status, reason }) {
  if ((reason || "").trim().length < 5) return { error: "Enter a clear correction reason." };
  if (!RETURNABLE_STATUSES.has(status)) return { error: "This request cannot be returned for correction from its current status." };
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/return-correction.test.mjs` — expected PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/return-correction.mjs tests/return-correction.test.mjs
git commit -m "feat: add canReturnForCorrection eligibility rule"
```

---

### Task 3: RPC action — `returnForCorrection`

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `canReturnForCorrection` from Task 2; `Request.issueReason` from Task 1.
- Produces: RPC action `"returnForCorrection"`.

- [ ] **Step 1: Import the new function**

Add, alongside the other `lib/*` imports:

```js
import { canReturnForCorrection } from "@/lib/return-correction.mjs";
```

- [ ] **Step 2: Add the action**

Directly after the existing `case "resolveDiscrepancy": { ... }` block, add:

```js
      case "returnForCorrection": {
        if (!admin && !can(me, "verify")) return err("Forbidden", 403);
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        const reason = (body.reason || "").trim();
        const check = canReturnForCorrection({ status: r.status, reason });
        if (check.error) return err(check.error);
        await prisma.request.update({ where: { id: r.id }, data: { status: "notified", issueReason: reason } });
        await audit(me, "Returned " + r.id + " for correction — " + reason);
        await notifyUser(r.requesterId, r.id + " returned for correction: " + reason, "notified");
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 3: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. Advance a request to `docs_submitted`, call `returnForCorrection` with a reason under 5 characters (should be rejected), then with a valid reason (should succeed — `status` reverts to `notified`, `issueReason` is set, requester is notified). Attempt the same action on a request still in `notified` (should be rejected as ineligible) and on one already `disbursed` (also rejected).

- [ ] **Step 4: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: add returnForCorrection RPC action"
```

---

### Task 4: UI — "Return for correction" button + persistent issue banner

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `returnForCorrection` RPC action (Task 3); `Request.issueReason`.
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Add the modal**

In `Modal`'s `titles` map, add `correction: "Return for correction"`. In `submit()`, add:

```js
    else if (modal.type === "correction") ok = await rpc("returnForCorrection", { id: modal.reqId, reason: form.reason }, "Request returned for correction.");
```

Add the modal body:

```jsx
{modal.type === "correction" && (<>
  <div className="issue-box" style={{ marginBottom: 16 }}><div className="issue-title"><i className="ph ph-warning-circle" /> Send back to requester</div><div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>The request will return to the Notified stage. Existing attachments remain available for correction.</div></div>
  <div className="field"><label className="label">Reason for the change (required)</label><textarea className="input th" style={{ minHeight: 70, resize: "vertical" }} value={form.reason || ""} onChange={set("reason")} placeholder="e.g. Wrong category selected — should be Hotel Accommodation, not Venue Rental." /></div>
</>)}
```

- [ ] **Step 2: Add the button on request detail**

On `Detail`, in the actions area near the existing `canAdv` buttons, add (visible when `(admin || can("verify")) && ["docs_submitted", "verified"].includes(r.status)`):

```jsx
{(admin || can("verify")) && ["docs_submitted", "verified"].includes(r.status) && <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => { setForm({ reason: "" }); setModal({ type: "correction", reqId: r.id }); }}><i className="ph ph-arrow-u-up-left" /> Return for correction</button>}
```

- [ ] **Step 3: Show the persistent issue banner**

On `Detail`, near the top (alongside the existing `openDisc > 0` banner), add — shown whenever `r.issueReason` is non-empty, regardless of current status:

```jsx
{r.issueReason && <div className="issue-box" style={{ marginBottom: 0 }}><div className="issue-title"><i className="ph ph-warning-circle" /> Returned for correction</div><div className="muted th" style={{ fontSize: 13, lineHeight: 1.5 }}>{r.issueReason}</div></div>}
```

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`. Advance a request to `verified`, click "Return for correction", submit with a short reason (should be rejected client-side or by the server), then with a full reason — confirm the request reverts to `notified`, the requester sees a notification, and the issue banner persists on the detail page even after the request is advanced forward again through the normal flow.

- [ ] **Step 5: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add return-for-correction UI and persistent issue banner"
```

---

## Self-Review Notes

- **Spec coverage:** whole-request return with mandatory reason (Task 1/2/3), status eligibility matching the source design exactly (`docs_submitted`/`verified` only, Task 2), persistent banner regardless of later progress (Task 4, explicitly non-clearing) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Relationship to existing discrepancy flow called out explicitly:** Global Constraints states this is additive to, not a replacement for, `flagDiscrepancy`/`resolveDiscrepancy` — the two coexist independently.
- **Explicit non-goal:** no mechanism to clear `issueReason` once set is provided — it is a permanent historical annotation by design, matching the source mockup's `detail.hasIssue` behavior, not an omission.
