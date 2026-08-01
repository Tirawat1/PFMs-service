import { test } from "node:test";
import assert from "node:assert/strict";
import { editAmountTx, deleteTxnTx } from "../lib/corrections.mjs";

function makeFakePrisma() {
  const state = { account: null, stream: null, request: null, projection: null, revenue: null, txns: [{ id: "t1", acctId: "project", type: "out", amount: 500 }], accountBalance: 1000 };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        account: {
          update: async ({ where, data }) => {
            if (data.balance && typeof data.balance === "object" && "increment" in data.balance) {
              state.accountBalance += data.balance.increment;
            } else {
              state.account = { id: where.id, balance: data.balance };
              state.accountBalance = data.balance;
            }
          },
        },
        stream: {
          update: async ({ where, data }) => { state.stream = { id: where.id, balance: data.balance }; },
        },
        request: {
          update: async ({ where, data }) => { state.request = { id: where.id, ...data }; },
        },
        projection: {
          update: async ({ where, data }) => { state.projection = { id: where.id, ...data }; },
        },
        revenue: {
          update: async ({ where, data }) => { state.revenue = { id: where.id, ...data }; },
        },
        txn: {
          findUnique: async ({ where }) => state.txns.find((t) => t.id === where.id) || null,
          delete: async ({ where }) => { state.txns = state.txns.filter((t) => t.id !== where.id); },
        },
      }),
  };
}

test("editAmountTx directly sets an account's balance", async () => {
  const prisma = makeFakePrisma();
  await editAmountTx(prisma, { kind: "account", id: "faculty", field: "balance", newValue: 9000 });
  assert.deepEqual(prisma.state.account, { id: "faculty", balance: 9000 });
});

test("editAmountTx directly sets a purse's balance", async () => {
  const prisma = makeFakePrisma();
  await editAmountTx(prisma, { kind: "stream", id: "s_advance", field: "balance", newValue: 4000 });
  assert.deepEqual(prisma.state.stream, { id: "s_advance", balance: 4000 });
});

test("editAmountTx directly sets a request's amount field with no balance side effect", async () => {
  const prisma = makeFakePrisma();
  await editAmountTx(prisma, { kind: "request", id: "RB-1042", field: "amount", newValue: 18000 });
  assert.deepEqual(prisma.state.request, { id: "RB-1042", amount: 18000 });
  assert.equal(prisma.state.accountBalance, 1000, "correcting a request amount must not touch any account balance");
});

test("editAmountTx works for projection and revenue amounts the same way", async () => {
  const prisma = makeFakePrisma();
  await editAmountTx(prisma, { kind: "projection", id: "PJ-2000", field: "amount", newValue: 250 });
  assert.deepEqual(prisma.state.projection, { id: "PJ-2000", amount: 250 });
  await editAmountTx(prisma, { kind: "revenue", id: "RV-3000", field: "amount", newValue: 6000 });
  assert.deepEqual(prisma.state.revenue, { id: "RV-3000", amount: 6000 });
});

test("editAmountTx rejects an unknown kind rather than silently doing nothing", async () => {
  const prisma = makeFakePrisma();
  await assert.rejects(() => editAmountTx(prisma, { kind: "bogus", id: "x", field: "amount", newValue: 1 }));
});

test("deleteTxnTx reverses the balance and removes the row for an 'out' transaction", async () => {
  const prisma = makeFakePrisma();
  await deleteTxnTx(prisma, { id: "t1" });
  assert.equal(prisma.state.txns.length, 0);
  assert.equal(prisma.state.accountBalance, 1500, "deleting an 'out' txn of 500 must add 500 back to the account");
});
