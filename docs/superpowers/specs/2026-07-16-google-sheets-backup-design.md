# Google Sheets Backup Mirror — Design

Finalizes `backup-plan-google-sheets.md` (root-level draft) with a concrete auth mechanism and
implementation plan. That draft's scope (what to sync, why) is unchanged; this doc adds how.

## 1. Goal

A one-way, read-only-from-the-app's-perspective mirror of key tables into a Google Sheet, so the
faculty has a human-readable, independently-recoverable copy of request/account/audit state if the
EC2 instance or its Postgres volume is ever lost. Not a replacement for Postgres — a second copy.

## 2. What syncs (unchanged from the original draft)

Full overwrite per tab on every run (no append, no duplicate-row drift):

| Sheet tab | Source | Columns |
|---|---|---|
| `Requests` | `Request` | id, title, category, amount, dept, requester, status, createdAt, updatedAt, driveFolder |
| `Documents` | `Request.docs` (flattened, one row per doc entry) | requestId, docName, submitted, link, discrepancy open?, discrepancy note |
| `Accounts` | `Account` | id, name, balance (snapshot at sync time) |
| `Transactions` | `Txn` | id, acctId, type, amount, desc, date |
| `Audit` | `Audit` | user, role, action, ts |

`User`, `Role`, `Category`, `MasterDoc` are skipped — no `passwordHash`/email leaves Postgres, and
config tables aren't data worth mirroring.

## 3. Auth: OAuth2 refresh token, not a service account

The original draft assumed a service account JSON key. In practice, this Google Cloud org enforces
`iam.disableServiceAccountKeyCreation` (part of Google's "Secure by Default" org policy), which blocks
key creation outright. Rather than chase an org-policy override, auth uses a personal OAuth2 client
instead:

- **OAuth Client ID** — type "Web application", with `https://developers.google.com/oauthplayground`
  registered as an authorized redirect URI (needed to mint the refresh token via OAuth 2.0 Playground;
  can be left registered afterward, or removed once the token exists).
- **Consent screen published to "In production"** (not "Testing") — unverified is fine for a
  single-user app, but "Testing" status expires refresh tokens after 7 days, which would silently
  break the cron job.
- **Scope: `https://www.googleapis.com/auth/spreadsheets`** (broad — full read/write to every Sheet in
  the account), a deliberate, accepted trade-off over the narrower `drive.file` scope. `drive.file`
  would require the app itself to create the destination spreadsheet via API (since it only grants
  access to files the app created/opened); the broader scope lets the spreadsheet be created manually
  in the Sheets UI, which is simpler to operate. Mitigations for the wider blast radius: the resulting
  refresh token lives only in `.env` (gitignored, never logged, never pasted into chat/tickets), and is
  revocable at any time via https://myaccount.google.com/permissions.
- **Refresh token** is long-lived by design (standard production-OAuth behavior) — it only stops
  working if explicitly revoked, unused for 6 months, or the OAuth client is deleted.

## 4. Config (`.env`)

Already added to `.env` (real values) and `.env.example` (blank placeholders):

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_SHEETS_BACKUP_ID=      # from the sheet's URL, sheet created manually in Sheets UI
CRON_SECRET=                  # shared secret for the cron-triggered route
```

All five are optional at the code level — if unset, sync is skipped (same "best-effort, never breaks
the app" philosophy as `lib/mail.js`).

## 5. Implementation

- **`lib/sheets-backup.mjs`** (new) — exports `syncToSheets()`:
  - Builds a `google.auth.OAuth2` client from `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, sets
    credentials from `GOOGLE_REFRESH_TOKEN` (the `googleapis` client auto-refreshes the short-lived
    access token as needed — no manual refresh logic required).
  - Queries the 5 datasets from Prisma, flattens `Request.docs` for the `Documents` tab.
  - For each tab: `spreadsheets.values.clear` the tab's range, then `spreadsheets.values.update` with
    freshly queried rows (5 tabs = 5 clear+write pairs, well under Sheets API's default quota).
  - No-ops (returns early) if any of the 4 Google env vars is unset.
  - Returns `{ ok: true, syncedAt }` or `{ ok: false, error }` — never throws past its own boundary.

- **`app/api/cron/backup-sheets/route.js`** (new) — POST-only. Compares the `x-cron-secret` request
  header against `CRON_SECRET`; 401 on mismatch or if `CRON_SECRET` is unset. On match, calls
  `syncToSheets()` and returns its result as JSON. Catches everything — a failed sync must never
  surface as a 500 that could look like an app outage.

- **RPC action `backupToSheets`** in `app/api/rpc/route.js` — **admin-only** (`can(user, "*")`,
  matching every other admin-only action in that file, e.g. `createAccount`). Calls the same
  `syncToSheets()` directly (session + permission check already done by the RPC dispatcher — no
  `CRON_SECRET` needed for this path). Returns the sync result to the frontend as a toast
  (success/timestamp, or error message).

- **Settings UI** (`components/App.jsx`) — a "Backup now" button, rendered only when
  `can(user, "*")`, calling the `backupToSheets` RPC action and toasting the result. This is the
  Phase 1 entry point; no separate admin flag needed since it reuses the existing admin permission
  check already used elsewhere in Settings.

Both entry points (cron route, RPC action) call the same `syncToSheets()` — no duplicated sync logic.

## 6. Rollout

1. **Phase 1 — manual button (this pass).** Ship `lib/sheets-backup.mjs`, the RPC action, and the
   Settings button. Verify all 5 tabs populate correctly against real data before touching cron.
2. **Phase 2 — scheduled.** Add an EC2 host crontab entry (not inside the Docker container — the app
   container only binds `127.0.0.1:3000`, reachable directly from the host):
   ```
   0 2 * * * curl -s -H "x-cron-secret: <real CRON_SECRET value>" http://127.0.0.1:3000/api/cron/backup-sheets >> /var/log/pfms-backup.log 2>&1
   ```
   Note: crontab does not source the app's `.env`, so the secret value must be written directly into
   the crontab line itself (acceptable since root's crontab file is root-readable only).
3. **Phase 3 (optional) — visibility.** Surface "Last synced: <timestamp>" in Settings (e.g. store
   `lastSyncOk`/`lastSyncAt` from the most recent `syncToSheets()` call) so a broken cron job doesn't
   go unnoticed for weeks.

## 7. Security summary

- `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` live only in `.env` (gitignored) — never in
  `.env.example`, never committed, never pasted into chat/logs.
- `CRON_SECRET` gates the cron route so it isn't reachable by an arbitrary logged-in user; the RPC
  path is gated by the existing admin (`*`) permission instead.
- No write-back: the app never reads from the Sheet, so an edited/compromised spreadsheet can't affect
  app state.
- OAuth scope is intentionally broad (see §3) — accepted trade-off, mitigated by storage discipline and
  revocability, not by scope narrowing.
