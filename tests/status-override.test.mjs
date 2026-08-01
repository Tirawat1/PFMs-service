import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStatusOverride } from "../lib/status-override.mjs";

test("a migration operator can set any non-empty status", () => {
  assert.deepEqual(applyStatusOverride({ isMigrationOperator: true, chosenStatus: "closed" }), { ok: true });
});

test("a non-migration-operator is rejected regardless of the chosen status", () => {
  const result = applyStatusOverride({ isMigrationOperator: false, chosenStatus: "closed" });
  assert.equal(result.error, "Only a data-migration operator can set status directly.");
});

test("an empty chosen status is rejected even for a migration operator", () => {
  const result = applyStatusOverride({ isMigrationOperator: true, chosenStatus: "" });
  assert.equal(result.error, "Choose a status.");
});
