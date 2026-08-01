import { test } from "node:test";
import assert from "node:assert/strict";
import { payDepositTx, remainingAfterDeposit } from "../lib/deposit.mjs";

function makeFakePrisma({ streamBalance, acctBalance, request }) {
  const state = { streamBalance, acctBalance, request: { ...request }, txns: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        stream: { update: async ({ data }) => { state.streamBalance -= data.balance.decrement; } },
        account: { update: async ({ data }) => { state.acctBalance -= data.balance.decrement; } },
        txn: { create: async ({ data }) => { state.txns.push(data); } },
        request: { update: async ({ data }) => { Object.assign(state.request, data); } },
      }),
  };
}

test("paying a deposit debits the purse and the project account and stamps the request", async () => {
  const prisma = makeFakePrisma({ streamBalance: 5000, acctBalance: 20000, request: { depositPaid: false } });
  await payDepositTx(prisma, { reqId: "RB-1042", streamId: "s_advance", amount: 3000, projectAcctId: "project", title: "Venue booking" });
  assert.equal(prisma.state.streamBalance, 2000);
  assert.equal(prisma.state.acctBalance, 17000);
  assert.equal(prisma.state.txns.length, 1);
  assert.equal(prisma.state.txns[0].type, "out");
  assert.equal(prisma.state.txns[0].streamId, "s_advance");
  assert.deepEqual(prisma.state.request, { depositPaid: true, depositAmount: 3000, depositStreamId: "s_advance" });
});

test("remainingAfterDeposit subtracts the deposit from the full request amount", () => {
  const result = remainingAfterDeposit({ requestAmount: 10000, depositAmount: 3000, depositPaid: true });
  assert.deepEqual(result, { amount: 7000 });
});

test("remainingAfterDeposit returns the full amount when no deposit was paid", () => {
  const result = remainingAfterDeposit({ requestAmount: 10000, depositAmount: null, depositPaid: false });
  assert.deepEqual(result, { amount: 10000 });
});

test("remainingAfterDeposit rejects a deposit that would leave nothing (or less) to disburse", () => {
  const result = remainingAfterDeposit({ requestAmount: 10000, depositAmount: 10000, depositPaid: true });
  assert.equal(result.error, "The deposit already covers the full amount — nothing remains to disburse.");
  const over = remainingAfterDeposit({ requestAmount: 10000, depositAmount: 12000, depositPaid: true });
  assert.equal(over.error, "The deposit already covers the full amount — nothing remains to disburse.");
});
