import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDocAttachment } from "../lib/attach-doc.mjs";

function doc(overrides) {
  return { name: "Receipt", phase: "pre", submitted: false, link: null, fileName: null, disc: null, ...overrides };
}

test("marks the document submitted with the given link and fileName", () => {
  const docs = [doc()];
  const result = applyDocAttachment(docs, 0, { link: "https://drive.google.com/x", fileName: "receipt.pdf" });
  assert.equal(result.error, undefined);
  assert.deepEqual(docs[0], { name: "Receipt", phase: "pre", submitted: true, link: "https://drive.google.com/x", fileName: "receipt.pdf", disc: null });
});

test("clears an open discrepancy's fixed flag to true when re-attaching", () => {
  const docs = [doc({ disc: { open: true, note: "wrong file", by: "Officer", ts: 1, fixed: false, fixedNote: "" } })];
  applyDocAttachment(docs, 0, { link: "https://drive.google.com/y" });
  assert.equal(docs[0].disc.fixed, true);
  assert.equal(docs[0].disc.open, true, "resolving the discrepancy itself is a separate action");
});

test("returns an error for an out-of-range index", () => {
  const docs = [doc()];
  const result = applyDocAttachment(docs, 5, { link: "https://drive.google.com/x" });
  assert.equal(result.error, "Unknown document.");
});

test("returns an error when no link is given", () => {
  const docs = [doc()];
  const result = applyDocAttachment(docs, 0, { link: "" });
  assert.equal(result.error, "No link to attach.");
});
