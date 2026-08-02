import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTransitionGuards } from "../lib/transition-guards.mjs";

function doc(phase, submitted, disc) {
  return { name: "d", phase, submitted, disc: disc || null };
}

test("blocks docs_submitted when a pre-doc is missing", () => {
  const result = checkTransitionGuards({ next: "docs_submitted", docs: [doc("pre", true), doc("pre", false)], requireCompletionDocs: false });
  assert.equal(result.error, "All pre-reimbursement documents must be submitted before this step.");
});

test("allows docs_submitted when all pre-docs are submitted", () => {
  const result = checkTransitionGuards({ next: "docs_submitted", docs: [doc("pre", true), doc("pre", true)], requireCompletionDocs: false });
  assert.deepEqual(result, { ok: true });
});

test("blocks verified when a pre-doc is missing", () => {
  const result = checkTransitionGuards({ next: "verified", docs: [doc("pre", false)], requireCompletionDocs: false });
  assert.equal(result.error, "All pre-reimbursement documents must be submitted before this step.");
});

test("blocks verified when a discrepancy is still open", () => {
  const result = checkTransitionGuards({ next: "verified", docs: [doc("pre", true, { open: true })], requireCompletionDocs: false });
  assert.equal(result.error, "Resolve all open discrepancies before verifying this request.");
});

test("allows verified when the discrepancy has been fixed (not open)", () => {
  const result = checkTransitionGuards({ next: "verified", docs: [doc("pre", true, { open: false, fixed: true })], requireCompletionDocs: false });
  assert.deepEqual(result, { ok: true });
});

test("allows purchase_complete regardless of post-docs when requireCompletionDocs is false", () => {
  const result = checkTransitionGuards({ next: "purchase_complete", docs: [doc("post", false)], requireCompletionDocs: false });
  assert.deepEqual(result, { ok: true });
});

test("blocks purchase_complete when requireCompletionDocs is true and a post-doc is missing", () => {
  const result = checkTransitionGuards({ next: "purchase_complete", docs: [doc("post", false)], requireCompletionDocs: true });
  assert.equal(result.error, "All closing documents must be submitted before marking the purchase complete.");
});

test("allows purchase_complete when requireCompletionDocs is true and all post-docs are submitted", () => {
  const result = checkTransitionGuards({ next: "purchase_complete", docs: [doc("post", true)], requireCompletionDocs: true });
  assert.deepEqual(result, { ok: true });
});

test("blocks closed unconditionally when a post-doc is missing", () => {
  const result = checkTransitionGuards({ next: "closed", docs: [doc("post", false)], requireCompletionDocs: false });
  assert.equal(result.error, "All closing documents must be submitted before closing this request.");
});

test("allows closed when all post-docs are submitted", () => {
  const result = checkTransitionGuards({ next: "closed", docs: [doc("post", true)], requireCompletionDocs: false });
  assert.deepEqual(result, { ok: true });
});

test("a request with no documents at all in a phase does not block on that phase (vacuously satisfied)", () => {
  const result = checkTransitionGuards({ next: "closed", docs: [doc("pre", true)], requireCompletionDocs: false });
  assert.deepEqual(result, { ok: true });
});

test("does not block transitions the guard doesn't apply to (disbursed) regardless of doc state", () => {
  const result = checkTransitionGuards({ next: "disbursed", docs: [doc("pre", false), doc("post", false)], requireCompletionDocs: true });
  assert.deepEqual(result, { ok: true });
});
