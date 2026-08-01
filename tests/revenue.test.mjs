import { test } from "node:test";
import assert from "node:assert/strict";
import { receiveRevenueTx } from "../lib/revenue.mjs";

function makeFakePrisma({ status, balances, streamBalances }) {
  const state = { status, balances: { ...balances }, streamBalances: { ...(streamBalances || {}) }, txns: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        revenue: {
          updateMany: async ({ where, data }) => {
            if (where.status !== state.status) return { count: 0 };
            state.status = data.status;
            return { count: 1 };
          },
        },
        account: {
          update: async ({ where, data }) => {
            if (data.balance?.increment != null) state.balances[where.id] = (state.balances[where.id] || 0) + data.balance.increment;
          },
        },
        stream: {
          update: async ({ where, data }) => {
            if (data.balance?.increment != null) state.streamBalances[where.id] = (state.streamBalances[where.id] || 0) + data.balance.increment;
          },
        },
        txn: {
          create: async ({ data }) => {
            state.txns.push(data);
          },
        },
      }),
  };
}

test("receiving a projected revenue with a stream credits both the account and the purse", async () => {
  const prisma = makeFakePrisma({ status: "projected", balances: { project: 1000 }, streamBalances: { s_general: 200 } });
  const result = await receiveRevenueTx(prisma, {
    id: "RV-3000", currentStatus: "projected", amount: 500,
    acctId: "project", streamId: "s_general", title: "Sponsorship — Acme Co.",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.status, "received");
  assert.equal(prisma.state.balances.project, 1500);
  assert.equal(prisma.state.streamBalances.s_general, 700);
  assert.equal(prisma.state.txns.length, 1);
  assert.equal(prisma.state.txns[0].acctId, "project");
  assert.equal(prisma.state.txns[0].streamId, "s_general");
  assert.equal(prisma.state.txns[0].type, "in");
});

test("receiving a revenue with no stream only credits the account", async () => {
  const prisma = makeFakePrisma({ status: "projected", balances: { project: 1000 } });
  const result = await receiveRevenueTx(prisma, {
    id: "RV-3000", currentStatus: "projected", amount: 500,
    acctId: "project", streamId: null, title: "Registration fees",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.balances.project, 1500);
  assert.deepEqual(prisma.state.streamBalances, {});
  assert.equal(prisma.state.txns[0].streamId, null);
});

test("a stale receive (already received) is rejected as a conflict, not double-applied", async () => {
  const prisma = makeFakePrisma({ status: "received", balances: { project: 1500 } });
  const result = await receiveRevenueTx(prisma, {
    id: "RV-3000", currentStatus: "projected", amount: 500,
    acctId: "project", streamId: null, title: "Registration fees",
  });
  assert.equal(result.conflict, true);
  assert.equal(prisma.state.balances.project, 1500, "balance must not move on a rejected conflict");
  assert.equal(prisma.state.txns.length, 0);
});
