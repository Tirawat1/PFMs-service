// Whether the given user may edit a request's core fields (title, category, amount,
// event date, paidVia, vendor, description) — the requester or admin, and only before
// the request is closed (closed requests are historical record).
export function canEditRequest({ admin, requesterId, userId, status }) {
  if (status === "closed") return false;
  return admin || requesterId === userId;
}

// Rebuilds the document checklist after a category change — preserves the existing
// entry (submitted state, link, discrepancy) for any doc name still required in the
// same phase, drops entries no longer required, and adds a fresh unsubmitted entry for
// anything newly required. Pure — returns a new array, never mutates `currentDocs`.
export function mergeDocsForCategoryChange(currentDocs, newDocsPre, newDocsPost) {
  const byKey = new Map(currentDocs.map((d) => [d.phase + "::" + d.name, d]));
  const build = (names, phase) =>
    names.map((name) => byKey.get(phase + "::" + name) || { name, phase, submitted: false, link: null, fileName: null, disc: null });
  return [...build(newDocsPre, "pre"), ...build(newDocsPost, "post")];
}
