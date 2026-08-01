// Marks a projected revenue as received, guarded against a concurrent receive of the
// same revenue (compare-and-swap on status), and atomically credits the target account
// — and, if the revenue is assigned to a purse, that purse's running balance too.
export async function receiveRevenueTx(prisma, { id, currentStatus, amount, acctId, streamId, title }) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.revenue.updateMany({
      where: { id, status: currentStatus },
      data: { status: "received", receivedAt: new Date() },
    });
    if (result.count === 0) return { conflict: true };
    await tx.account.update({ where: { id: acctId }, data: { balance: { increment: amount } } });
    if (streamId) {
      await tx.stream.update({ where: { id: streamId }, data: { balance: { increment: amount } } });
    }
    await tx.txn.create({ data: { acctId, streamId: streamId || null, type: "in", amount, desc: "Revenue — " + title } });
    return { conflict: false };
  });
}
