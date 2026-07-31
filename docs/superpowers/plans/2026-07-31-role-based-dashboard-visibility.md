# Role-Based Advance Dashboard Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator grant specific roles visibility into the Projected Expenses / advance-tracking page independently of the existing coarse-grained `requests` permission, so (for example) a Faculty Finance Officer role can see outstanding advances without also being folded into the general "requests" permission bucket.

**Architecture:** Adds one boolean column to `Role` (`canSeeAdvances`). Admins always see the page regardless of this flag (matching the existing `admin`-always-wins convention used everywhere else in the permission system — see `can()` in `lib/auth.js`). A dedicated admin-only RPC action flips the flag per role. The nav-item visibility check in `components/App.jsx` is extended to check this flag in addition to the existing `requests` permission.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + PostgreSQL.

## Global Constraints

- This plan assumes the "Projected Expenses" page from `docs/superpowers/plans/2026-07-31-advance-payments.md` Task 5 already exists (it added the `projections` nav entry gated on `perm: "requests"`). This plan changes that gate to also allow `canSeeAdvances` roles through.
- Admin-only mutations follow the existing `if (!admin) return err("Forbidden", 403);` pattern (see `createRole`, `deleteRole` in `app/api/rpc/route.js`).
- `admin` always has full access regardless of any per-role flag — do not let `canSeeAdvances` be checked in a way that could ever produce a `false` result for an admin. Follow `lib/auth.js`'s `can()`/`isAdmin()` pattern: check `admin` first, short-circuit.
- No placeholder/TBD code — every step below is the literal content to write.

---

### Task 1: Prisma schema — `Role.canSeeAdvances`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Role.canSeeAdvances Boolean @default(false)` — consumed by Task 2 and Task 3.

- [ ] **Step 1: Add the column**

In `prisma/schema.prisma`, in `model Role { ... }`, add directly below `system  Boolean @default(false)`:

```prisma
  canSeeAdvances Boolean @default(false)
```

- [ ] **Step 2: Apply the schema change locally**

Run: `npx prisma generate && npx prisma db push`
Expected: no errors. If no local database is reachable, run `npx prisma validate` instead.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add Role.canSeeAdvances column"
```

---

### Task 2: RPC action — `toggleRoleAdvDash`

**Files:**
- Modify: `app/api/rpc/route.js`

**Interfaces:**
- Consumes: `Role.canSeeAdvances` from Task 1.
- Produces: RPC action `"toggleRoleAdvDash"` — consumed by Task 3's UI.

- [ ] **Step 1: Add the action**

Directly after the existing `case "createRole": { ... }` block, add:

```js
      case "toggleRoleAdvDash": {
        if (!admin) return err("Forbidden", 403);
        const role = await prisma.role.findUnique({ where: { id: body.id } });
        if (!role) return err("Not found", 404);
        await prisma.role.update({ where: { id: role.id }, data: { canSeeAdvances: !role.canSeeAdvances } });
        await audit(me, (role.canSeeAdvances ? "Revoked" : "Granted") + " Projected Expenses dashboard visibility for role " + role.name);
        return NextResponse.json({ ok: true, canSeeAdvances: !role.canSeeAdvances });
      }
```

- [ ] **Step 2: Manual verification against a local database**

Run: `npm run seed` then `npm run dev`. Call `toggleRoleAdvDash` for a non-admin role via the browser devtools console (`fetch("/api/rpc", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ action: "toggleRoleAdvDash", id: "<roleId>" }) })` while logged in as admin) and confirm the role's `canSeeAdvances` flips in `npx prisma studio`. Confirm calling it as a non-admin user returns 403.
Expected: flag toggles correctly; non-admin call is rejected.

- [ ] **Step 3: Commit**

```bash
git add app/api/rpc/route.js
git commit -m "feat: add toggleRoleAdvDash RPC action"
```

---

### Task 3: UI — gate the nav item + per-role toggle chips

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `toggleRoleAdvDash` RPC action (Task 2); `Role.canSeeAdvances` (Task 1).
- Produces: nothing consumed by later tasks — last task in this plan.

- [ ] **Step 1: Locate the nav-item visibility filter**

Run: `grep -n "NAV\b\|navItems\s*=" components/App.jsx` to find where `NAV` entries are filtered into `navItems` based on the current user's role/permissions (this is the mechanism the Advance Payments plan's Task 5 Step 2 added the `{ key: "projections", ... perm: "requests" }` entry into).

- [ ] **Step 2: Change the `projections` nav entry's gate**

Change the nav-filtering logic so the `projections` entry is visible when **either** the existing `requests` permission check passes **or** the current user's role has `canSeeAdvances === true`, **or** the user is admin. Concretely, if the filter is a `.filter(n => n.perm === "*" ? admin : can(n.perm))`-style expression (confirm the exact shape in Step 1), special-case the `projections` key:

```js
const visible = n.key === "projections"
  ? (admin || can(n.perm) || currentRole?.canSeeAdvances)
  : (n.perm === "*" ? admin : can(n.perm));
```

Adjust variable names (`currentRole`, `can`, `admin`) to match whatever the live file actually calls them — confirmed in Step 1.

- [ ] **Step 3: Add per-role toggle chips somewhere in Users & Roles**

On the existing Users & Roles page's role list (find via `grep -n "roleRows\|Users & Roles" components/App.jsx`), add a small chip/badge per role reading "Sees Projected Expenses" that is clickable only for admins and calls `toggleRoleAdvDash` with that role's `id`, reflecting `role.canSeeAdvances` as on/off.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`. Log in as a role without `requests` or `canSeeAdvances` — confirm "Projected Expenses" is absent from the nav. As admin, toggle `canSeeAdvances` on for that role from Users & Roles. Log back in as that role — confirm the nav item now appears and the page loads.
Expected: nav item visibility exactly tracks the flag; admin's own view is never affected by this flag either way.

- [ ] **Step 5: Commit**

```bash
git add components/App.jsx
git commit -m "feat: gate Projected Expenses nav on role.canSeeAdvances"
```

---

## Self-Review Notes

- **Spec coverage:** admin-configurable per-role visibility (Task 1/2/3), admin always retains access regardless of the flag (explicitly called out in Global Constraints and Task 2's action, which never restricts admin), UI toggle surface (Task 3) — all covered.
- **Placeholder scan:** none — every step has literal code, except Task 3 Step 2's variable names, which are explicitly flagged as needing live-file confirmation rather than being guessed.
- **Type/name consistency:** `canSeeAdvances` spelled identically across schema (Task 1), RPC (Task 2), and UI (Task 3).
- **Explicit non-goal:** this plan does not generalize into a full per-page, per-role visibility matrix — it is scoped narrowly to the one dashboard called out in the original feature list. A generalized visibility system would be its own plan if needed later.
