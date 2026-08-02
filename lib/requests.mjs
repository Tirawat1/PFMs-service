// Advances a request to `nextStatus`, guarded against a concurrent advance of the
// same request (the status update only applies if `currentStatus` still matches),
// and atomically records the disbursement transaction — debiting the caller-supplied
// `acctId` (and, when a purse is chosen, that `streamId` too) and stamping the request
// with which account paid, the transfer proof, and the route/payee/actual-amount detail
// — when the transition pays out funds.
export async function advanceRequestTx(prisma, { id, currentStatus, nextStatus, isDisbursement, amount, title, acctId, proofLink, streamId, payRoute, payee, payNote, actualAmount }) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.request.updateMany({
      where: { id, status: currentStatus },
      data: { status: nextStatus },
    });
    if (result.count === 0) return { conflict: true };
    if (isDisbursement) {
      await tx.account.update({ where: { id: acctId }, data: { balance: { decrement: amount } } });
      if (streamId) await tx.stream.update({ where: { id: streamId }, data: { balance: { decrement: amount } } });
      await tx.txn.create({ data: { acctId, streamId: streamId || null, type: "out", amount, desc: "Disbursement — " + title } });
      await tx.request.update({ where: { id }, data: { acctId, disburseProofLink: proofLink, streamId: streamId || null, payRoute, payee, payNote, actualAmount } });
    }
    return { conflict: false };
  });
}

const PAY_ROUTES = ["direct", "advance", "selfpay"];

// Validates the payment-route-specific requirements and the officer-editable actual
// amount paid (defaults to the full requested amount; may be less, never more). Pure —
// no I/O — so the RPC route does lookups and this just decides pass/reject.
export function validateDisbursement({ route, payee, payNote, actualAmount, requestAmount }) {
  if (!PAY_ROUTES.includes(route)) return { error: "Invalid payment route." };
  if (route === "selfpay") {
    if (!(payee || "").trim()) return { error: "Enter who will receive the funds." };
    if (!(payNote || "").trim()) return { error: "A note is required for a self-pay disbursement." };
  }
  const actual = actualAmount === undefined || actualAmount === null || actualAmount === "" ? requestAmount : Number(actualAmount);
  if (!Number.isFinite(actual) || actual <= 0) return { error: "Enter a valid actual amount paid." };
  if (actual > requestAmount) return { error: "Actual amount paid cannot exceed the requested amount." };
  return { actual };
}

// Resolves and validates which account a disbursement should be debited from,
// given what the caller explicitly picked, the request's category default, and
// the looked-up Account row (or null if `providedAcctId`/`categoryDefaultAcctId`
// didn't resolve to a real row). Pure — no I/O — so the RPC route does the
// lookups and this just decides pass/reject.
export function resolveDisburseAccount({ providedAcctId, categoryDefaultAcctId, account, proofLink }) {
  const acctId = providedAcctId || categoryDefaultAcctId;
  if (!acctId) return { error: "Select a source account before disbursing." };
  if (!account || account.id !== acctId || !account.active) return { error: "Selected account is not available." };
  const trimmedProof = (proofLink || "").trim();
  if (!trimmedProof) return { error: "Attach a transfer proof link before disbursing." };
  return { acctId, proofLink: trimmedProof };
}
