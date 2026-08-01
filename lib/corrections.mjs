// Directly overwrites one numeric field on one of five kinds of record. Two shapes:
// - "account"/"stream": the field IS the running balance, so this is the balance itself
//   being corrected — no separate ledger entry to reconcile.
// - "request"/"projection"/"revenue": the field is a plain amount with no independent
//   ledger — correcting it has no knock-on balance effect, unlike a Txn (see
//   lib/txn-edit.mjs, which is deliberately kept separate because IT does have a
//   balance side effect).
export async function editAmountTx(prisma, { kind, id, field, newValue }) {
  return prisma.$transaction(async (tx) => {
    if (kind === "account") await tx.account.update({ where: { id }, data: { [field]: newValue } });
    else if (kind === "stream") await tx.stream.update({ where: { id }, data: { [field]: newValue } });
    else if (kind === "request") await tx.request.update({ where: { id }, data: { [field]: newValue } });
    else if (kind === "projection") await tx.projection.update({ where: { id }, data: { [field]: newValue } });
    else if (kind === "revenue") await tx.revenue.update({ where: { id }, data: { [field]: newValue } });
    else throw new Error("Unknown correction kind: " + kind);
    return { ok: true };
  });
}

// Deletes a transaction outright, reversing its effect on the account balance (and the
// purse balance, if it was tagged with one) before removing the row.
export async function deleteTxnTx(prisma, { id }) {
  return prisma.$transaction(async (tx) => {
    const txn = await tx.txn.findUnique({ where: { id } });
    if (!txn) return { ok: true };
    const sign = txn.type === "in" ? -1 : 1;
    await tx.account.update({ where: { id: txn.acctId }, data: { balance: { increment: sign * txn.amount } } });
    if (txn.streamId) {
      await tx.stream.update({ where: { id: txn.streamId }, data: { balance: { increment: sign * txn.amount } } });
    }
    await tx.txn.delete({ where: { id } });
    return { ok: true };
  });
}
