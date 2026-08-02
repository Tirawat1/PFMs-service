// Buckets a free-text audit action into one of a fixed set of categories for filtering,
// by matching against known phrasing in the action strings the RPC route generates
// (see app/api/rpc/route.js's `audit(me, ...)` calls). Order matters — first match wins,
// so more specific rules (e.g. "Corrections") are checked before broader ones that would
// otherwise also match (e.g. "Accounts" matching the word "account").
const RULES = [
  ["Corrections", /^Correction|Deleted transaction|^Reversed |Set status of/i],
  ["Disbursement", /to Funds Disbursed|to Purchase Complete|to Closed|Paid deposit|Issued purchase order|Attached proof of payment|Returned unspent advance|receiving bank account/i],
  ["Verification", /to Verified|discrepancy|for correction/i],
  ["Projections & advances", /projection|\badvance\b/i],
  ["Documents", /document|to Docs Submitted/i],
  ["Users & Roles", /\buser\b|\brole\b/i],
  ["Categories", /categor/i],
  ["Accounts", /\baccount\b|purse|revenue|\bfund/i],
];

export function auditCategory(action) {
  for (const [cat, re] of RULES) if (re.test(action || "")) return cat;
  return "Other";
}
