// Manually transfers `amount` from the Faculty account into a chosen Project purse and
// stamps the request with the routing detail — an admin-only alternative to the
// projection/advance flow for requests that still need Faculty money moved into a purse
// before disbursement.
export async function routeFundsTx(prisma, { reqId, streamId, streamAcctId, amount, facultyAcctId, title, by, byRole }) {
  return prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: facultyAcctId }, data: { balance: { decrement: amount } } });
    await tx.account.update({ where: { id: streamAcctId }, data: { balance: { increment: amount } } });
    await tx.stream.update({ where: { id: streamId }, data: { balance: { increment: amount } } });
    await tx.txn.create({ data: { acctId: facultyAcctId, type: "out", amount, desc: "Fund routing — " + title, internal: true } });
    await tx.txn.create({ data: { acctId: streamAcctId, streamId, type: "in", amount, desc: "Fund routing — " + title, internal: true } });
    await tx.request.update({ where: { id: reqId }, data: { fundRoute: { streamId, amount, by, byRole, ts: Date.now() } } });
    return { ok: true };
  });
}
