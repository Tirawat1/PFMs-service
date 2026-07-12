// Advances a request to `nextStatus`, guarded against a concurrent advance of the
// same request (the status update only applies if `currentStatus` still matches),
// and atomically records the disbursement transaction when the transition pays out funds.
export async function advanceRequestTx(prisma, { id, currentStatus, nextStatus, isDisbursement, amount, title }) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.request.updateMany({
      where: { id, status: currentStatus },
      data: { status: nextStatus },
    });
    if (result.count === 0) return { conflict: true };
    if (isDisbursement) {
      await tx.account.update({ where: { id: "project" }, data: { balance: { decrement: amount } } });
      await tx.txn.create({ data: { acctId: "project", type: "out", amount, desc: "Disbursement — " + title } });
    }
    return { conflict: false };
  });
}
