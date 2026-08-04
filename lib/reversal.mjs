// Steps a request one status backward, guarded against a concurrent change (the status
// update only applies if `currentStatus` still matches), and unwinds whatever side
// effect the forward step into `currentStatus` caused:
//  - leaving "disbursed": returns the disbursed amount to the account (and purse) it
//    came from, undoes any advance-settlement refund already sent to Faculty, and
//    clears the disbursement fields the request was stamped with.
//  - leaving "verified": clears an issued purchase order (POs only exist from
//    verification onward).
//  - leaving "closed": re-opens the linked advance projection (settled -> linked).
export async function reverseRequestTx(prisma, {
  id, currentStatus, prevStatus, acctId, streamId, disbursedAmount, refundAmount,
  facultyAcctId, refundAcctId, projectAcctId, projectionId,
}) {
  return prisma.$transaction(async (tx) => {
    const clearsDisbursement = currentStatus === "disbursed";
    const result = await tx.request.updateMany({
      where: { id, status: currentStatus },
      data: {
        status: prevStatus,
        ...(clearsDisbursement
          ? { acctId: null, disburseProofLink: "", streamId: null, payRoute: "direct", payee: "", payNote: "", actualAmount: null, refundAmount: 0, payProof: null }
          : {}),
        ...(currentStatus === "verified" ? { po: null } : {}),
      },
    });
    if (result.count === 0) return { conflict: true };

    if (clearsDisbursement) {
      if (acctId) await tx.account.update({ where: { id: acctId }, data: { balance: { increment: disbursedAmount } } });
      if (streamId) await tx.stream.update({ where: { id: streamId }, data: { balance: { increment: disbursedAmount } } });
      await tx.txn.create({ data: { acctId, streamId: streamId || null, type: "in", amount: disbursedAmount, desc: "Reversal — " + id } });
      if (refundAmount > 0) {
        const projection = projectionId ? await tx.projection.findUnique({ where: { id: projectionId } }) : null;
        const sourceAcctId = projection?.fundingAcctId || refundAcctId || facultyAcctId;
        await tx.account.update({ where: { id: sourceAcctId }, data: { balance: { decrement: refundAmount } } });
        await tx.account.update({ where: { id: projectAcctId }, data: { balance: { increment: refundAmount } } });
        await tx.txn.create({ data: { acctId: sourceAcctId, type: "out", amount: refundAmount, desc: "Reversal (advance return undone) — " + id, internal: true } });
        await tx.txn.create({ data: { acctId: projectAcctId, type: "in", amount: refundAmount, desc: "Reversal (advance return undone) — " + id, internal: true } });
      }
    }
    if (currentStatus === "closed" && projectionId) {
      await tx.projection.updateMany({ where: { id: projectionId, status: "settled" }, data: { status: "linked" } });
    }
    return { conflict: false };
  });
}
