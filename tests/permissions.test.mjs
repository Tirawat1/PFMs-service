import { test } from "node:test";
import assert from "node:assert/strict";
import { canManageRequestDocs } from "../lib/permissions.mjs";

const request = { id: "RB-1", requesterId: "user-a" };

test("the actual requester can manage their own request's docs", () => {
  assert.equal(canManageRequestDocs({ id: "user-a" }, request, false), true);
});

test("admin can manage any request's docs", () => {
  assert.equal(canManageRequestDocs({ id: "someone-else" }, request, true), true);
});

test("a different user is rejected even if they hold the 'create' permission", () => {
  // 'create' lets you make new requests — it must not imply access to someone else's request.
  assert.equal(canManageRequestDocs({ id: "user-b" }, request, false), false);
});
