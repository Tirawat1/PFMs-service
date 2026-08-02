// The fields an "undo my last action" restores — deliberately scoped to actions that
// only touch a request's own row (document checklist, discrepancies, bank info, editable
// fields, return-for-correction). Money-moving actions (disbursement, deposits) already
// have dedicated, safer reversal paths (reverseRequest, editRecordAmount,
// deleteTransaction) and are not covered here.
const SNAPSHOT_FIELDS = ["status", "docs", "bank", "issueReason", "title", "categoryId", "amount", "vendor", "desc", "paidVia", "eventDate", "vendorExists"];

export function buildRequestSnapshot(request) {
  const snap = {};
  for (const field of SNAPSHOT_FIELDS) snap[field] = request[field];
  return snap;
}
