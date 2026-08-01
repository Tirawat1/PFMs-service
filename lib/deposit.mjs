// Pays a deposit for a request out of a named purse, debiting both the purse and the
// project account atomically, and stamps the request so the later disbursement step
// knows to deduct only the remaining balance. No compare-and-swap is needed — a request
// can only have one deposit paid in this plan's scope (see the plan's non-goal note),
// and the RPC layer is responsible for rejecting a second attempt before calling this.
export async function payDepositTx(prisma, { reqId, streamId, amount, projectAcctId, title }) {
  return prisma.$transaction(async (tx) => {
    await tx.stream.update({ where: { id: streamId }, data: { balance: { decrement: amount } } });
    await tx.account.update({ where: { id: projectAcctId }, data: { balance: { decrement: amount } } });
    await tx.txn.create({ data: { acctId: projectAcctId, streamId, type: "out", amount, desc: "Deposit — " + title } });
    await tx.request.update({ where: { id: reqId }, data: { depositAmount: amount, depositPaid: true, depositStreamId: streamId } });
    return { ok: true };
  });
}

// The amount still owed once a (possible) deposit is accounted for.
export function remainingAfterDeposit({ requestAmount, depositAmount, depositPaid }) {
  if (!depositPaid) return { amount: requestAmount };
  const remaining = requestAmount - (depositAmount || 0);
  if (remaining <= 0) return { error: "The deposit already covers the full amount — nothing remains to disburse." };
  return { amount: remaining };
}
