# Google Sheets Backup Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-way mirror that copies Requests/Documents/Accounts/Transactions/Audit into a Google Sheet, triggerable by an admin-only button (Phase 1) and later a cron job (Phase 2), so the faculty has a human-readable, independently-recoverable copy of app state.

**Architecture:** A single new lib module (`lib/sheets-backup.mjs`) exports a pure row-building function and an impure `syncToSheets()` orchestrator that takes `prisma`/`sheetsClient` as parameters (dependency injection, matching `lib/requests.mjs`) so the business logic is unit-testable without a live DB or Google API. Two callers wire it up: a POST-only cron route gated by a shared secret, and an admin-only RPC action + Settings button.

**Tech Stack:** `googleapis` (npm, OAuth2 client + Sheets API v4), existing Next.js App Router route handlers, Prisma, `node --test`.

## Global Constraints

- One-way mirror only — the app never reads from the Sheet (spec §5, §7).
- Full overwrite per tab on every sync — no append, no duplicate-row drift (spec §2).
- `syncToSheets()` must never throw past its own boundary — always returns `{ ok, ... }`, same best-effort philosophy as `lib/mail.js` (spec §5).
- Manual-trigger path is admin-only (`can(user, "*")`); the cron route is gated by `CRON_SECRET` header match instead (spec §5).
- Follow the existing `lib/requests.mjs` convention: dependency-inject `prisma` (and here, `sheetsClient`) into business logic rather than importing singletons, so tests can supply fakes.
- Spec: `docs/superpowers/specs/2026-07-16-google-sheets-backup-design.md`.

---

### Task 1: Sync engine — `buildSheetRows()` (pure row-building)

**Files:**
- Create: `lib/sheets-backup.mjs`
- Test: `tests/sheets-backup.test.mjs`

**Interfaces:**
- Produces: `buildSheetRows({ requests, categories, accounts, txns, audits }) => { Requests, Documents, Accounts, Transactions, Audit }`, each value an array of row-arrays with a header row first. Field shapes consumed: `Request` (`id, title, categoryId, amount, dept, requesterName, status, createdAt, updatedAt, driveFolder, docs`, where each `docs[i]` is `{name, submitted, link, disc}` and `disc` is `null` or `{open, note}`), `Category` (`id, name`), `Account` (`id, name, balance`), `Txn` (`id, acctId, type, amount, desc, date`), `Audit` (`user, role, action, ts`) — matching `prisma/schema.prisma`.

- [ ] **Step 1: Install the `googleapis` dependency**

Run: `npm install googleapis`
Expected: `package.json` gains a `googleapis` entry under `dependencies`.

- [ ] **Step 2: Write the failing tests**

