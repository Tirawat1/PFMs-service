# Feature Inventory — pfms-app

This is a small, flat Next.js app: `components/App.jsx` is the entire frontend (one client-side SPA
component, ~651 lines), `app/api/rpc/route.js` is the single mutation endpoint (a `switch (action)`
block, ~289 lines), `app/api/data/route.js` is the single read endpoint. Features below are drawn by
**domain concern**, not by directory — most features share the same two backend files, distinguished
by line range / `case` name.

Boundaries were proposed by a Feature Discovery subagent that read every source file listed under
"Core files" in full (exact line numbers, not estimates), then adjusted by the orchestrator: the
subagent's features 11 (user settings) and 12 (demo data seeding) are merged below into a single
"Settings & admin utilities" bucket, since splitting a one-screen, low-audit-priority area into two
features added more bookkeeping than clarity for this audit pass.

⚠ = flagged in CLAUDE.md's "Project goals" gap-check as not yet meeting the target requirements.

---

## 1. Request lifecycle & status pipeline
- **Entry points:** RPC `createRequest` (rpc/route.js:49-72), `advanceRequest` (rpc/route.js:74-91); screens `Requests` (App.jsx:256-286), `Detail` (App.jsx:289-363, advance button at 358)
- **Core files:** `app/api/rpc/route.js:49-91`, `lib/requests.mjs` (`advanceRequestTx`), `lib/constants.js` (`ORDER`, `STATUS`, `ADV_PERM`, `ADV_LABELS`), `components/App.jsx:256-363`
- **Purpose:** Creates a request with a category-seeded doc checklist and advances it through the fixed 6-stage pipeline (`notified → docs_submitted → verified → disbursed → purchase_complete → closed`), gated per-transition by `ADV_PERM`.

## 2. Document checklist & discrepancy/remark workflow
- **Entry points:** RPC `attachDoc`/`detachDoc` (rpc/route.js:94-117), `flagDiscrepancy` (120-132), `markFixed` (135-148), `resolveDiscrepancy` (151-163); rendered inside `Detail` (App.jsx:289-363, doc list at 314-347) and modal forms (App.jsx:567-651)
- **Core files:** `app/api/rpc/route.js:94-163`, `lib/permissions.mjs` (`canManageRequestDocs`), `components/App.jsx:289-363,567-651`
- **Purpose:** Per-request document checklist stored as JSON (Google Drive link, no upload) plus the officer-flags → requester-fixes → officer-resolves discrepancy sub-state machine on each doc entry. Fully implemented — this is the "remark" feature the user asked for.

## 3. Accounts, transactions & disbursement ⚠
- **Entry points:** disbursement side-effect inside `advanceRequest` → `advanceRequestTx` (rpc/route.js:81-84, lib/requests.mjs:11-14); screens `Accounts` (App.jsx:421-444), bank cards on `Dashboard` (App.jsx:174-241, `TxnRow` at 243-253)
- **Core files:** `lib/requests.mjs`, `prisma/schema.prisma` (`Account`, `Txn`), `components/App.jsx:174-253,421-444`
- **Purpose:** Two hardcoded accounts (`faculty`, `project`) with running balances and an in/out ledger. Disbursement always debits the `project` account — no RPC action to create accounts, no per-request account choice, no category→account routing. **This is the main gap vs. the multi-account requirement.**

## 4. Categories & document menu (master docs) ⚠
- **Entry points:** RPC `createCategory` (166-172), `updateCategoryNotes` (173-177), `toggleCatDoc` (178-185), `addCatDoc` (186-197), `addMasterDoc` (198-205), `removeMasterDoc` (206-210); screens `Categories` (App.jsx:366-382), `CatEdit` (384-418), `DocMenu` (481-493)
- **Core files:** `app/api/rpc/route.js:166-210`, `prisma/schema.prisma` (`Category`, `MasterDoc`), `lib/seed-data.mjs`, `components/App.jsx:366-418,481-493`
- **Purpose:** Admin-managed master document list and per-category checklists. `Category` has no field for "which account" or "which officer type" a request in this category needs — **this is where category-driven routing would need to be added.**

