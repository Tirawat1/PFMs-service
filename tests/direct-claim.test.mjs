import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRequestSource } from "../lib/direct-claim.mjs";

test("a projection id with status 'advanced' is accepted as a non-direct claim", () => {
  const result = resolveRequestSource({ projectionId: "PJ-2000", projectionStatus: "advanced", categoryAllowDirect: false });
  assert.deepEqual(result, { directClaim: false });
});

test("a projection id with any other status is rejected", () => {
  const result = resolveRequestSource({ projectionId: "PJ-2000", projectionStatus: "submitted", categoryAllowDirect: false });
  assert.equal(result.error, "This projection has no available advance.");
});

test("no projection id is accepted as a direct claim when the category allows it", () => {
  const result = resolveRequestSource({ projectionId: null, projectionStatus: null, categoryAllowDirect: true });
  assert.deepEqual(result, { directClaim: true });
});

test("no projection id is rejected when the category does not allow direct claims", () => {
  const result = resolveRequestSource({ projectionId: null, projectionStatus: null, categoryAllowDirect: false });
  assert.equal(result.error, "This category requires a projected expense with an issued advance, or must be marked to allow direct reimbursement.");
});