Create `tests/sheets-backup.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSheetRows } from "../lib/sheets-backup.mjs";

test("builds header-only rows when everything is empty", () => {
  const sheets = buildSheetRows({ requests: [], categories: [], accounts: [], txns: [], audits: [] });
  assert.deepEqual(sheets.Requests, [["ID", "Title", "Category", "Amount", "Department", "Requester", "Status", "Created At", "Updated At", "Drive Folder"]]);
  assert.deepEqual(sheets.Documents, [["Request ID", "Document Name", "Submitted", "Link", "Discrepancy Open", "Discrepancy Note"]]);
  assert.deepEqual(sheets.Accounts, [["ID", "Name", "Balance"]]);
  assert.deepEqual(sheets.Transactions, [["ID", "Account ID", "Type", "Amount", "Description", "Date"]]);
  assert.deepEqual(sheets.Audit, [["User", "Role", "Action", "Timestamp"]]);
});

test("maps a request's categoryId to the category name", () => {
  const request = {
    id: "RB-1", title: "Snacks", categoryId: "cat-1", amount: 500, dept: "IT",
    requesterName: "Alice", status: "notified",
    createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    driveFolder: "https://drive.example/RB-1", docs: [],
  };
  const categories = [{ id: "cat-1", name: "Office Supplies" }];
  const sheets = buildSheetRows({ requests: [request], categories, accounts: [], txns: [], audits: [] });
  assert.deepEqual(sheets.Requests[1], [
    "RB-1", "Snacks", "Office Supplies", 500, "IT", "Alice", "notified",
    "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "https://drive.example/RB-1",
  ]);
});

test("falls back to the raw categoryId when the category is unknown", () => {
  const request = {
    id: "RB-2", title: "Mystery", categoryId: "missing-cat", amount: 100, dept: "HR",
    requesterName: "Bob", status: "notified",
    createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    driveFolder: "", docs: [],
  };
  const sheets = buildSheetRows({ requests: [request], categories: [], accounts: [], txns: [], audits: [] });
  assert.equal(sheets.Requests[1][2], "missing-cat");
});

test("flattens each request's docs into one Documents row per doc", () => {
  const request = {
    id: "RB-3", title: "T", categoryId: "c", amount: 1, dept: "D", requesterName: "R", status: "notified",
    createdAt: new Date(), updatedAt: new Date(), driveFolder: "",
    docs: [
      { name: "Receipt", submitted: true, link: "https://drive.example/receipt", disc: null },
      { name: "Quote", submitted: false, link: "", disc: { open: true, note: "wrong file", fixed: false } },
    ],
  };
  const sheets = buildSheetRows({ requests: [request], categories: [], accounts: [], txns: [], audits: [] });
  assert.deepEqual(sheets.Documents.slice(1), [
    ["RB-3", "Receipt", true, "https://drive.example/receipt", false, ""],
    ["RB-3", "Quote", false, "", true, "wrong file"],
  ]);
});

test("maps accounts, transactions and audit rows directly", () => {
  const accounts = [{ id: "faculty", name: "Faculty Account", balance: 1000 }];
  const txns = [{ id: "t1", acctId: "faculty", type: "out", amount: 200, desc: "Disbursed", date: new Date("2026-01-03T00:00:00.000Z") }];
  const audits = [{ user: "Admin", role: "Admin", action: "Did a thing", ts: new Date("2026-01-04T00:00:00.000Z") }];
  const sheets = buildSheetRows({ requests: [], categories: [], accounts, txns, audits });
  assert.deepEqual(sheets.Accounts[1], ["faculty", "Faculty Account", 1000]);
  assert.deepEqual(sheets.Transactions[1], ["t1", "faculty", "out", 200, "Disbursed", "2026-01-03T00:00:00.000Z"]);
  assert.deepEqual(sheets.Audit[1], ["Admin", "Admin", "Did a thing", "2026-01-04T00:00:00.000Z"]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `tests/sheets-backup.test.mjs` errors because `lib/sheets-backup.mjs` doesn't exist yet.

- [ ] **Step 4: Implement `buildSheetRows()`**

Create `lib/sheets-backup.mjs`:

```js
const REQUESTS_HEADER = ["ID", "Title", "Category", "Amount", "Department", "Requester", "Status", "Created At", "Updated At", "Drive Folder"];
const DOCUMENTS_HEADER = ["Request ID", "Document Name", "Submitted", "Link", "Discrepancy Open", "Discrepancy Note"];
const ACCOUNTS_HEADER = ["ID", "Name", "Balance"];
const TRANSACTIONS_HEADER = ["ID", "Account ID", "Type", "Amount", "Description", "Date"];
const AUDIT_HEADER = ["User", "Role", "Action", "Timestamp"];

