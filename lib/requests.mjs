// Advances a request to `nextStatus`, guarded against a concurrent advance of the
// same request (the status update only applies if `currentStatus` still matches),
// and atomically records the disbursement transaction — debiting the caller-supplied
// `acctId` and stamping the request with which account paid and the transfer proof —
// when the transition pays out funds.
export async function advanceRequestTx(prisma, { id, currentStatus, nextStatus, isDisbursement, amount, title, acctId, proofLink }) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.request.updateMany({
      where: { id, status: currentStatus },
      data: { status: nextStatus },
    });
    if (result.count === 0) return { conflict: true };
    if (isDisbursement) {
      await tx.account.update({ where: { id: acctId }, data: { balance: { decrement: amount } } });
      await tx.txn.create({ data: { acctId, type: "out", amount, desc: "Disbursement — " + title } });
      await tx.request.update({ where: { id }, data: { acctId, disburseProofLink: proofLink } });
    }
    return { conflict: false };
  });
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
