// Decides whether a reimbursement request may be submitted, and whether it should be
// tagged as a direct claim. Pure — no I/O — the RPC route does the Projection lookup
// and category read, this just applies the rule.
export function resolveRequestSource({ projectionId, projectionStatus, categoryAllowDirect }) {
  if (projectionId) {
    if (projectionStatus !== "advanced") return { error: "This projection has no available advance." };
    return { directClaim: false };
  }
  if (!categoryAllowDirect) {
    return { error: "This category requires a projected expense with an issued advance, or must be marked to allow direct reimbursement." };
  }
  return { directClaim: true };
}
