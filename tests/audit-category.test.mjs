import { test } from "node:test";
import assert from "node:assert/strict";
import { auditCategory } from "../lib/audit-category.mjs";

test("classifies a status advance into Funds Disbursed as Disbursement", () => {
  assert.equal(auditCategory("Advanced RB-1 to Funds Disbursed from account project via direct"), "Disbursement");
});

test("classifies a status advance into Verified as Verification", () => {
  assert.equal(auditCategory("Advanced RB-1 to Verified"), "Verification");
});

test("classifies a status advance into Docs Submitted as Documents", () => {
  assert.equal(auditCategory("Advanced RB-1 to Docs Submitted"), "Documents");
});

test("classifies an advance-return refund as Disbursement even though it mentions 'account'", () => {
  assert.equal(auditCategory("Returned unspent advance 250.00 for RB-1 to Faculty account"), "Disbursement");
});

test("classifies issuing a projection advance as Projections & advances", () => {
  assert.equal(auditCategory("Issued advance for projection PJ-1 (1,000.00)"), "Projections & advances");
});

test("classifies submitting a projection as Projections & advances", () => {
  assert.equal(auditCategory("Submitted projection PJ-1 (1,000.00) for QA"), "Projections & advances");
});

test("classifies a discrepancy flag as Verification", () => {
  assert.equal(auditCategory('Flagged discrepancy on "Receipt" (RB-1)'), "Verification");
});

test("classifies a document submission as Documents", () => {
  assert.equal(auditCategory('Submitted document "Receipt" for RB-1'), "Documents");
});

test("classifies a manual figure correction as Corrections", () => {
  assert.equal(auditCategory('Correction — transaction "x" changed from 100.00 to 90.00. Reason: typo'), "Corrections");
});

test("classifies a transaction deletion as Corrections", () => {
  assert.equal(auditCategory('Deleted transaction "x" (100.00). Balance reversed. Reason: duplicate'), "Corrections");
});

test("classifies a reversal as Corrections, not Disbursement, even though it mentions Verified", () => {
  assert.equal(auditCategory("Reversed RB-1 from Funds Disbursed back to Verified — testing"), "Corrections");
});

test("classifies a migration status override as Corrections", () => {
  assert.equal(auditCategory('Set status of request RB-1 from "notified" to "closed"'), "Corrections");
});

test("classifies user/role management as Users & Roles", () => {
  assert.equal(auditCategory("Added user Somchai"), "Users & Roles");
  assert.equal(auditCategory("Created role Finance Officer"), "Users & Roles");
});

test("classifies category management as Categories", () => {
  assert.equal(auditCategory("Created category Snacks"), "Categories");
});

test("classifies account/purse/revenue actions as Accounts", () => {
  assert.equal(auditCategory("Created account Petty Cash"), "Accounts");
  assert.equal(auditCategory("Created purse Sponsorships"), "Accounts");
  assert.equal(auditCategory("Received revenue RV-1 (500.00)"), "Accounts");
});

test("falls back to Other for anything unmatched", () => {
  assert.equal(auditCategory("Loaded demo dataset"), "Other");
  assert.equal(auditCategory("Ran Google Sheets backup sync"), "Other");
});
