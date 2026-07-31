# Purchase Order & Proof of Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Purchasing Officer issue a formal purchase order (ใบสั่งจ้าง) to a vendor before money moves, with its own sequential number, and let Finance separately attach structured proof-of-payment (bank reference, date, note) to a request — both as first-class records on the request rather than generic checklist documents, matching the two dedicated modals already sketched in the source design (`issuePO`, `proofPay`).

**Architecture:** `Request` gains two nullable `Json` fields: `po` (`{ number, vendor, amount, link, note, issuedAt, issuedBy }`) and `payProof` (`{ link, ref, date, note, by, byRole, ts }`) — both simple structured blobs, not new tables, since neither needs independent querying or a lifecycle of its own beyond "set once, occasionally re-set." A dedicated `Counter` row (`po`) generates human-readable PO numbers (`PO-1000+`). Two RPC actions: `issuePurchaseOrder` (gated the same way disbursement-adjacent actions are — `can(me, "disburse")` or admin) and `attachProofOfPayment` (same gate). Both are pure metadata writes with an audit line — no account/balance side effects, since the money movement itself is already handled by `advanceRequestTx`.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL, `node:test` + `node:assert/strict`.

## Global Constraints

- `po` and `payProof` are independent of each other and of the request's `status` — a request can have a PO issued while still `notified`, and proof of payment attached only once `disbursed`. Do not couple either action to a specific status; let the officer issue/attach them whenever the information becomes available. Grep for `docs/superpowers/plans/*.md` referencing `Request.disburseProofLink` before implementing `payProof` — this plan's `payProof` is deliberately a separate, richer structure (with `ref`, `date`, `note`) for bank-transfer paperwork, not a replacement for the existing simple `disburseProofLink` string already captured at disbursement time.
- Admin-only-style gates in this plan use `can(me, "disburse") || admin` (matching the existing `ADV_PERM.disbursed` convention in `lib/constants.js`), not a hardcoded `admin`-only check — Purchasing/Finance officers, not just admins, need to use these actions day-to-day.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — `Request.po`/`payProof`, `po` counter

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `lib/seed-data.mjs`

**Interfaces:**
- Produces: `Request.po Json?`, `Request.payProof Json?` — consumed by Task 2.

- [ ] **Step 1: Add the columns**

In `model Request { ... }`, add directly below `paidVia String @default("finance")` (added by the Payment Routing plan; if that plan hasn't shipped, add directly below `vendorExists Boolean?` instead):

```prisma
  po                Json?
  payProof          Json?
```

- [ ] **Step 2: Seed the `po` counter**

In `lib/seed-data.mjs`, directly below the existing `await prisma.counter.create({ data: { id: "projection", value: 2000 } });` line, add:

```js
  await prisma.counter.create({ data: { id: "po", value: 1000 } });
```

- [ ] **Step 3: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push` (or `npx prisma validate` if no DB is reachable).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma lib/seed-data.mjs
git commit -m "feat: add Request.po and Request.payProof"
```

---

### Task 2: RPC actions — `issuePurchaseOrder`, `attachProofOfPayment`

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `Request.po`/`payProof` from Task 1.
- Produces: RPC actions `"issuePurchaseOrder"`, `"attachProofOfPayment"`.

- [ ] **Step 1: Add `issuePurchaseOrder`**

Directly after the existing `case "advanceRequest": { ... }` block, add:

```js
      case "issuePurchaseOrder": {
        if (!admin && !can(me, "disburse")) return err("Forbidden", 403);
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        const vendor = (body.vendor || r.vendor || "").trim();
        if (!vendor) return err("Enter the vendor name.");
        const amount = Number(body.amount) || r.amount;
        const counter = await prisma.counter.update({ where: { id: "po" }, data: { value: { increment: 1 } } });
        const number = "PO-" + counter.value;
        const po = { number, vendor, amount, link: body.link || null, note: body.note || "", issuedAt: Date.now(), issuedBy: me.name };
        await prisma.request.update({ where: { id: r.id }, data: { po } });
        await audit(me, "Issued purchase order " + number + " for " + r.id + " to " + vendor);
        await notifyUser(r.requesterId !== me.id ? r.requesterId : null, r.id + " — purchase order " + number + " issued.", "notified");
        return NextResponse.json({ ok: true, number });
      }
      case "attachProofOfPayment": {
        if (!admin && !can(me, "disburse")) return err("Forbidden", 403);
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        if (!body.link) return err("Paste a link to the transfer slip / statement.");
        const payProof = { link: body.link.trim(), ref: body.ref || "", date: body.date || new Date().toISOString().slice(0, 10), note: body.note || "", by: me.name, byRole: me.role.name, ts: Date.now() };
        await prisma.request.update({ where: { id: r.id }, data: { payProof } });
        await audit(me, "Attached proof of payment for " + r.id);
        return NextResponse.json({ ok: true });
      }
```

- [ ] **Step 2: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. As a `disburse`-permitted user, issue a PO for a request with no vendor on file but a `body.vendor` override — confirm it's rejected only when both are empty, and that the PO number increments (`PO-1000`, `PO-1001`, ...). Attach proof of payment with a link, ref, and date — confirm all fields persist and re-attaching overwrites the previous `payProof` cleanly (last write wins — there is intentionally no history here, matching the source design where this is a single current record, not a log).

- [ ] **Step 3: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: add issuePurchaseOrder and attachProofOfPayment RPC actions"
```

---

### Task 3: UI — PO and proof-of-payment modals on request detail

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `issuePurchaseOrder`, `attachProofOfPayment` RPC actions (Task 2).
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Add both modal titles and submit branches**

In `Modal`'s `titles` map, add `issuePO: "Issue purchase order"` and `proofPay: "Attach proof of payment"`.

In `Modal`'s `submit()`, add:

```js
    else if (modal.type === "issuePO") ok = await rpc("issuePurchaseOrder", { id: modal.reqId, vendor: form.vendor, amount: form.amount, link: form.link, note: form.note }, "Purchase order issued.");
    else if (modal.type === "proofPay") ok = await rpc("attachProofOfPayment", { id: modal.reqId, link: form.link, ref: form.ref, date: form.date, note: form.note }, "Proof of payment attached.");
```

- [ ] **Step 2: Add both modal bodies**

Add, alongside the other `modal.type === "..."` bodies:

```jsx
{modal.type === "issuePO" && (<>
  <div className="field"><label className="label">Vendor</label><input className="input" value={form.vendor || ""} onChange={set("vendor")} /></div>
  <div className="field"><label className="label">Amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} /></div>
  <div className="field"><label className="label">Drive link to the signed purchase order</label><input className="input" value={form.link || ""} onChange={set("link")} placeholder="https://drive.google.com/file/d/…" /></div>
  <div className="field"><label className="label">Note (optional)</label><textarea className="input" style={{ minHeight: 60, resize: "vertical" }} value={form.note || ""} onChange={set("note")} /></div>
</>)}

