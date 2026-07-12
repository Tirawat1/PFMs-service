import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceRequestTx } from "../lib/requests.mjs";

// Fakes a single-row compare-and-swap the way `UPDATE ... WHERE id=? AND status=?`
// behaves atomically in Postgres — the check and the write happen as one step.
function makeFakePrisma({ status, balance }) {
  const state = { status, balance, txns: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        request: {
          updateMany: async ({ where, data }) => {
            if (where.status !== state.status) return { count: 0 };
            state.status = data.status;
            return { count: 1 };
          },
        },
        account: {
          update: async ({ data }) => {
            state.balance -= data.balance.decrement;
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

test("advances status and disburses funds exactly once", async () => {
  const prisma = makeFakePrisma({ status: "verified", balance: 1000 });
  const result = await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.status, "disbursed");
  assert.equal(prisma.state.balance, 900);
  assert.equal(prisma.state.txns.length, 1);
});

test("advancing a non-disbursement step does not touch the account", async () => {
  const prisma = makeFakePrisma({ status: "docs_submitted", balance: 1000 });
  const result = await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "docs_submitted", nextStatus: "verified",
    isDisbursement: false, amount: 100, title: "Test",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.balance, 1000);
  assert.equal(prisma.state.txns.length, 0);
});

test("a stale advance (status already moved on) is rejected as a conflict, not double-applied", async () => {
  const prisma = makeFakePrisma({ status: "disbursed", balance: 900 });
  const result = await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test",
  });
  assert.equal(result.conflict, true);
  assert.equal(prisma.state.balance, 900, "balance must not move on a rejected conflict");
  assert.equal(prisma.state.txns.length, 0);
});

test("two concurrent disbursement attempts only apply once", async () => {
  const prisma = makeFakePrisma({ status: "verified", balance: 1000 });
  const args = {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test",
  };
  const [a, b] = await Promise.all([
    advanceRequestTx(prisma, args),
    advanceRequestTx(prisma, args),
  ]);
  const conflicts = [a.conflict, b.conflict].filter(Boolean).length;
  assert.equal(conflicts, 1, "exactly one of the two concurrent calls must be rejected");
  assert.equal(prisma.state.balance, 900, "balance must only be decremented once");
  assert.equal(prisma.state.txns.length, 1);
});
