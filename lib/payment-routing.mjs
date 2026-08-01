// Whether a user may approve/verify a request or projection tied to a given category.
// admin always passes. Otherwise, the base requirement is the existing "verify"
// permission (unchanged everywhere else in the app) — this only adds a NARROWER check
// on top: if the acting role has declared an approverKey, it must match the category's
// approverRole. Roles with no approverKey (the common case — most roles don't represent
// a specific approver track) are unaffected and fall back to the plain verify check, so
// this never locks an unrouted category away from its existing verifiers.
export function canApproveCategory({ admin, hasVerifyPerm, roleApproverKey, categoryApproverRole }) {
  if (admin) return true;
  if (!hasVerifyPerm) return false;
  if (!roleApproverKey) return true;
  return roleApproverKey === categoryApproverRole;
}
