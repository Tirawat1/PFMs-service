import { test } from "node:test";
import assert from "node:assert/strict";
import { validateVendorAtSubmission } from "../lib/vendor-required.mjs";

test("a category that does not require a vendor accepts a blank vendor", () => {
  assert.deepEqual(validateVendorAtSubmission({ categoryVendorRequired: false, vendor: "" }), { ok: true });
});

test("a category that requires a vendor rejects a blank vendor", () => {
  const result = validateVendorAtSubmission({ categoryVendorRequired: true, vendor: "" });
  assert.equal(result.error, "This category requires a vendor — enter vendor details.");
});

test("a category that requires a vendor rejects a whitespace-only vendor", () => {
  const result = validateVendorAtSubmission({ categoryVendorRequired: true, vendor: "   " });
  assert.equal(result.error, "This category requires a vendor — enter vendor details.");
});

test("a category that requires a vendor accepts a non-empty vendor", () => {
  assert.deepEqual(validateVendorAtSubmission({ categoryVendorRequired: true, vendor: "Acme Catering Co." }), { ok: true });
});
