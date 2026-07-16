import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeSnapshot } from "../lib/snapshot.mjs";

const raw = {
  roles: ["role1"],
  users: ["user1"],
  categories: ["cat1"],
  masterDocs: ["doc1"],
  accounts: ["acct1"],
  txns: ["txn1"],
  requests: ["req1"],
  notifs: ["notif1"],
  audit: ["audit1"],
};

test("non-admin without the 'requests' permission gets an empty requests list", () => {
  const shaped = shapeSnapshot({ admin: false, canAccounts: false, canRequests: false }, raw);
  assert.deepEqual(shaped.requests, []);
});

test("non-admin with the 'requests' permission gets the full requests list", () => {
  const shaped = shapeSnapshot({ admin: false, canAccounts: false, canRequests: true }, raw);
  assert.deepEqual(shaped.requests, raw.requests);
});

test("admin gets requests regardless of the specific 'requests' permission", () => {
  const shaped = shapeSnapshot({ admin: true, canAccounts: false, canRequests: false }, raw);
  assert.deepEqual(shaped.requests, raw.requests);
  assert.deepEqual(shaped.accounts, raw.accounts);
  assert.deepEqual(shaped.users, raw.users);
});

test("accounts/txns stay gated by the 'accounts' permission (regression guard)", () => {
  const shaped = shapeSnapshot({ admin: false, canAccounts: false, canRequests: true }, raw);
  assert.deepEqual(shaped.accounts, []);
  assert.deepEqual(shaped.txns, []);
});

test("non-admin users list is always empty (regression guard)", () => {
  const shaped = shapeSnapshot({ admin: false, canAccounts: true, canRequests: true }, raw);
  assert.deepEqual(shaped.users, []);
});

test("non-admin with neither 'accounts' nor 'disburse' still gets empty accounts/txns (regression guard)", () => {
  const shaped = shapeSnapshot({ admin: false, canAccounts: false, canDisburse: false, canRequests: true }, raw);
  assert.deepEqual(shaped.accounts, []);
  assert.deepEqual(shaped.txns, []);
});

test("non-admin with the 'disburse' permission (but not 'accounts') gets accounts/txns", () => {
  const shaped = shapeSnapshot({ admin: false, canAccounts: false, canDisburse: true, canRequests: true }, raw);
  assert.deepEqual(shaped.accounts, raw.accounts);
  assert.deepEqual(shaped.txns, raw.txns);
});
