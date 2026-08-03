// The actual "mark a checklist document submitted" mutation — shared by the attachDoc
// RPC action (pasted link) and the Drive upload endpoint (real file), so the two entry
// points can't silently diverge on what "submitted" means. Mutates `docs[idx]` in place
// (matching the existing docs-array mutation pattern) and returns it, or an error.
export function applyDocAttachment(docs, idx, { link, fileName }) {
  const doc = docs[idx];
  if (!doc) return { error: "Unknown document." };
  if (!link) return { error: "No link to attach." };
  doc.submitted = true;
  doc.link = link;
  doc.fileName = fileName || null;
  if (doc.disc && doc.disc.open) doc.disc.fixed = true;
  return { doc };
}
