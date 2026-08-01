// A whole request may only be returned for correction once there is something to
// review (docs_submitted) and no later than verification (verified) — once disbursed,
// money has moved and a return-for-correction no longer makes sense; use the existing
// per-document discrepancy flow, or an explicit reversal, instead.
const RETURNABLE_STATUSES = new Set(["docs_submitted", "verified"]);

export function canReturnForCorrection({ status, reason }) {
  if ((reason || "").trim().length < 5) return { error: "Enter a clear correction reason." };
  if (!RETURNABLE_STATUSES.has(status)) return { error: "This request cannot be returned for correction from its current status." };
  return { ok: true };
}
