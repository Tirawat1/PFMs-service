import { test } from "node:test";
import assert from "node:assert/strict";
import { canApproveCategory } from "../lib/payment-routing.mjs";

test("admin can approve any category regardless of routing", () => {
  assert.equal(canApproveCategory({ admin: true, hasVerifyPerm: false, roleApproverKey: null, categoryApproverRole: "faculty_purchasing" }), true);
});

test("a role with the matching approverKey and verify permission can approve", () => {
  assert.equal(canApproveCategory({ admin: false, hasVerifyPerm: true, roleApproverKey: "faculty_finance", categoryApproverRole: "faculty_finance" }), true);
});

test("a role with verify permission but the wrong approverKey is rejected", () => {
  assert.equal(canApproveCategory({ admin: false, hasVerifyPerm: true, roleApproverKey: "faculty_purchasing", categoryApproverRole: "faculty_finance" }), false);
});

test("a role with no approverKey at all falls back to the plain verify permission (unrouted categories stay open to any verifier)", () => {
  assert.equal(canApproveCategory({ admin: false, hasVerifyPerm: true, roleApproverKey: null, categoryApproverRole: "faculty_finance" }), true);
});

test("a role without verify permission is always rejected, routed or not", () => {
  assert.equal(canApproveCategory({ admin: false, hasVerifyPerm: false, roleApproverKey: "faculty_finance", categoryApproverRole: "faculty_finance" }), false);
});
