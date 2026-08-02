import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFundsTx } from "../lib/route-funds.mjs";

function makeFakePrisma({ balances, streamBalances }) {
  const state = { balances: { ...balances }, streamBalances: { ...streamBalances }, txns: [], requestUpdates: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        account: {
          update: async ({ where, data }) => {
            if (data.balance.increment != null) state.balances[where.id] += data.balance.increment;
            else state.balances[where.id] -= data.balance.decrement;
          },
        },
        stream: {
          update: async ({ where, data }) => {
            state.streamBalances[where.id] += data.balance.increment;
          },
        },
        txn: { create: async ({ data }) => { state.txns.push(data); } },
        request: { update: async ({ data }) => { state.requestUpdates.push(data); } },
      }),
  };
}

test("moves the amount from Faculty into the purse's account and the purse itself", async () => {
  const prisma = makeFakePrisma({ balances: { faculty: 5000, project: 1000 }, streamBalances: { s_advance: 200 } });
  const result = await routeFundsTx(prisma, {
    reqId: "RB-1", streamId: "s_advance", streamAcctId: "project", amount: 500,
    facultyAcctId: "faculty", title: "Test", by: "Admin", byRole: "Admin",
  });
  assert.equal(result.ok, true);
  assert.equal(prisma.state.balances.faculty, 4500);
  assert.equal(prisma.state.balances.project, 1500);
  assert.equal(prisma.state.streamBalances.s_advance, 700);
  assert.equal(prisma.state.txns.length, 2);
  assert.equal(prisma.state.requestUpdates[0].fundRoute.streamId, "s_advance");
  assert.equal(prisma.state.requestUpdates[0].fundRoute.amount, 500);
});