## 5. Roles & permissions ⚠
- **Entry points:** RPC `createRole` (235-243), `deleteRole` (244-253); screen `Users` (App.jsx:447-478, role cards 466-476)
- **Core files:** `app/api/rpc/route.js:235-253`, `lib/auth.js` (`can`, `isAdmin`), `lib/constants.js` (`PERMKEYS`), `prisma/schema.prisma` (`Role`), `lib/seed-data.mjs` (`ROLES`)
- **Purpose:** String-key permission model (`"*"` = admin). `faculty_finance` and `faculty_purchasing` roles already exist with different perms (finance: verify+disburse+accounts; purchasing: verify only), but both hold a blanket `verify` — **nothing routes a specific request to the officer type its category actually needs.**

## 6. Users & departments
- **Entry points:** RPC `createUser` (213-227), `deleteUser` (228-234); screen `Users` (App.jsx:447-465), modal (598-607)
- **Core files:** `app/api/rpc/route.js:213-234`, `lib/auth.js` (`sanitizeUser`), `prisma/schema.prisma` (`User`)
- **Purpose:** Admin CRUD for users; each user has a free-text `dept` string (not a structured `Department` model) and a role.

## 7. Notifications (in-app + email)
- **Entry points:** `notifyUser`/`notifyPerm` helpers (rpc/route.js:18-37) called from most mutating cases; RPC `markAllRead` (256-259); screens `Notifs` (App.jsx:508-538), `Settings` (541-564)
- **Core files:** `app/api/rpc/route.js:14-37,256-266`, `lib/mail.js`, `prisma/schema.prisma` (`Notification`)
- **Purpose:** In-app notification row + best-effort email (no-ops silently without SMTP env vars) on every meaningful state change, fanned out either to a specific user or to everyone holding a given permission.

## 8. Audit trail
- **Entry points:** `audit()` helper (rpc/route.js:14-16), called from nearly every mutating case; screen `AuditTrail` (App.jsx:496-505)
- **Core files:** `app/api/rpc/route.js:14-16` + call sites, `prisma/schema.prisma` (`Audit`)
- **Purpose:** Append-only free-text log ("who did what"), admin-only. Note: records only `user`/`role` name strings, no entity id link — not queryable per-request. Already covers the "audit trail" requirement, though not linkable back to a specific request/document/account row.

## 9. Auth, session & first-run bootstrap
- **Entry points:** `app/api/auth/{login,logout,me}/route.js`; screen `Login` (App.jsx:141-171)
- **Core files:** `lib/auth.js` (JWT cookie via `jose`), `lib/seed-data.mjs` (`seedBaseline`)
- **Purpose:** bcrypt+JWT cookie auth, no separate session store; first login against an empty `Role` table self-seeds baseline data.

## 10. Dashboard / financial overview (read-only aggregation) ⚠
- **Entry points:** screen `Dashboard` (App.jsx:174-241) + `TxnRow` (243-253); no dedicated RPC — purely derived from `/api/data`
- **Core files:** `components/App.jsx:174-253`, `app/api/data/route.js`
- **Purpose:** Combines accounts/txns/requests/categories into balance cards, a pipeline funnel, and spend-by-category. Only aggregates existing account/txn rows — **no total-budget-vs-committed-vs-remaining concept**, which is what "ดูสถานะเงินรวมของโครง" (overall project money status) needs.

## 11. Settings & admin utilities
- **Entry points:** RPC `updateSettings` (260-266), `loadDemoData` (267-280); screen `Settings` (App.jsx:541-564)
- **Core files:** `app/api/rpc/route.js:260-280`, `prisma/schema.prisma` (`User.email`, `User.emailNotify`), `lib/seed-data.mjs` (`seedDemo`)
- **Purpose:** Self-service email/notification prefs (any logged-in user, own row only) plus a one-shot admin demo-data loader (blocked once any real request exists). Low priority for the money-routing audit.

---

**Not a feature boundary:** the EN/ไทย language toggle is UI-only state (`lang` in `App.jsx`) with no server representation — it touches every screen's copy but isn't a domain concern.

**Primary audit targets** (where CLAUDE.md's gap-check lives): features **3, 4, 5, 10** — these are the pieces that need to grow to support category-driven staff/account routing, arbitrary accounts, per-request account tracking, and a project-level budget rollup.
