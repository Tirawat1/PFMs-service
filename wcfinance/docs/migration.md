# Migrating from the prototype to the server

The prototype keeps everything in browser local storage. Each browser holds its
own copy — two people never see the same data. This is the path to one shared
database.

## 1. Export

In the running app: **Settings → Export data**. Saves `pfms-export.json`.

Do this from the browser with the most complete data — usually whoever has been
demoing. Others' local edits are not merged; they are lost.

## 2. Import

    docker compose cp pfms-export.json app:/app/pfms-export.json
    docker compose exec app node scripts/import-prototype.mjs pfms-export.json

Idempotent — re-running updates rather than duplicating.

## 3. Set real passwords

The prototype stores passwords in clear text. The importer does **not** carry
them over: imported users arrive **disabled** with a random hash. For each real
person, set a password and enable the account. Anyone still holding a demo
password (`dept123`, `finance123`, …) has no way in.

## 4. Verify before cutting over

- Account and stream balances match the prototype's dashboard.
- Every purse sums to the project account balance.
- Reimbursed-vs-projected coverage matches per department.
- One request of each status opens correctly, with its documents.
- The audit trail carried over.

## What does not transfer

- **Uploaded files.** The prototype only ever stored links and file *names*.
  Real documents live in Drive; the links carry over, the files were never here.
- **Notification read state.**
- **Anything a browser other than the exporting one held.**

## After cutover

Retire the standalone file, or keep one copy clearly labelled DEMO. Two live
copies of a finance system is how numbers stop agreeing.
