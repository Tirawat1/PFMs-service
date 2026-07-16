#!/usr/bin/env bash
# Triggers a real Google Sheets backup sync (via the running dev server's admin RPC action)
# then reads the actual spreadsheet back via the Sheets API to confirm data landed.
#
# Requires: `npm run dev` already running in another terminal, and GOOGLE_*/ADMIN_* vars set in .env.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_URL="${APP_URL:-http://localhost:3000}"
ADMIN_USERNAME="$(grep -E '^ADMIN_USERNAME=' .env | head -1 | cut -d= -f2-)"
ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env | head -1 | cut -d= -f2-)"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "== Logging in as admin ($ADMIN_USERNAME) =="
curl -s -c "$COOKIE_JAR" -X POST "$APP_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" -o /dev/null -w "login status: %{http_code}\n"

echo
echo "== Triggering backupToSheets =="
curl -s -b "$COOKIE_JAR" -X POST "$APP_URL/api/rpc" \
  -H "Content-Type: application/json" \
  -d '{"action":"backupToSheets"}'
echo
echo

echo "== Reading the spreadsheet back via the Sheets API =="
node --env-file=.env - <<'NODE'
import("googleapis").then(async ({ google }) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SHEETS_BACKUP_ID } = process.env;
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  for (const tab of ["Requests", "Documents", "Accounts", "Transactions", "Audit"]) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEETS_BACKUP_ID, range: tab });
    const rows = res.data.values || [];
    console.log(`\n${tab}: ${rows.length} row(s) including header`);
    console.log(rows.slice(0, 3).map((r) => r.join(" | ")).join("\n"));
  }

  console.log(`\nOpen it yourself: https://docs.google.com/spreadsheets/d/${GOOGLE_SHEETS_BACKUP_ID}/edit`);
});
NODE
