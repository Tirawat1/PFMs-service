import { test } from "node:test";
import assert from "node:assert/strict";
import { canEditRequest, mergeDocsForCategoryChange } from "../lib/edit-request.mjs";

test("the requester can edit their own request", () => {
  assert.equal(canEditRequest({ admin: false, requesterId: "u1", userId: "u1", status: "notified" }), true);
});

test("a different user cannot edit someone else's request", () => {
  assert.equal(canEditRequest({ admin: false, requesterId: "u1", userId: "u2", status: "notified" }), false);
});

test("admin can edit any request regardless of requester", () => {
  assert.equal(canEditRequest({ admin: true, requesterId: "u1", userId: "u2", status: "notified" }), true);
});

test("a closed request cannot be edited even by admin", () => {
  assert.equal(canEditRequest({ admin: true, requesterId: "u1", userId: "u1", status: "closed" }), false);
});

test("mergeDocsForCategoryChange preserves a submitted doc still required under the new category", () => {
  const current = [{ name: "Receipt", phase: "pre", submitted: true, link: "https://x", fileName: null, disc: null }];
  const result = mergeDocsForCategoryChange(current, ["Receipt"], []);
  assert.deepEqual(result, [{ name: "Receipt", phase: "pre", submitted: true, link: "https://x", fileName: null, disc: null }]);
});

test("mergeDocsForCategoryChange drops a doc no longer required and adds a fresh entry for a newly required one", () => {
  const current = [{ name: "Old doc", phase: "pre", submitted: true, link: "https://x", fileName: null, disc: null }];
  const result = mergeDocsForCategoryChange(current, ["New doc"], []);
  assert.deepEqual(result, [{ name: "New doc", phase: "pre", submitted: false, link: null, fileName: null, disc: null }]);
});

test("mergeDocsForCategoryChange handles both pre and post phases independently", () => {
  const current = [
    { name: "A", phase: "pre", submitted: true, link: "l", fileName: null, disc: null },
    { name: "B", phase: "post", submitted: false, link: null, fileName: null, disc: null },
  ];
  const result = mergeDocsForCategoryChange(current, ["A"], ["B", "C"]);
  assert.deepEqual(result, [
    { name: "A", phase: "pre", submitted: true, link: "l", fileName: null, disc: null },
    { name: "B", phase: "post", submitted: false, link: null, fileName: null, disc: null },
    { name: "C", phase: "post", submitted: false, link: null, fileName: null, disc: null },
  ]);
});
