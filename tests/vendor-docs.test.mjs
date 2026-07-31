import { test } from "node:test";
import assert from "node:assert/strict";
import { addVendorDocs } from "../lib/vendor-docs.mjs";

test("appends vendor docs not already present, in fresh unsubmitted shape", () => {
  const existing = [{ name: "ใบเสร็จรับเงิน", submitted: true, link: "https://x", fileName: "a.pdf", disc: null }];
  const result = addVendorDocs(existing, ["ข้อมูลผู้ขาย / Vendor details", "ใบเสนอราคา"]);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], existing[0]);
  assert.deepEqual(result[1], { name: "ข้อมูลผู้ขาย / Vendor details", submitted: false, link: null, fileName: null, disc: null, vendorDoc: true });
  assert.deepEqual(result[2], { name: "ใบเสนอราคา", submitted: false, link: null, fileName: null, disc: null, vendorDoc: true });
});

test("does not duplicate a vendor doc that already exists on the request by name", () => {
  const existing = [{ name: "ข้อมูลผู้ขาย / Vendor details", submitted: false, link: null, fileName: null, disc: null }];
  const result = addVendorDocs(existing, ["ข้อมูลผู้ขาย / Vendor details", "ใบเสนอราคา"]);
  assert.equal(result.length, 2);
  assert.equal(result.filter((d) => d.name === "ข้อมูลผู้ขาย / Vendor details").length, 1);
});

test("returns the existing array unchanged (new array, same entries) when there are no vendor docs configured", () => {
  const existing = [{ name: "ใบเสร็จรับเงิน", submitted: true, link: "https://x", fileName: "a.pdf", disc: null }];
  const result = addVendorDocs(existing, []);
  assert.deepEqual(result, existing);
  assert.notEqual(result, existing, "must return a new array, not mutate the input");
});
