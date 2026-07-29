# WCFinance — deployable package

Self-contained web app. No build step, no server-side code, no external network
calls at runtime (fonts, icons and the runtime are inlined). Responsive from
360 px phones up to desktop — the sidebar collapses to a drawer, tables scroll
horizontally inside their cards, and every control keeps a 44 px touch target.

## Contents

- `index.html` — the entire application, single file (~4.8 MB)
- `404.html` — copy of the app, so deep links on static hosts fall back to it
- `README.md` — this file

## Deploy

Any static host works. Drag-and-drop the folder onto Netlify / Vercel / Cloudflare
Pages, push it to GitHub Pages, or copy it into any web root (nginx, Apache, IIS,
SharePoint, a shared drive).

It also runs with no server at all: double-click `index.html`. The `file://` case
works because every asset is inlined.

**HTTPS is recommended** but not required.

## Data storage

All data lives in the browser's `localStorage` under three keys:

    pfms_merged_v3          the database (requests, projections, revenue, users, roles)
    pfms_merged_sess_v1     the current login session
    pfms_merged_undo_v1     the last undoable action

Implications to be aware of before rollout:

- Data is **per browser, per device**. It is not shared between users or machines.
- Clearing browser data wipes it. There is no server backup.
- Private/incognito windows may block writes. The app detects this, keeps working,
  and warns that changes will not survive a reload.

To make this multi-user, the persistence layer (`lsSet` / `persist` / the
`componentDidMount` loader) is the single place to swap `localStorage` for an API.

## Accounts

Sign in with the demo switcher on the login screen, or type credentials:

| Username     | Password     | Role                        |
| ------------ | ------------ | --------------------------- |
| `Pikajuz`    | `WCFin`      | Admin (Project Finance)     |
| `migration`  | `migrate123` | Data Migration — full access, edits anything |

Other seeded department / faculty accounts appear in the switcher.

**Change these passwords before any real deployment.** Credentials are stored in
plain text in the seeded data — this is a prototype auth model, not a secure one.

## Crash safety

- All `localStorage` reads and writes are wrapped; corrupt or blocked storage
  cannot white-screen the app.
- Data that fails its schema check is re-seeded automatically.
- Older saved databases are migrated forward on load (new roles, users, category
  fields are backfilled).
- A global error handler catches anything that still escapes and shows a recovery
  panel with **Reload** and **Reset local data** instead of a blank page.

## What's in this build

- Dashboard: reimbursed-vs-projected coverage panel, per-department projected /
  reimbursed / coverage / status table with grouped bar chart, pipeline
  distribution bar, purse allocation bar, monthly disbursed-vs-projected bars.
- Payment details per request: the department supplies the receiving bank account
  (holder, bank, account no., branch, PromptPay, note); Project Finance sees it in
  the disburse dialog and attaches proof of payment (slip link, reference, date),
  which can be updated later. Both are audit-logged and notify the other side.

## Resetting

Admins can reset the demo data from Settings. Users can also clear it from the
recovery panel, or manually by removing the three `pfms_*` keys in DevTools →
Application → Local Storage.
