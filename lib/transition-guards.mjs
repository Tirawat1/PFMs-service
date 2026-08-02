// Guards a forward status transition against an incomplete document checklist or an
// unresolved discrepancy — pure, no I/O, so the RPC route supplies the request's docs
// and the category's requireCompletionDocs flag and this just decides pass/reject.
export function checkTransitionGuards({ next, docs, requireCompletionDocs }) {
  const pre = docs.filter((d) => d.phase === "pre");
  const post = docs.filter((d) => d.phase === "post");

  if (["docs_submitted", "verified"].includes(next) && !pre.every((d) => d.submitted)) {
    return { error: "All pre-reimbursement documents must be submitted before this step." };
  }
  if (next === "verified" && docs.some((d) => d.disc && d.disc.open)) {
    return { error: "Resolve all open discrepancies before verifying this request." };
  }
  if (next === "purchase_complete" && requireCompletionDocs && !post.every((d) => d.submitted)) {
    return { error: "All closing documents must be submitted before marking the purchase complete." };
  }
  if (next === "closed" && !post.every((d) => d.submitted)) {
    return { error: "All closing documents must be submitted before closing this request." };
  }
  return { ok: true };
}
