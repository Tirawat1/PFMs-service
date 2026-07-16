#!/usr/bin/env bash
# Loads baseline + demo data into a pfms-app deployment via its public HTTP API,
# then drives ONE brand-new request through the entire reimbursement pipeline
# (create → attach doc → discrepancy flag/fix/resolve → verify → disburse →
# purchase complete → close) so you can see the whole flow working end to end.
#
# Runs from your laptop — no SSH needed, it only talks to the app's public URL.
#
# WARNING: this creates demo users with passwords that are public in this repo
# (lib/seed-data.mjs): finance/fin123, purchasing/pur123, pm/pm123, dept/dept123.
# Do NOT leave this data on an environment real users can reach.
# Run scripts/mock-demo-wipe.sh on the server right after you're done demoing.
#
# Usage:
#   PFMS_BASE_URL=https://pfms-yourname.duckdns.org \
#   ADMIN_USERNAME=Pikajuz ADMIN_PASSWORD='...' \
#   ./scripts/mock-demo-load.sh
#
# Optional:
#   DRIVE_LINK=https://drive.google.com/...   (defaults to the sample link below)

set -euo pipefail

BASE_URL="${PFMS_BASE_URL:?Set PFMS_BASE_URL, e.g. https://pfms-yourname.duckdns.org}"
ADMIN_USERNAME="${ADMIN_USERNAME:?Set ADMIN_USERNAME}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD}"
DRIVE_LINK="${DRIVE_LINK:-https://drive.google.com/file/d/1yBNym2l-IdpgM-hivTpQ60_0NywkUR2m/view?usp=drive_link}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "== Target: $BASE_URL =="
echo

rpc() {
  # rpc <cookie-jar> <json-body>
  curl -sS -b "$1" "$BASE_URL/api/rpc" -H "Content-Type: application/json" -d "$2"
}

login() {
  # login <user> <pass> <cookie-jar>
  local resp
  resp=$(curl -sS -c "$3" "$BASE_URL/api/auth/login" -H "Content-Type: application/json" \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}")
  if ! echo "$resp" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(d.me?0:1)'; then
    echo "Login failed for $1: $resp" >&2
    exit 1
  fi
}

json_get() {
  # json_get <json-string> <node-expression-on-d>
  node -e "const d=JSON.parse(process.argv[1]); const v=(function(d){return $2})(d); process.stdout.write(String(v));" "$1"
}

ADMIN_JAR="$WORKDIR/admin.jar"
DEPT_JAR="$WORKDIR/dept.jar"
FINANCE_JAR="$WORKDIR/finance.jar"
PURCHASING_JAR="$WORKDIR/purchasing.jar"

echo "-- 1. Admin login (bootstraps roles/accounts/categories on an empty DB) --"
login "$ADMIN_USERNAME" "$ADMIN_PASSWORD" "$ADMIN_JAR"
echo "ok"

echo "-- 2. Load demo dataset (5 sample requests at every pipeline stage + demo users) --"
resp=$(rpc "$ADMIN_JAR" '{"action":"loadDemoData"}')
echo "$resp"
if echo "$resp" | grep -q '"error"'; then
  echo
  echo "loadDemoData was rejected — this DB already has requests in it (safety guard in"
  echo "app/api/rpc/route.js won't seed demo data over real data). If this environment is"
  echo "meant to be empty, wipe it first with scripts/mock-demo-wipe.sh, then re-run this."
  exit 1
fi

echo
echo "-- 3. Log in as each demo role --"
login dept dept123 "$DEPT_JAR"
login finance fin123 "$FINANCE_JAR"
login purchasing pur123 "$PURCHASING_JAR"
echo "ok (dept / finance / purchasing)"

echo
echo "-- 4. Department creates a live test request --"
data=$(curl -sS -b "$DEPT_JAR" "$BASE_URL/api/data")
CAT_ID=$(json_get "$data" "d.categories.find(c=>c.name==='Snacks / Refreshments').id")
resp=$(rpc "$DEPT_JAR" "{\"action\":\"createRequest\",\"title\":\"Live prod flow test\",\"categoryId\":\"$CAT_ID\",\"amount\":9500,\"desc\":\"scripts/mock-demo-load.sh\"}")
echo "$resp"
REQ_ID=$(json_get "$resp" "d.id")
echo "Created $REQ_ID"

echo
echo "-- 5. Department attaches the document (Drive link) --"
rpc "$DEPT_JAR" "{\"action\":\"attachDoc\",\"id\":\"$REQ_ID\",\"idx\":0,\"link\":\"$DRIVE_LINK\",\"fileName\":\"receipt.pdf\"}" > /dev/null
echo "attached"

echo "-- 6. Department advances Notified → Docs Submitted --"
rpc "$DEPT_JAR" "{\"action\":\"advanceRequest\",\"id\":\"$REQ_ID\"}" > /dev/null
echo "advanced"

echo
echo "-- 7. Purchasing officer flags a discrepancy on the document --"
rpc "$PURCHASING_JAR" "{\"action\":\"flagDiscrepancy\",\"id\":\"$REQ_ID\",\"idx\":0,\"note\":\"Receipt is missing the VAT registration number.\"}" > /dev/null
echo "flagged"

echo "-- 8. Department marks it fixed --"
rpc "$DEPT_JAR" "{\"action\":\"markFixed\",\"id\":\"$REQ_ID\",\"idx\":0,\"note\":\"Re-uploaded with VAT number included.\"}" > /dev/null
echo "marked fixed"

echo "-- 9. Purchasing officer resolves the discrepancy --"
rpc "$PURCHASING_JAR" "{\"action\":\"resolveDiscrepancy\",\"id\":\"$REQ_ID\",\"idx\":0}" > /dev/null
echo "resolved"

echo
echo "-- 10. Purchasing officer verifies (Docs Submitted → Verified) --"
rpc "$PURCHASING_JAR" "{\"action\":\"advanceRequest\",\"id\":\"$REQ_ID\"}" > /dev/null
echo "verified"

echo "-- 11. Finance officer disburses funds (Verified → Funds Disbursed) --"
rpc "$FINANCE_JAR" "{\"action\":\"advanceRequest\",\"id\":\"$REQ_ID\"}" > /dev/null
echo "disbursed"

echo "-- 12. Department confirms purchase complete --"
rpc "$DEPT_JAR" "{\"action\":\"advanceRequest\",\"id\":\"$REQ_ID\"}" > /dev/null
echo "purchase complete"

echo "-- 13. Finance officer closes the request --"
rpc "$FINANCE_JAR" "{\"action\":\"advanceRequest\",\"id\":\"$REQ_ID\"}" > /dev/null
echo "closed"

echo
echo "-- 14. Final state + audit trail (as admin) --"
final=$(curl -sS -b "$ADMIN_JAR" "$BASE_URL/api/data")
json_get "$final" "JSON.stringify(d.requests.find(r=>r.id==='$REQ_ID'), null, 2)"
echo
echo "Audit entries for this run:"
json_get "$final" "d.audit.filter(a=>a.action.includes('$REQ_ID')).map(a=>a.ts+' '+a.role+' '+a.action).join(String.fromCharCode(10))"
echo

cat <<'EOF'

============================================================
  DONE. This environment now has demo users with PUBLIC,
  repo-committed passwords:
    finance/fin123  purchasing/pur123  pm/pm123  dept/dept123
  Do not leave this exposed. Run scripts/mock-demo-wipe.sh on
  the server (SSH) as soon as you're done demoing.
============================================================
EOF
