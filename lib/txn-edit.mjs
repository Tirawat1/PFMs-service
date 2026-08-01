// The amount to add to an account's balance when a transaction's amount changes from
// oldAmount to newAmount. An "in" txn contributes its amount directly to the balance,
// so the delta is (newAmount - oldAmount). An "out" txn subtracts its amount, so the
// delta is inverted: -(newAmount - oldAmount).
export function txnAmountDelta({ type, oldAmount, newAmount }) {
  const diff = newAmount - oldAmount;
  return (type === "in" ? diff : -diff) || 0; // avoid -0 on an unchanged "out" amount
}

// Atomically updates a Txn's amount and applies the resulting balance delta to its
// account. No compare-and-swap is needed here (unlike advanceRequestTx) because a Txn
// row carries no workflow status to race against — see this plan's non-goal note on
// concurrent edits of the same row.
export async function editTxnTx(prisma, { id, acctId, streamId, type, oldAmount, newAmount }) {
  const delta = txnAmountDelta({ type, oldAmount, newAmount });
  return prisma.$transaction(async (tx) => {
    await tx.txn.update({ where: { id }, data: { amount: newAmount } });
    if (delta !== 0) {
      await tx.account.update({ where: { id: acctId }, data: { balance: { increment: delta } } });
      if (streamId) {
        await tx.stream.update({ where: { id: streamId }, data: { balance: { increment: delta } } });
      }
    }
    return { delta };
  });
}
