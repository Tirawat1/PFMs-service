import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotificationRef } from "../lib/notification-ref.mjs";

test("parses a request reference at the start of the text", () => {
  assert.deepEqual(parseNotificationRef("RB-1042 — Funds Disbursed."), { id: "RB-1042", kind: "request" });
});

test("parses a projection reference", () => {
  assert.deepEqual(parseNotificationRef("PJ-2004 advance issued — 1,000.00 transferred Faculty → Project."), { id: "PJ-2004", kind: "projection" });
});

test("parses a revenue reference", () => {
  assert.deepEqual(parseNotificationRef("RV-3001 — revenue received: 500.00."), { id: "RV-3001", kind: "revenue" });
});

test("returns null when no reference is present", () => {
  assert.equal(parseNotificationRef("Your settings were updated."), null);
});

test("returns null for an empty or missing text", () => {
  assert.equal(parseNotificationRef(""), null);
  assert.equal(parseNotificationRef(undefined), null);
});
