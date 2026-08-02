# PFMS Feature Design — extracted from `Merging PFMS Expense System.html`

This document is a complete, literal inventory of every feature, field, rule, and
interaction found in the client's WC Finance mockup (`Merging PFMS Expense System.html`,
2190 lines, read in full). It exists so future implementation work can be scoped and
planned against ground truth rather than memory. Where our production app
(Next.js + Prisma) already implements a piece, it is marked **✅ Implemented**; where it
doesn't, **❌ Missing**; where it's partially there, **⚠️ Partial** with the gap noted.

The mockup itself is a client-only prototype (localStorage persistence, plaintext
passwords, simulated Google Drive/Sheets) — see the "Non-goals inherited from the
mockup" section at the end for what should NOT be ported literally.

---

## 1. Domain Model

### Role
| Field | Type | Notes |
|---|---|---|
| `id` | string | In the mock, fixed literal ids (`admin`, `migration`, `project_manager`, `faculty_finance`, `faculty_purchasing`, `department`) — category approval is matched against these ids directly (`canApproveCat`). Our app uses generated cuids + an explicit `Role.approverKey` field instead, which is a deliberate improvement (supports custom roles, not just the six hardcoded ones). |
| `name`, `nameTh` | string | |
| `perms` | string[] | `PERMKEYS = ['dashboard','requests','create','verify','disburse','accounts','notifications']`, or `['*']` for full admin. |
| `contact` | string | Designated contact person shown on the role card. |
| `system` | boolean | System roles cannot be deleted or have `perms` edited. |
| `migration` | boolean | ❌ Missing. A dedicated **Data Migration** role/account (see §9). |
| `advanceDashRoles` (on `settings`, not per-role) | string[] | Which roles see the "Advance Payments" dashboard. ✅ Implemented as `Role.canSeeAdvances` (per-role flag — an improvement over the mock's single global list). |
| `approverKey` | string? | ✅ Implemented — `faculty_finance` \| `faculty_purchasing` \| null, narrows the `verify` permission per category. |

### User
| Field | Notes |
|---|---|
| `id, name, username, password, roleId, dept, email, emailNotify` | ✅ Implemented (password is bcrypt-hashed server-side, unlike the mock's plaintext). |

### Category
| Field | ✅/❌ | Notes |
|---|---|---|
| `name`, `nameTh`, `icon` | ✅ | |
| `docsPre[]`, `docsPost[]` | ✅ | Two-phase document checklist. |
| `docExamples` (`{[docName]: {name, link}}`) | ✅ | Example file shown beside a checklist item. |
| `samples[]` (`{name, link}`) | ❌ **Missing** | A *category-level* (not per-document) list of "here's what a correct submission looks like" reference files, shown on every request in that category. Distinct from `docExamples` (which is per-document). Has its own add/remove UI in `CatEdit`. |
| `notes` | ✅ | |
| `defaultAcctId` | ✅ | |
| `active` | ✅ | Soft-close. |
| `allowDirect` | ✅ | |
| `vendorRequired` | ✅ | |
| `requireCompletionDocs` | ⚠️ **Partial** | Column exists (added in the document-phasing plan) but **nothing reads it yet** — the mock blocks the `purchase_complete`/`closed` transition when this is true and post-docs are incomplete (see §3). Our `advanceRequestTx` does not enforce this. |
| `defaultPaidVia` | ✅ | `finance` \| `purchasing` \| `psat`. |
| `approverRole` | ✅ | `faculty_finance` \| `faculty_purchasing`. Mock also allows a third value, `admin` (meaning "Project Finance only, no delegated approver") — ❌ we only support the two delegated values, not an explicit "admin-only" category setting (though admin can always approve everything anyway, so this is a labeling/UX gap more than a functional one). |

### MasterDoc
| Field | ✅/❌ |
|---|---|
| `name` | ✅ |
| `vendorDoc` | ✅ (mock calls this a separate top-level `db.vendorDocs: string[]` array rather than a flag per doc — functionally equivalent, our per-doc-flag design is cleaner.) |

### Account
`id, name, nameTh, icon, balance, active` — ✅ Implemented.

### Stream ("purse" — a named sub-total inside the `project` account)
`id, name, color, icon, balance` — ✅ Implemented (we don't store `icon`, cosmetic-only gap).
Seeded in mock with 4 purses: `s_advance` (Faculty Advances), `s_sponsor` (Sponsorships),
`s_reg` (Registration Fees), `s_donate` (Donations & Grants). We seed 2 (`s_advance`,
`s_general`) — naming/count is a content choice, not a structural gap.

### Txn
`id, acctId, streamId?, type (in|out), amount, desc, date` — ✅ Implemented.
Mock also has `edited: boolean` stamped when `applyNumberEdit` changes a txn's amount —
❌ we don't stamp this (cosmetic; the Audit Trail entry already records the correction).

### Request — by far the richest entity. Full field list:

| Field | ✅/❌ | Notes |
|---|---|---|
| `id, title, categoryId, amount, dept, requesterId, requesterName` | ✅ | |
| `status` (see §3 for the state machine) | ✅ | |
| `desc, eventDate, createdAt` | ✅ | |
| `driveFolder` | ✅ | Placeholder link, not real Drive integration (see §10). |
| `docs[]` (`{name, phase, submitted, link, fileName, disc, vendorDoc?}`) | ✅ | |
| `issueReason` | ✅ | Return-for-correction annotation. |
| `acctId` (disbursement source account) | ✅ | |
| `streamId` (which purse funded the disbursement, when `acctId==='project'`) | ⚠️ **Partial** — column exists on `Txn` but **not on `Request`**. The mock disburse flow lets the officer pick which purse pays the expense (`showStreamSelect` when `form.acctId==='project'`) and stores it on the request (`req.streamId`) so the detail page can show "Paid from purse: X". We disburse without ever asking which purse, and don't record it on the request. |
| `projectionId` | ✅ | |
| `directClaim` | ✅ | |
| `disburseProofLink` | ✅ (named `proofLink` in mock) | |
| `vendor, vendorRequired, vendorExists, vendorDocsAdded` | ✅ | |
| `paidVia` | ✅ | |
| `po` (`{number, vendor, amount, note, link, by, byRole, ts, deliveredTo, deliveredToId}`) | ⚠️ **Partial** | We implemented `po` but our shape is `{number, vendor, amount, link, note, issuedAt, issuedBy}` — **missing `deliveredTo`/`deliveredToId`** (mock shows "Issued to you" badge to the requester, and gates a "awaiting PO" banner). Also missing `poSeq` counter tracking on the db object (we use a real `Counter` row instead — fine). |
| `depositAmount, depositPaid, depositStreamId` | ✅ | |
| `payProof` (`{link, ref, date, note, by, byRole, ts}`) | ✅ | |
| `bank` (`{holder, bank, acctNo, branch, promptpay, note, by, byRole, ts}`) | ❌ **Missing entirely** | A whole sub-feature: the requester/department provides the **receiving bank account** for reimbursement, shown to Project Finance before/at disbursement. See §7. |
| `payRoute` (`direct \| advance \| selfpay`) | ❌ **Missing entirely** | Set at disbursement time — see §6 "Payment Route". |
| `payee` | ❌ **Missing** | Department member receiving funds, only for the `selfpay` route. |
| `payNote` | ❌ **Missing** | Required note for a `selfpay` disbursement. |
| `actualAmount` | ❌ **Missing as a distinct field** | The mock lets the officer type an actual amount paid **at disbursement time**, which can differ from `r.amount` (the originally requested/projected amount) — not just compared against the *projection's* amount. Our `advanceRequestTx` always disburses `r.amount` (or `r.amount − deposit`); there is no officer-editable "actual paid, possibly less than requested" field at the disbursement step itself. This is functionally similar to (but distinct from) the existing Advance-Payments settlement, which compares `r.amount` to the *projection's* amount, not to a separately-entered "actual" figure. |
| `refundAmount` | ⚠️ **Partial** | We compute and move the refund via `settleProjectionTx`, but never store it back onto the `Request` row for display — the mock shows "Returned to Faculty: ฿X" on the detail page and lets admin edit it directly via `editNumber`. |
| `fundRoute` (`{streamId}`) | ❌ **Missing entirely** | Separate from `payRoute` (confusingly similar name in the mock) — this is the **manual Faculty→Project transfer** ("Transfer to Project" button), an alternative/adjacent path to the advance-approval flow, admin-only. See §7 "Route Funds". |
| `migrated` | ✅ | Column exists; only partially surfaced in UI. |

### Projection
`id, title, categoryId, dept, requesterId, requesterName, amount, expectedDate, status, requestId, createdAt, migrated, vendorRequired` — ✅ mostly implemented. `vendorRequired` on the projection itself (copied from category at submission, then possibly overridden by the approver via the `approveAdvance` modal's toggle) is ❌ missing — see §7 "Issue Advance — vendor toggle".

Mock's projection status enum: `submitted | advanced | linked | settled | rejected`.
We only implemented `submitted | advanced | linked | settled` — **`rejected` is missing**
(there is no reject action for a submitted projection in our app; an officer can only
approve or leave it pending).

### Revenue
`id, title, source, accountId, streamId, amount, expectedDate, status (projected|received), receivedAt, createdAt, migrated` — ✅ Implemented, `migrated` unused in UI.

### Notification
`id, text, topic, type, refId, read, ts, sender, senderRole, dept` — ⚠️ **Partial**. We have `text, type, read, ts, userId`. Missing: `topic` (derived label like "Funds disbursed"), `sender/senderRole/dept` (who triggered it), and critically **`refId`** — the mock makes every notification clickable, jumping straight to the referenced `RB-`/`PJ-`/`RV-` record. Ours are inert list items.

### Audit
`user, role, action, ts` — ✅ Implemented. Missing: **category tagging** (`auditCat()` buckets every action into one of `['Projections & advances','Disbursement','Verification','Corrections','Documents','Users & Roles','Categories','Accounts','Other']` for filtering — see §7 "Audit Trail filters").

### Counter
`request, projection, revenue, po` — ✅ Implemented (mock keeps these as plain integers on the `db` object — `seq`, `pjSeq`, `rvSeq`, `poSeq` — functionally identical to our `Counter` rows).

### Settings (app-wide, not per-user)
`advanceDashRoles: string[]` — ✅ implemented per-role instead (`Role.canSeeAdvances`), a cleaner design than a single global list.

---

## 2. Permission Model

```
PERMKEYS = ['dashboard', 'requests', 'create', 'verify', 'disburse', 'accounts', 'notifications']
```
Plus the synthetic `'*'` (full admin) and `'advdash'` (nav-only key, resolved via
`canSeeAdvances`/`advanceDashRoles`, not a real perm bucket).

✅ All seven real perm keys are implemented identically. `can(key)`: admin short-circuits
to true, otherwise checks membership in `role.perms`. This matches `lib/auth.js` exactly.

**Category-level approval routing** (`canApproveCat`): admin always passes; otherwise the
acting role's id/approverKey must match `category.approverRole`. ✅ Implemented via
`canApproveCategory` — narrows `verify`, doesn't replace it, exactly as the mock does.

---

## 3. Request Status Machine

```
ORDER = [notified, docs_submitted, verified, disbursed, purchase_complete, closed]
STATUS labels: Notified / Docs Submitted / Verified / Funds Disbursed / Purchase Complete / Closed
ADV_PERM = { docs_submitted:'create', verified:'verify', disbursed:'disburse', purchase_complete:'create', closed:'disburse' }
```
✅ Identical in our `lib/constants.js`.

**Transition gates found in `advance(reqId)` that we do NOT fully replicate:**

1. **Pre-docs must all be submitted before `docs_submitted` or `verified`.**
   `if (['docs_submitted','verified'].includes(next) && !pre.every(d=>d.submitted)) reject`
   — ❌ **Missing.** Our `advanceRequestTx` does not check document completeness at all;
   any status can currently be advanced regardless of attached documents.
2. **No open discrepancy before `verified`.**
   `if (next==='verified' && docs.some(d=>d.disc?.open)) reject`
   — ❌ **Missing.**
3. **Post-docs must all be submitted before `closed`.**
   — ❌ **Missing.**
4. **`requireCompletionDocs` gates `purchase_complete`** — if the category requires
   completion docs and post-docs aren't all submitted, block the transition.
   — ❌ **Missing** (column exists, unused).
5. **The `disbursed` transition doesn't happen via `advanceRequestTx` directly** — it opens
   the rich `disburse` modal instead (route, actual amount, proof, stream, deposit-aware
   math — see §6). We *do* have the deposit-aware remaining-balance math in
   `advanceRequestTx`, but not the modal's other fields (route/actual/stream).
6. **`closed` settles the linked projection** (`p.status='settled'`) — ✅ we do this, but
   at `disbursed` time via `settleProjectionTx`, not at `closed` time. Functionally close
   enough (money already moved), but worth noting the mock settles on `closed`, we settle
   on `disbursed`.
7. **Reversal (`reverseStep`)** — ❌ **Missing entirely.** Steps backward through `ORDER`,
   requires the same permission that performed the forward step, and carefully unwinds:
   - Reversing out of `disbursed`: returns `remaining + refund` to the disbursing account
     (and purse), reverses the Faculty refund if any, clears `acctId/proofLink/payProof/
     actualAmount/refundAmount/payRoute/payNote/payee`.
   - Reversing out of `closed`: re-opens the linked projection (`settled → linked`).
   - Reversing back to `docs_submitted`/`notified`: clears any issued `po`; if funds were
     manually routed (`fundRoute`), reverses that transfer too.
   - Every reversal is logged as a **discrepancy**-type notification/audit entry, distinct
     from a normal forward-audit entry.
8. **`docs_submitted` clears `issueReason`** on the way *forward* — i.e. once corrected
   documents are resubmitted, the "returned for correction" banner's *trigger* is
   considered handled (though the mock's UI still shows `issueReason` forever per our
   earlier design — actually **check this**: `req.issueReason=''` on transition to
   `docs_submitted` in `advance()`, contradicting the earlier "persists forever" read
   of the *rendering* logic. Rendering shows it via `hasIssue: !!r.issueReason`, so once
   cleared on resubmission it stops showing. **Correction to our shipped plan**: our
   `return-for-correction` plan documented `issueReason` as permanent/non-clearing; the
   mock actually clears it on the next `docs_submitted` transition. This is a real
   behavioral difference worth reconciling.

---

## 4. Document Checklist Rules

`docEditable(r, doc)`:
- Admin: editable any time except when `r.status === 'closed'`.
- Pre-phase doc: editable while `status ∈ {notified, docs_submitted, verified}`.
- Post-phase doc: editable while `status ∈ {disbursed, purchase_complete}`.

⚠️ **Difference from our `isDocEditable`:** the mock's admin override
(`admin ⇒ status !== 'closed'`, i.e. admin can edit *any* phase's docs at *any*
non-closed status) is **not** replicated in our `lib/doc-phase.mjs` — ours applies the
same phase/status rule to everyone including admin. Minor but real: an admin in the mock
can attach a pre-doc even after verification (to fix a mistake) or a post-doc before
disbursement; ours cannot.

Additional document actions found but not yet built:
- **"Add a required document" directly from the request detail page** (`addReqDocPre`/
  `addReqDocPost`) — an officer (verify perm or admin) can add a document to *this one
  request's* checklist on the fly (not the category template), notifying the requester.
  ❌ **Missing.**
- **File drag-and-drop** (`onDropFile`/`onDragOver`) alongside the paste-a-link option —
  cosmetic/prototype-only (still just records a filename, no real upload) but our UI only
  offers the paste-a-link path, no drop zone at all.

---

## 5. Dashboard — full breakdown (see prior conversation for the summary; this is the complete spec)

The mock renders **two entirely different dashboards** keyed off `isDeptUser()`:

### 5a. Department Overview (`isDeptDash`) — ❌ Missing entirely (we have no dept-specific dashboard)
- Attention banner (contextual "what to do next" text + icon, role-specific — see
  `attentionFor()`).
- 3 stat cards: Projected expenses (sum + count), Reimbursements in progress (count +
  sum), Documents to submit now (count, only counting currently-editable docs).
- "My projected expenses" table (own + own-dept projections).
- "My reimbursements" list — **not a table**, a card list — each row shows:
  - Title, id, amount, status badge.
  - An overall pipeline progress bar (`(ORDER.indexOf(status)+1)/ORDER.length`).
  - **Two separate progress bars**: "DOCS P1" (pre-phase completion %) and "DOCS P2"
    (post-phase completion %).

### 5b. Financial Overview (`isFinDash`) — ⚠️ Partial (we have a much simpler version)
In addition to what was already reported (department filter, coverage box, dept
breakdown table+chart, monthly disbursement chart, donut, activity feed — all ❌
missing), the full spec adds:
- **Purses row + stacked bar** showing relative purse sizes (`purseSegs`, conic-style
  proportional bar) — ❌ missing (we only show purses on the Accounts page, not
  dashboard).
- **Bank cards are clickable** → navigate to Accounts. ✅ trivial, already matches ours.
- **Stat card 2 ("Total inflow") routes to Revenue if the user can see it, else
  Accounts** — small UX nicety, ❌ not replicated (we don't route stat cards anywhere).
- **Pipeline cells are clickable**, jumping to Reimbursements pre-filtered to that status
  (`goReqStatus`) — ❌ missing (ours are static numbers).
- **"Recent transactions" rows are clickable**, resolving the linked `RB-` id out of the
  description text via regex and opening that request's detail — ❌ missing.
- **Donut legend entries are clickable** → Categories (admin) or Requests (others) — ❌
  missing.
- **"Projected expenses" panel embedded directly in the dashboard** (top 5 by recency,
  with an inline "Issue advance" button) — ❌ missing; ours requires navigating to the
  Projected Expenses page.

---

## 6. Disbursement — the full "disburse" modal (biggest single gap)

Our implementation only asks for `acctId` + `proofLink`, then transfers `r.amount` (or
`r.amount − deposit`). The mock's `disburse` modal is far richer:

1. **Payment route** (`form.route`, default `direct`):
   - `direct` — "Straight to supplier"
   - `advance` — "Advance into Project account, then to supplier"
   - `selfpay` — "Transfer to a department member to pay the supplier" — requires
     `payee` (name) and `payNote` (mandatory note) when selected.
2. **Bank info display** — if `r.bank` exists, shows holder/account/branch/PromptPay/note
   read-only in the modal; if not, shows a warning banner suggesting the officer ask the
   department or record details in the proof note instead.
3. **Source account** — same as ours.
4. **Revenue stream (purse) selector** — shown *only* when the chosen account is
   `project`; required in that case. Validates the purse has sufent balance too, not
   just the account.
5. **Deposit-aware banner** — if a deposit was already paid, shows it and notes only the
   remainder will be deducted (✅ we do this banner already).
6. **"Actual amount paid"** — a distinct field from `r.amount`. Validation:
   `actual <= r.amount` (cannot exceed originally projected/requested),
   `actual - deposit >= 0`, and the *disbursing account/purse* must have balance ≥
   `actual - deposit`. The refund to Faculty is `max(0, r.amount - actual)`.
7. **Proof of payment** — link + optional reference + optional date, captured **inline in
   the same modal** (in addition to the separate standalone `proofPay` modal for
   attaching/updating proof *after* the fact).
8. **Reminder/payment note** — mandatory only for `selfpay`, otherwise optional.
9. On submit: moves `remaining = actual − deposit` out of the account (and purse, if
   any); if `refund > 0`, also moves that out of the same account/purse and into Faculty;
   records **one or two** `Txn` rows accordingly; stores `payRoute`, `payee`, `payNote`,
   `actualAmount`, `refundAmount`, `streamId`, `payProof` all onto the request; notifies
   and audits with the full route/payee context.

**Recommendation:** this is the single highest-value gap to close next — our current
disbursement flow is materially less flexible than the mock's for real finance-officer
workflows (no route choice, no officer-adjustable actual-paid amount distinct from the
requested amount, no purse selection, no self-pay path).

---

## 7. Other request-detail actions found, not yet built

### Edit Request
`openEditRequest` — creator or admin, any non-closed request — lets them change title,
category, amount, event date, `paidVia`, `vendor`, description *after* creation. ❌
**Missing.** Currently a request's fields are fixed at creation (only admin's generic
`editRecordAmount` can touch the `amount` field in isolation, via the universal-correction
feature — everything else is immutable).

### Receiving Bank Account (`bankInfo` modal)
Department (or admin) provides where reimbursement funds should land: holder name, bank,
account number, branch, PromptPay, note. Shown on request detail as a read-only box once
provided; a `showBankBoxFor`/`canEditBankFor`/`bankStillNeeded` set of rules governs
visibility (shown once someone can add it, or once it exists; hidden after `closed`).
Officers can also **"request it"** (`askBankInfo`) which just fires a notification asking
the department to fill it in. ❌ **Missing entirely.**

### Route Funds (`routeFunds` modal) — distinct from Advance approval
`openRouteFunds` — admin-only, available on a `verified` request with no `fundRoute` yet
— manually transfers `r.amount` from Faculty to a chosen purse in Project, independent of
the Projection/Advance-Payments flow. This looks like an alternate path for *direct-claim*
or non-projection requests that still need Faculty money routed into a Project purse
before disbursement (as opposed to going through `createProjection`/`approveProjection`).
❌ **Missing entirely.**

### Issue Advance — vendor toggle (`approveAdvance` modal)
When approving a projection, the officer is asked **"Is a vendor required for this
expense?"** (a switch, defaulting to the category's `vendorRequired`), and the answer is
stamped onto the projection (`pr.vendorRequired = form.vendorRequired`), which then flows
to the linked request. This lets the *approver* override the category default per
projection. ❌ **Missing** — our `approveProjection` doesn't ask this; the request's
`vendorRequired` is only ever category-derived at request-creation time.

### Issue PO — richer than ours
- Auto-suggested sequential number shown in the form (`PO-{poSeq}`), editable by the
  officer.
- Gated by `canIssuePOFor`: role must be `faculty_purchasing` or admin, status must be
  `verified`, and no PO already issued.
- Records `deliveredTo`/`deliveredToId` (the requester) — shown on detail as "Issued to
  you" badge when the current viewer is that requester.
- An **"awaiting PO" banner** shows on the request detail once verified but before a PO
  exists: *"Verified — the Faculty Purchasing Officer will issue the purchase order and
  send it to the requester."*
- ⚠️ We implemented a simpler version (any `disburse`-permitted user, any status, no
  delivered-to tracking, no awaiting-banner).

### Attach/Update Proof of Payment — standalone
Same shape as ours, but gated more precisely (`canAttachProofFor`: `disburse` perm or
admin, status ∈ `{disbursed, purchase_complete, closed}` — i.e. cannot attach proof
*before* disbursement, unlike our version which has no status gate at all).

---

## 8. Category Edit page — additions beyond what we built

- **Sample documents** (category-level reference files, separate from per-doc
  `docExamples`) — add/remove UI with name+link fields. ❌ Missing.
- **"Require completion documents" toggle** — column exists, toggle UI + enforcement
  missing.
- **Approval clearance select** exposes a third option, **"Project Finance only"**
  (`admin`), not just the two delegated roles — ⚠️ partial, we only offer the two
  delegated values.
- Master-doc "Add from document menu" panel has an explicit **Phase 1 / Phase 2 segmented
  toggle** at the top (`setPhasePre`/`setPhasePost`) controlling which phase new
  additions go into — ✅ we built the equivalent (a `seg` toggle in `CatEdit`).

---

## 9. Data Migration Mode — ❌ Missing as a coherent concept

The mock has a **dedicated, seeded "Data Migration" role + user**
(`id:'migration', perms:['*'], migration:true` / `username:'migration'`), distinct from
plain admin:
- `isMigration()` — true only for this specific role.
- Every write made while impersonating this role is tagged in the audit log with a
  `[Data migration]` prefix, and every request/projection/revenue created or edited while
  in this mode gets `migrated: true` stamped automatically (not just via the explicit
  status-override action).
- A persistent top-of-content banner while in this mode: *"Data migration stage. This
  account has full access to every screen and can edit any figure or status directly.
  Records you create or change here are tagged Migrated..."*
- The **status-override** action (`applyStatusEdit`) is gated on `isMigration()`, not on
  admin generally.

Our implementation instead added a narrow `Role.isMigrationOperator` boolean that *any*
role can have set — which is arguably a **better** design (assignable per-role rather
than one hardcoded account) but we never built:
- The auto-tagging of *every* mutation made by such a role as `migrated`/`[Data
  migration]`-prefixed (we only stamp `migrated: true` on the explicit `setRecordStatus`
  action, nothing else).
- The persistent banner.
- A "Migrated" badge anywhere in the UI (column exists on Request/Projection/Revenue,
  never rendered).

## 10. Undo — ❌ Missing entirely

After any mutating action, the mock snapshots the *entire* pre-mutation database state
and shows a global "Your last action — [description] · Undo / Dismiss" bar at the top of
the content area. `undoLast()` restores the full snapshot (and logs "Undid last action —
...", clearing the undo slot so it can't be re-applied twice); the snapshot is scoped to
the user who performed the action (another user's undo bar wouldn't show for you). This
is a meaningful safety-net feature entirely absent from our app — there is no way to
undo any action once submitted, only manual figure/status correction after the fact.

## 11. Audit Trail — filtering, missing entirely

Our Audit Trail page is a flat unfiltered list. The mock's has:
- Filter by user (dropdown of distinct users who've acted).
- Filter by role (dropdown of distinct roles).
- Filter by **action category** — `auditCat()` classifies every action into one of 9
  buckets via regex on the action text (`Projections & advances`, `Disbursement`,
  `Verification`, `Corrections`, `Documents`, `Users & Roles`, `Categories`, `Accounts`,
  `Other`) — shown as a `<span class="tag">` per row too.
- Filter by date range (from/to).
- A "N of M entries shown" counter and a "Clear filters" button.
❌ All of the above missing — we render every audit row unfiltered with no category tag.

## 12. Notifications — richer targeting/interaction, missing

- Every notification is clickable (`hasRef`) and deep-links to the referenced record
  (`RB-`→ request detail, `PJ-` → Projected Expenses, `RV-` → Revenue), marking itself
  read on click.
- Shows `sender`/`senderRole` (who triggered it) prominently, not just the message text.
- Has a derived `topic` label distinct from the message body (e.g. "Funds disbursed" vs.
  the full sentence).
❌ All missing — ours are static, unclickable, sender-less list items.

## 13. Login screen — cosmetic gap

Mock login has a **"Demo role switcher"** — one-click login as any of the first 6 seeded
users, each shown with initials-avatar + name + role, for fast manual QA across roles.
❌ Not applicable to production (this is explicitly prototype-only tooling per the
mockup's own demo banners) — **do not port this**, it would be a security anti-pattern in
a real deployed app. Mentioned here only for completeness/context.

---

## 14. Non-goals inherited from the mockup (confirmed, do not port literally)

- **Google Drive**: every "Drive link" in the mockup is either user-pasted or a
  simulated placeholder (`https://drive.google.com/file/d/prototype-.../view`) generated
  client-side. There is no real Drive API call anywhere in the mock, and our app matches
  this (constructs a placeholder `driveFolder` string, nothing more). If real Drive
  upload is ever wanted, it is 100% new work — see the earlier conversation for what that
  would require (OAuth/service account, `lib/drive.mjs`, real upload endpoint).
- **Google Sheets backup**: mock's "Backup now" button is fully simulated (`runBackup`
  just sets a timestamp and writes an audit line — no real network call). Our app's
  equivalent (`lib/sheets-backup.mjs`) is, notably, **more real** than the mock's — it
  actually calls the Sheets API. Nothing to port here.
- **Client-side-only persistence / plaintext passwords / demo role switcher**: explicitly
  prototype-only per the mock's own on-screen disclaimers. Our server-backed,
  bcrypt-hashed, Postgres-persisted design is already the correct target; nothing to
  "catch up" on here — if anything the gap runs the other direction.

---

## 15. Suggested prioritization for closing the gaps above

Roughly ordered by (a) how much real finance-officer workflow value it unlocks and
(b) how much it builds on schema/logic that already exists:

1. **Disbursement modal richness** (§6) — route/actual-amount/stream/self-pay — highest
   day-to-day value, and the deposit-aware math we already built is 80% of the way there.
2. **Workflow transition guards** (§3.1–3.4) — pre-docs-before-verify, no-open-discrepancy-
   before-verify, post-docs-before-close, `requireCompletionDocs` enforcement — these are
   *correctness* gaps (the workflow currently lets things advance that shouldn't be able
   to), not just missing UI.
3. **Bank Info + Edit Request** (§7) — two self-contained, additive features with clear
   value (department-provided payout details; ability to fix a mistaken request without
   admin intervention).
4. **Reversal** (§3.7) — safety-net feature, non-trivial (must correctly unwind every
   side effect per status), but valuable once disbursement is richer (more that can go
   wrong needing a clean undo path).
5. **Notification/Audit richness** (§11, §12) — pure UX, no new business logic, mostly
   additive rendering + a few derived fields.
6. **Dept Dashboard + Fin Dashboard analytics** (§5) — highest visual/effort ratio but
   lowest urgency; valuable for reporting, not for day-to-day transaction correctness.
7. **Data Migration mode as a coherent concept, Undo, Route Funds, category samples** —
   lower priority; niche/administrative rather than core workflow.

This document does not include literal code — it's a specification to plan future
implementation plans (`docs/superpowers/plans/*.md`) against, the same way the first 13
plans were derived from this same mockup.
