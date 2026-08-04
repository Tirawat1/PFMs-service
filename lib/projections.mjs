// Approves a submitted projection, guarded against a concurrent approval of the
// same projection (the status update only applies if `currentStatus` still matches),
// and atomically transfers `amount` from the selected funding account to the Project
// account — mirroring the same compare-and-swap + atomic-ledger pattern as advanceRequestTx.
export async function approveProjectionTx(prisma, { id, currentStatus, amount, fundingAcctId, facultyAcctId, projectAcctId, title }) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.projection.updateMany({
      where: { id, status: currentStatus },
      data: { status: "advanced" },
    });
    if (result.count === 0) return { conflict: true };
    const sourceAcctId = fundingAcctId || facultyAcctId;
    await tx.account.update({ where: { id: sourceAcctId }, data: { balance: { decrement: amount } } });
    await tx.account.update({ where: { id: projectAcctId }, data: { balance: { increment: amount } } });
    await tx.txn.create({ data: { acctId: sourceAcctId, type: "out", amount, desc: "Advance transfer — " + title, internal: true } });
    await tx.txn.create({ data: { acctId: projectAcctId, type: "in", amount, desc: "Advance transfer — " + title, internal: true } });
    return { conflict: false };
  });
}

// Settles an advanced projection once its linked request is disbursed. If the actual
// amount spent is less than what was advanced, the unspent difference moves back from
// the Project account to the funding account atomically with the status transition.
export async function settleProjectionTx(prisma, { id, currentStatus, advancedAmount, actualAmount, fundingAcctId, facultyAcctId, projectAcctId, title }) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.projection.updateMany({
      where: { id, status: currentStatus },
      data: { status: "settled" },
    });
    if (result.count === 0) return { conflict: true, refund: 0 };
    const refund = Math.max(0, advancedAmount - actualAmount);
    if (refund > 0) {
      const sourceAcctId = fundingAcctId || facultyAcctId;
      await tx.account.update({ where: { id: projectAcctId }, data: { balance: { decrement: refund } } });
      await tx.account.update({ where: { id: sourceAcctId }, data: { balance: { increment: refund } } });
      await tx.txn.create({ data: { acctId: projectAcctId, type: "out", amount: refund, desc: "Advance return — " + title, internal: true } });
      await tx.txn.create({ data: { acctId: sourceAcctId, type: "in", amount: refund, desc: "Advance return — " + title, internal: true } });
    }
    return { conflict: false, refund };
  });
}
