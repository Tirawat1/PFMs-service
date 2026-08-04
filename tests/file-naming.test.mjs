import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDriveFileName } from "../lib/file-naming.mjs";

test("builds docName_date_by with the original extension kept", () => {
  const name = buildDriveFileName({ docName: "Receipt", date: new Date("2026-08-03T10:00:00Z"), by: "Somchai", originalName: "scan.pdf" });
  assert.equal(name, "Receipt_2026-08-03_Somchai.pdf");
});

test("keeps Thai characters in the document name and uploader name", () => {
  const name = buildDriveFileName({ docName: "ใบเสร็จรับเงิน", date: new Date("2026-08-03T10:00:00Z"), by: "สมชาย ใจดี", originalName: "img.jpg" });
  assert.equal(name, "ใบเสร็จรับเงิน_2026-08-03_สมชาย-ใจดี.jpg");
});

test("strips filesystem-unsafe characters from both name parts", () => {
  const name = buildDriveFileName({ docName: 'Doc: "final"/v2', date: new Date("2026-08-03T00:00:00Z"), by: "A/B", originalName: "x.docx" });
  assert.equal(name, "Doc-final-v2_2026-08-03_A-B.docx");
});

test("handles a file with no extension", () => {
  const name = buildDriveFileName({ docName: "Receipt", date: new Date("2026-08-03T00:00:00Z"), by: "Admin", originalName: "noext" });
  assert.equal(name, "Receipt_2026-08-03_Admin");
});

test("handles a missing originalName gracefully (no extension)", () => {
  const name = buildDriveFileName({ docName: "Receipt", date: new Date("2026-08-03T00:00:00Z"), by: "Admin", originalName: "" });
  assert.equal(name, "Receipt_2026-08-03_Admin");
});