export function buildSheetRows({ requests, categories, accounts, txns, audits }) {
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const requestRows = requests.map((r) => [
    r.id, r.title, categoryNameById.get(r.categoryId) ?? r.categoryId, r.amount, r.dept,
    r.requesterName, r.status, r.createdAt.toISOString(), r.updatedAt.toISOString(), r.driveFolder,
  ]);

  const documentRows = requests.flatMap((r) =>
    (r.docs || []).map((doc) => [
      r.id, doc.name, !!doc.submitted, doc.link || "", !!(doc.disc && doc.disc.open), doc.disc?.note || "",
    ])
  );

  const accountRows = accounts.map((a) => [a.id, a.name, a.balance]);
  const transactionRows = txns.map((t) => [t.id, t.acctId, t.type, t.amount, t.desc, t.date.toISOString()]);
  const auditRows = audits.map((au) => [au.user, au.role, au.action, au.ts.toISOString()]);

  return {
    Requests: [REQUESTS_HEADER, ...requestRows],
    Documents: [DOCUMENTS_HEADER, ...documentRows],
    Accounts: [ACCOUNTS_HEADER, ...accountRows],
    Transactions: [TRANSACTIONS_HEADER, ...transactionRows],
    Audit: [AUDIT_HEADER, ...auditRows],
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 5 new tests green, all pre-existing tests still green.

- [ ] **Step 6: Commit**

```bash
git add lib/sheets-backup.mjs tests/sheets-backup.test.mjs package.json package-lock.json
git commit -m "feat: add pure row-builder for Google Sheets backup mirror"
```

---

### Task 2: Sync engine — `syncToSheets()` orchestrator

**Files:**
- Modify: `lib/sheets-backup.mjs`
- Test: `tests/sheets-backup.test.mjs`

**Interfaces:**
- Consumes: `buildSheetRows(...)` from Task 1 (same file).
- Produces: `syncToSheets({ prisma, sheetsClient, env = process.env }) => Promise<{ ok: true, syncedAt: string } | { ok: false, error: string }>`. `prisma` must expose `request.findMany()`, `category.findMany()`, `account.findMany()`, `txn.findMany()`, `audit.findMany()`. `sheetsClient` (optional — defaults to a real `googleapis` Sheets client built from `env`) must expose `spreadsheets.values.clear({spreadsheetId, range})` and `spreadsheets.values.update({spreadsheetId, range, valueInputOption, requestBody})`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sheets-backup.test.mjs`:

```js
import { syncToSheets } from "../lib/sheets-backup.mjs";

function makeFakePrisma({ requests = [], categories = [], accounts = [], txns = [], audits = [] } = {}) {
  return {
    request: { findMany: async () => requests },
    category: { findMany: async () => categories },
    account: { findMany: async () => accounts },
    txn: { findMany: async () => txns },
    audit: { findMany: async () => audits },
  };
}

function makeFakeSheetsClient() {
  const calls = { cleared: [], updated: [] };
  return {
    calls,
    spreadsheets: {
      values: {
        clear: async ({ range }) => { calls.cleared.push(range); },
        update: async ({ range, requestBody }) => { calls.updated.push({ range, rows: requestBody.values }); },
      },
    },
  };
}

const FAKE_ENV = {
  GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REFRESH_TOKEN: "token", GOOGLE_SHEETS_BACKUP_ID: "sheet-id",
};

test("syncToSheets returns a config error when Google env vars are missing", async () => {
  const result = await syncToSheets({ prisma: makeFakePrisma(), env: {} });
  assert.deepEqual(result, { ok: false, error: "Google Sheets backup is not configured." });
});

test("syncToSheets clears and rewrites every tab from fresh Prisma data", async () => {
  const prisma = makeFakePrisma({ accounts: [{ id: "faculty", name: "Faculty Account", balance: 1000 }] });
  const sheetsClient = makeFakeSheetsClient();
  const result = await syncToSheets({ prisma, sheetsClient, env: FAKE_ENV });
  assert.equal(result.ok, true);
  assert.ok(result.syncedAt);
  assert.deepEqual(sheetsClient.calls.cleared, ["Requests", "Documents", "Accounts", "Transactions", "Audit"]);
  const accountsUpdate = sheetsClient.calls.updated.find((u) => u.range === "Accounts!A1");
  assert.deepEqual(accountsUpdate.rows[1], ["faculty", "Faculty Account", 1000]);
});

test("syncToSheets reports the error instead of throwing when the Sheets API call fails", async () => {
  const sheetsClient = { spreadsheets: { values: { clear: async () => { throw new Error("API quota exceeded"); } } } };
  const result = await syncToSheets({ prisma: makeFakePrisma(), sheetsClient, env: FAKE_ENV });
  assert.equal(result.ok, false);
  assert.equal(result.error, "API quota exceeded");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `syncToSheets` is not exported yet.

- [ ] **Step 3: Implement `syncToSheets()`**

Append to `lib/sheets-backup.mjs` (add the import at the top of the file):

```js
import { google } from "googleapis";
```

```js
function defaultSheetsClient({ clientId, clientSecret, refreshToken }) {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

// One-way mirror: queries Prisma, rebuilds every tab from scratch, writes it to the
// configured Google Sheet. Best-effort — a failure here must never affect the app itself.
export async function syncToSheets({ prisma, sheetsClient, env = process.env }) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SHEETS_BACKUP_ID } = env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !GOOGLE_SHEETS_BACKUP_ID) {
    return { ok: false, error: "Google Sheets backup is not configured." };
  }
  try {
    const [requests, categories, accounts, txns, audits] = await Promise.all([
      prisma.request.findMany(),
      prisma.category.findMany(),
      prisma.account.findMany(),
      prisma.txn.findMany(),
      prisma.audit.findMany(),
    ]);
    const sheetsData = buildSheetRows({ requests, categories, accounts, txns, audits });
    const sheets = sheetsClient ?? defaultSheetsClient({
      clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, refreshToken: GOOGLE_REFRESH_TOKEN,
    });

    for (const [tab, rows] of Object.entries(sheetsData)) {
      await sheets.spreadsheets.values.clear({ spreadsheetId: GOOGLE_SHEETS_BACKUP_ID, range: tab });
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEETS_BACKUP_ID,
        range: `${tab}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: rows },
      });
    }
    return { ok: true, syncedAt: new Date().toISOString() };
  } catch (e) {
    console.error("Google Sheets backup failed:", e.message);
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all new tests green, all pre-existing tests still green (should be 21 + 8 = 29).

- [ ] **Step 5: Commit**

```bash
git add lib/sheets-backup.mjs tests/sheets-backup.test.mjs
git commit -m "feat: add syncToSheets orchestrator with dependency-injected prisma/sheets client"
```

---

### Task 3: Cron-triggered route

**Files:**
- Create: `app/api/cron/backup-sheets/route.js`

**Interfaces:**
- Consumes: `syncToSheets({ prisma })` from Task 2.
- Produces: `POST /api/cron/backup-sheets` — 401 JSON `{error}` on missing/wrong `x-cron-secret` header; otherwise the JSON result of `syncToSheets()`.

- [ ] **Step 1: Implement the route**

Create `app/api/cron/backup-sheets/route.js`:

```js
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncToSheets } from "@/lib/sheets-backup.mjs";

export async function POST(req) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncToSheets({ prisma });
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Manually verify the 401 path**

Run: `npm run dev`, then in another terminal:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/cron/backup-sheets
```
Expected: `401` (no `x-cron-secret` header sent).

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/backup-sheets/route.js
git commit -m "feat: add cron-triggered route for Google Sheets backup"
```

---

### Task 4: Admin manual trigger — RPC action + Settings button

**Files:**
- Modify: `app/api/rpc/route.js` (add import near the other `lib` imports; add a case in the `// ---------- misc ----------` section, right after the `loadDemoData` case at line 354)
- Modify: `components/App.jsx` (the `Settings` component, ~line 576-599)

**Interfaces:**
- Consumes: `syncToSheets({ prisma })` from Task 2; `can`/`admin` gating already present in `app/api/rpc/route.js` and `components/App.jsx`.
- Produces: RPC action `"backupToSheets"` (admin-only), invoked from the frontend as `rpc("backupToSheets", {}, "Backup synced to Google Sheets.")`.

- [ ] **Step 1: Add the RPC action**

In `app/api/rpc/route.js`, add this import alongside the existing `lib` imports at the top of the file:

```js
import { syncToSheets } from "@/lib/sheets-backup.mjs";
```

Then add this case immediately after the `loadDemoData` case (before the `default:` case):

```js
      case "backupToSheets": {
        if (!admin) return err("Forbidden", 403);
        const result = await syncToSheets({ prisma });
        if (!result.ok) return err(result.error, 502);
        await audit(me, "Ran Google Sheets backup sync");
        return NextResponse.json({ ok: true, syncedAt: result.syncedAt });
      }
```

- [ ] **Step 2: Add the Settings button**

In `components/App.jsx`, inside the `Settings` component, insert this new panel right before the existing `{admin && data.requests.length === 0 && (...)}` demo-data block (around line 591):

```jsx
    {admin && (
      <div className="panel" style={{ maxWidth: 560 }}>
        <h3 className="panel-t" style={{ marginBottom: 10 }}>Google Sheets backup</h3>
        <p className="dim" style={{ fontSize: 13, margin: "0 0 14px" }}>Mirrors requests, documents, accounts, transactions and the audit trail into a Google Sheet as a human-readable backup.</p>
        <button className="btn btn-ghost" onClick={() => rpc("backupToSheets", {}, "Backup synced to Google Sheets.")}><i className="ph ph-cloud-arrow-up" /> Backup now</button>
      </div>
    )}
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — no regressions (route/UI changes aren't covered by `node --test`, consistent with how every other RPC action in this file is verified: manually, in Task 5).

- [ ] **Step 4: Commit**

```bash
git add app/api/rpc/route.js components/App.jsx
git commit -m "feat: add admin-only manual trigger for the Google Sheets backup"
```

---

### Task 5: End-to-end verification

**Files:** none (manual verification only)

- [ ] **Step 1: Create the 5 destination tabs**

In the Google Sheet already created (ID in `GOOGLE_SHEETS_BACKUP_ID`), rename the default "Sheet1" tab to `Requests`, then add 4 more sheets (bottom-left `+` button) named exactly `Documents`, `Accounts`, `Transactions`, `Audit`. Names must match exactly — `syncToSheets()` references tabs by name and errors if one doesn't exist.

- [ ] **Step 2: Run the app and trigger a real sync**

Run: `npm run dev`, log in as an admin user, go to Settings, click **Backup now**.
Expected: toast reads "Backup synced to Google Sheets." — open the spreadsheet and confirm all 5 tabs now have a header row plus one row per existing record.

- [ ] **Step 3: Verify a non-admin can't trigger it**

Log in as a non-admin user (e.g. a department requester) and confirm the "Google Sheets backup" panel does not render in Settings.

- [ ] **Step 4: Full regression pass**

Run: `npm test` — expect all tests passing.
Run: `npm run build` — expect a clean production build with no errors.

- [ ] **Step 5: Note Phase 2 (cron) as a follow-up, not part of this pass**

Per spec §6, adding the EC2 host crontab entry is a manual infra step done directly on the server (not a code change in this repo) — do this once Phase 1 has been observed working reliably for a few manual runs. No commit for this step.