{modal.type === "proofPay" && (<>
  <div className="field"><label className="label">Transfer slip link</label><input className="input" value={form.link || ""} onChange={set("link")} placeholder="https://… (bank slip / statement)" /></div>
  <div className="field"><label className="label">Transfer reference</label><input className="input" value={form.ref || ""} onChange={set("ref")} placeholder="TRF-88213" /></div>
  <div className="field"><label className="label">Date</label><input className="input" type="date" value={form.date || ""} onChange={set("date")} /></div>
  <div className="field"><label className="label">Note (optional)</label><textarea className="input" style={{ minHeight: 60, resize: "vertical" }} value={form.note || ""} onChange={set("note")} /></div>
</>)}
```

- [ ] **Step 3: Add buttons and read-only display on request detail**

On `Detail`, in the Details panel, add (visible when `admin || can("disburse")`):

```jsx
{(admin || can("disburse")) && <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ vendor: r.vendor || "", amount: String(r.amount), link: "", note: "" }); setModal({ type: "issuePO", reqId: r.id }); }}><i className="ph ph-file-text" /> {r.po ? "Re-issue PO" : "Issue PO"}</button>}
{(admin || can("disburse")) && <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ link: "", ref: "", date: new Date().toISOString().slice(0, 10), note: "" }); setModal({ type: "proofPay", reqId: r.id }); }}><i className="ph ph-receipt" /> Attach proof of payment</button>}
```

Directly below, render read-only cards when present:

```jsx
{r.po && <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--panel2)" }}><div style={{ fontSize: 12, fontWeight: 800, marginBottom: 5 }}><i className="ph ph-file-text" /> Purchase order {r.po.number}</div><div style={{ fontSize: 13 }}>{r.po.vendor} — {fmt(r.po.amount)}</div>{r.po.link && <a href={r.po.link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>View PO ↗</a>}</div>}
{r.payProof && <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--panel2)" }}><div style={{ fontSize: 12, fontWeight: 800, marginBottom: 5 }}><i className="ph ph-receipt" /> Proof of payment</div><div style={{ fontSize: 13 }}>{r.payProof.ref} — {r.payProof.date}</div><a href={r.payProof.link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>View slip ↗</a></div>}
```

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`. Issue a PO, confirm the number increments each time and the card renders with the Drive link. Attach proof of payment, confirm the reference/date/link render correctly and re-attaching updates the same card in place.

- [ ] **Step 5: Commit**

```bash
git add components/App.jsx
git commit -m "feat: add purchase order and proof-of-payment UI"
```

---

## Self-Review Notes

- **Spec coverage:** sequential PO numbering (Task 1/2), structured proof-of-payment distinct from the existing simple disbursement proof link (Task 1/2/3, explicitly distinguished in Global Constraints), UI for both (Task 3) — all covered.
- **Placeholder scan:** none — every step has literal code.
- **Type/name consistency:** `po`/`payProof` shapes match exactly between their Task 1 schema comment, Task 2 RPC construction, and Task 3 UI rendering.
- **Explicit non-goal:** neither `po` nor `payProof` is versioned/historized — each is a single current-value blob, overwritten on re-issue/re-attach, matching the source design's behavior exactly (not a design gap introduced by this plan).
