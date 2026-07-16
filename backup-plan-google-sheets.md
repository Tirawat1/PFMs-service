# Backup Plan — Google Sheets Mirror

Design doc, not yet implemented. Answers two questions: (1) does the Google-Drive-link approach
already avoid an EC2 disk problem, and (2) how would a Google Sheets backup work if we add one.

## 1. Disk usage — already solved

`Request.docs` (`prisma/schema.prisma`) stores document entries as JSON: `{name, submitted, link,
fileName, disc}`. `link` is a Google Drive URL string — the app never receives or stores file bytes
(`attachDoc` in `app/api/rpc/route.js` just writes the URL into the JSON column). So EC2 disk usage
from documents is effectively zero regardless of how many requests/attachments accumulate; what
grows over time is the Postgres data volume itself (row count × small JSON) and Docker image layers,
both of which grow far slower than actual file storage would. No action needed here — the current
design already does what was being asked for.

## 2. Why back up to Google Sheets at all

Not a replacement for the Postgres backup story — a second, human-readable copy that:
- Survives an EC2/Postgres-volume loss independently of any DB backup/snapshot process.
- Lets non-technical staff (department reps, faculty officers) open a spreadsheet and see request/
  account status without logging into the app or asking for a DB export.
- Gives an append-only paper trail that isn't affected by future schema changes to the app's own
  Postgres tables.

## 3. What to sync

One tab per entity, full overwrite each run (not append) so the sheet always mirrors current state —
avoids duplicate-row drift from partial failures.

| Sheet tab | Source | Columns |
|---|---|---|
| `Requests` | `Request` | id, title, category, amount, dept, requester, status, createdAt, updatedAt, driveFolder |
| `Documents` | `Request.docs` (flattened, one row per doc entry) | requestId, docName, submitted, link, discrepancy open?, discrepancy note |
| `Accounts` | `Account` | id, name, balance (snapshot at sync time) |
| `Transactions` | `Txn` | id, acctId, type, amount, desc, date |
| `Audit` | `Audit` | user, role, action, ts |

Skip `User` (avoid mirroring `passwordHash` / email anywhere outside Postgres) and `Role`/`Category`/
`MasterDoc` (config, not data worth backing up).

## 4. Sync mechanism

- **Library:** `googleapis` (official Node client), auth via a **Google service account** JSON key —
  share the target spreadsheet with the service account's email, scope the key to Sheets API only.
- **Trigger:** a dedicated route, e.g. `app/api/cron/backup-sheets/route.js`, POST-only, guarded by a
  shared-secret header (`x-cron-secret` compared to a `CRON_SECRET` env var) — not a user-facing RPC
  action, so it isn't reachable via normal login/permission checks.
- **Schedule:** an EC2 crontab entry hitting that route locally (`curl -s -H "x-cron-secret: ..."
  http://localhost:3000/api/cron/backup-sheets`), nightly. Matches the existing pattern in this repo
  of keeping infra concerns (cron, `docker-entrypoint.sh`) outside the app process rather than adding
  a background-job runner.
- **Write pattern:** `spreadsheets.values.batchUpdate` — clear each tab's data range, write freshly
  queried rows in one batch call per tab (5 tabs = 5 batched writes, well under Sheets API's default
  60-writes/min/user quota even for large datasets).
- **Failure handling:** best-effort, same philosophy as `lib/mail.js` — a failed sync must never
  affect the app itself. Catch and log; do not throw past the route handler. Optional stretch: write
  `lastSyncOk` / `lastSyncAt` to a small `SyncState` row or just to a log line, and surface it on the
  admin Settings screen so a silent failure doesn't go unnoticed for weeks.

## 5. Security

- Service account key goes in `.env` (already gitignored) as `GOOGLE_SERVICE_ACCOUNT_JSON` or a path
  to a mounted secret file — never committed, never logged.
- Service account should have edit access to **only** the one backup spreadsheet, not broader Drive
  scope.
- `CRON_SECRET` prevents the backup route from being triggered by an arbitrary authenticated user —
  it's infra-triggered, not user-triggered.
- No write-back: this is one-directional (app → Sheets). The app never reads from the sheet, so a
  compromised or edited spreadsheet can't affect app state.

## 6. Rollout

1. **Phase 1 — manual trigger.** Build the route + sync function, add a "Backup now" admin-only
   button on the Settings screen that calls it directly (bypassing cron/secret, using the existing
   session + `admin` permission check like other admin actions). Verify all 5 tabs populate correctly
   against real data.
2. **Phase 2 — scheduled.** Add the crontab entry on the EC2 host once Phase 1 is verified stable.
3. **Phase 3 (optional) — visibility.** Show "Last synced: <timestamp>" somewhere in Settings so a
   broken cron job is noticeable without checking server logs.

Not building this now — this file is the plan to implement against when ready.
