import { test } from "node:test";
import assert from "node:assert/strict";
import { txnAmountDelta, editTxnTx } from "../lib/txn-edit.mjs";

test("increasing an 'in' transaction increases the balance by the difference", () => {
  assert.equal(txnAmountDelta({ type: "in", oldAmount: 1000, newAmount: 1500 }), 500);
});

test("decreasing an 'in' transaction decreases the balance by the difference", () => {
  assert.equal(txnAmountDelta({ type: "in", oldAmount: 1000, newAmount: 100 }), -900);
});

test("increasing an 'out' transaction decreases the balance by the difference", () => {
  assert.equal(txnAmountDelta({ type: "out", oldAmount: 1000, newAmount: 10000 }), -9000);
});

test("decreasing an 'out' transaction increases the balance by the difference", () => {
  assert.equal(txnAmountDelta({ type: "out", oldAmount: 1000, newAmount: 100 }), 900);
});

test("an unchanged amount produces a zero delta", () => {
  assert.equal(txnAmountDelta({ type: "in", oldAmount: 500, newAmount: 500 }), 0);
  assert.equal(txnAmountDelta({ type: "out", oldAmount: 500, newAmount: 500 }), 0);
});

function makeFakePrisma({ balance }) {
  const state = { balance, txnUpdates: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        txn: {
          update: async ({ data }) => {
            state.txnUpdates.push(data);
          },
        },
        account: {
          update: async ({ data }) => {
            state.balance += data.balance.increment;
          },
        },
      }),
  };
}

test("editTxnTx updates the txn amount and adjusts the account balance atomically", async () => {
  const prisma = makeFakePrisma({ balance: 5000 });
  const result = await editTxnTx(prisma, { id: "t1", acctId: "faculty", type: "out", oldAmount: 1000, newAmount: 100 });
  assert.equal(result.delta, 900);
  assert.equal(prisma.state.balance, 5900);
  assert.equal(prisma.state.txnUpdates.length, 1);
  assert.deepEqual(prisma.state.txnUpdates[0], { amount: 100 });
});

test("editTxnTx also adjusts a purse balance when the transaction is tagged with a streamId", async () => {
  const state = { balance: 5000, streamBalance: 800, txnUpdates: [] };
  const prisma = {
    state,
    $transaction: async (fn) =>
      fn({
        txn: { update: async ({ data }) => { state.txnUpdates.push(data); } },
        account: { update: async ({ data }) => { state.balance += data.balance.increment; } },
        stream: { update: async ({ data }) => { state.streamBalance += data.balance.increment; } },
      }),
  };
  const result = await editTxnTx(prisma, { id: "t1", acctId: "project", streamId: "s_advance", type: "in", oldAmount: 300, newAmount: 500 });
  assert.equal(result.delta, 200);
  assert.equal(state.balance, 5200);
  assert.equal(state.streamBalance, 1000);
});
