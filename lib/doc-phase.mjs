// Whether a single document on a request's checklist can currently be attached/detached.
// Pre-reimbursement docs lock once the request moves past docs_submitted (an officer has
// started verifying — the paper trail up to that point must not change under them).
// Closing docs are the opposite: irrelevant (and locked) until funds are disbursed, then
// open through purchase_complete, then lock again once the request is fully closed.
const PRE_EDITABLE = new Set(["notified", "docs_submitted"]);
const POST_EDITABLE = new Set(["disbursed", "purchase_complete"]);

export function isDocEditable({ phase, status }) {
  if (phase === "post") return POST_EDITABLE.has(status);
  return PRE_EDITABLE.has(status);
}
