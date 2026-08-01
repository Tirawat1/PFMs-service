// Rejects submission when the category demands a vendor and none was given. Pure — no
// I/O — the RPC route reads Category.vendorRequired and body.vendor, this just applies
// the rule.
export function validateVendorAtSubmission({ categoryVendorRequired, vendor }) {
  if (categoryVendorRequired && !(vendor || "").trim()) {
    return { error: "This category requires a vendor — enter vendor details." };
  }
  return { ok: true };
}
