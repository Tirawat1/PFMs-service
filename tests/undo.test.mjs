import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequestSnapshot } from "../lib/undo.mjs";

test("captures exactly the covered mutable fields, ignoring the rest", () => {
  const request = {
    id: "RB-1", status: "notified", docs: [{ name: "d" }], bank: null, issueReason: "",
    title: "Snacks", categoryId: "cat1", amount: 100, vendor: "", desc: "", paidVia: "finance",
    eventDate: "2026-01-01", vendorExists: null,
    acctId: "project", refundAmount: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01",
  };
  const snap = buildRequestSnapshot(request);
  assert.deepEqual(snap, {
    status: "notified", docs: [{ name: "d" }], bank: null, issueReason: "",
    title: "Snacks", categoryId: "cat1", amount: 100, vendor: "", desc: "", paidVia: "finance",
    eventDate: "2026-01-01", vendorExists: null,
  });
  assert.equal("acctId" in snap, false);
});
