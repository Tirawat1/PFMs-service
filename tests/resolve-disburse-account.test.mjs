import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDisburseAccount } from "../lib/requests.mjs";

test("resolves the explicitly provided account when valid", () => {
  const result = resolveDisburseAccount({
    providedAcctId: "faculty", categoryDefaultAcctId: "project",
    account: { id: "faculty", active: true }, proofLink: "https://example.com/proof",
  });
  assert.deepEqual(result, { acctId: "faculty", proofLink: "https://example.com/proof" });
});

test("falls back to the category's default account when none is provided", () => {
  const result = resolveDisburseAccount({
    providedAcctId: null, categoryDefaultAcctId: "project",
    account: { id: "project", active: true }, proofLink: "https://example.com/proof",
  });
  assert.deepEqual(result, { acctId: "project", proofLink: "https://example.com/proof" });
});

test("rejects when no account can be resolved at all", () => {
  const result = resolveDisburseAccount({
    providedAcctId: null, categoryDefaultAcctId: null, account: null, proofLink: "https://example.com/proof",
  });
  assert.equal(result.error, "Select a source account before disbursing.");
});

test("rejects a closed (inactive) account", () => {
  const result = resolveDisburseAccount({
    providedAcctId: "faculty", categoryDefaultAcctId: null,
    account: { id: "faculty", active: false }, proofLink: "https://example.com/proof",
  });
  assert.equal(result.error, "Selected account is not available.");
});

test("rejects a missing/empty proof link", () => {
  const result = resolveDisburseAccount({
    providedAcctId: "faculty", categoryDefaultAcctId: null,
    account: { id: "faculty", active: true }, proofLink: "   ",
  });
  assert.equal(result.error, "Attach a transfer proof link before disbursing.");
});
