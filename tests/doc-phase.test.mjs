import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocEditable } from "../lib/doc-phase.mjs";

test("a pre-reimbursement doc is editable before verification", () => {
  assert.equal(isDocEditable({ phase: "pre", status: "notified" }), true);
  assert.equal(isDocEditable({ phase: "pre", status: "docs_submitted" }), true);
});

test("a pre-reimbursement doc is locked once verified or later", () => {
  assert.equal(isDocEditable({ phase: "pre", status: "verified" }), false);
  assert.equal(isDocEditable({ phase: "pre", status: "disbursed" }), false);
  assert.equal(isDocEditable({ phase: "pre", status: "closed" }), false);
});

test("a closing document is locked before disbursement", () => {
  assert.equal(isDocEditable({ phase: "post", status: "notified" }), false);
  assert.equal(isDocEditable({ phase: "post", status: "verified" }), false);
});

test("a closing document opens once funds are disbursed", () => {
  assert.equal(isDocEditable({ phase: "post", status: "disbursed" }), true);
  assert.equal(isDocEditable({ phase: "post", status: "purchase_complete" }), true);
});

test("a closing document is locked again once the request is closed", () => {
  assert.equal(isDocEditable({ phase: "post", status: "closed" }), false);
});

test("a doc with no phase recorded (legacy) behaves like a pre-reimbursement doc", () => {
  assert.equal(isDocEditable({ phase: undefined, status: "notified" }), true);
  assert.equal(isDocEditable({ phase: undefined, status: "verified" }), false);
});
