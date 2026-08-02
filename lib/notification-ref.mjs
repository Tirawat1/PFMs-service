// Every notification's text is generated server-side with the affected record's id at
// the front (e.g. "RB-1042 — Funds Disbursed."), so a notification can be made
// clickable without a dedicated stored field — just recover the id (and which screen it
// belongs to) out of the text.
const KIND_BY_PREFIX = { RB: "request", PJ: "projection", RV: "revenue" };

export function parseNotificationRef(text) {
  const m = /\b(RB|PJ|RV)-\d+\b/.exec(text || "");
  if (!m) return null;
  return { id: m[0], kind: KIND_BY_PREFIX[m[1]] };
}
