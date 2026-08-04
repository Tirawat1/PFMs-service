// Builds the name a real uploaded file gets in Drive: "<document type>_<date>_<who
// uploaded it>.<original extension>" — e.g. "ใบเสร็จรับเงิน_2026-08-03_Somchai.pdf" — so
// files are identifiable from their name alone in the Drive folder, without opening them.
function sanitizeForFileName(s) {
  return (s || "").trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-");
}

export function buildDriveFileName({ docName, date, by, originalName }) {
  const ext = (originalName || "").match(/\.[^./\\]+$/);
  const dateStr = date.toISOString().slice(0, 10);
  return [sanitizeForFileName(docName), dateStr, sanitizeForFileName(by)].join("_") + (ext ? ext[0] : "");
}
