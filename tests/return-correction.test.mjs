import { test } from "node:test";
import assert from "node:assert/strict";
import { canReturnForCorrection } from "../lib/return-correction.mjs";

test("a request in docs_submitted can be returned with a clear reason", () => {
  assert.deepEqual(canReturnForCorrection({ status: "docs_submitted", reason: "Wrong category selected" }), { ok: true });
});

test("a request in verified can be returned with a clear reason", () => {
  assert.deepEqual(canReturnForCorrection({ status: "verified", reason: "Amount does not match receipts" }), { ok: true });
});

test("a request still in notified cannot be returned (nothing to correct yet)", () => {
  const result = canReturnForCorrection({ status: "notified", reason: "Wrong category selected" });
  assert.equal(result.error, "This request cannot be returned for correction from its current status.");
});

test("a request already disbursed cannot be returned (money has already moved)", () => {
  const result = canReturnForCorrection({ status: "disbursed", reason: "Wrong category selected" });
  assert.equal(result.error, "This request cannot be returned for correction from its current status.");
});

test("a reason under 5 characters is rejected regardless of status", () => {
  const result = canReturnForCorrection({ status: "verified", reason: "abcd" });
  assert.equal(result.error, "Enter a clear correction reason.");
});
