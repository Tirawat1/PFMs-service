import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceRequestTx } from "../lib/requests.mjs";

// Fakes a single-row compare-and-swap the way `UPDATE ... WHERE id=? AND status=?`
// behaves atomically in Postgres — the check and the write happen as one step.
function makeFakePrisma({ status, balances }) {
  const state = { status, balances: { ...balances }, txns: [], requestUpdates: [] };
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
          update: async ({ data }) => {
            state.requestUpdates.push(data);
          },
        },
        account: {
          update: async ({ where, data }) => {
            state.balances[where.id] -= data.balance.decrement;
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

test("advances status and disburses funds from the given account exactly once", async () => {
  const prisma = makeFakePrisma({ status: "verified", balances: { project: 1000 } });
  const result = await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test", acctId: "project", proofLink: "https://example.com/proof",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.status, "disbursed");
  assert.equal(prisma.state.balances.project, 900);
  assert.equal(prisma.state.txns.length, 1);
  assert.equal(prisma.state.txns[0].acctId, "project");
});

test("disburses from the account passed in, not a hardcoded one", async () => {
  const prisma = makeFakePrisma({ status: "verified", balances: { faculty: 5000, project: 1000 } });
  const result = await advanceRequestTx(prisma, {
    id: "RB-2", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 300, title: "Test", acctId: "faculty", proofLink: "https://example.com/proof",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.balances.faculty, 4700);
  assert.equal(prisma.state.balances.project, 1000, "the other account must be untouched");
  assert.equal(prisma.state.txns[0].acctId, "faculty");
});

test("writes the account and proof link onto the request atomically with the disbursement", async () => {
  const prisma = makeFakePrisma({ status: "verified", balances: { project: 1000 } });
  await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test", acctId: "project", proofLink: "https://example.com/proof",
  });
  assert.equal(prisma.state.requestUpdates.length, 1);
  assert.deepEqual(prisma.state.requestUpdates[0], { acctId: "project", disburseProofLink: "https://example.com/proof" });
});

test("advancing a non-disbursement step does not touch the account", async () => {
  const prisma = makeFakePrisma({ status: "docs_submitted", balances: { project: 1000 } });
  const result = await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "docs_submitted", nextStatus: "verified",
    isDisbursement: false, amount: 100, title: "Test",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.balances.project, 1000);
  assert.equal(prisma.state.txns.length, 0);
  assert.equal(prisma.state.requestUpdates.length, 0);
});

test("a stale advance (status already moved on) is rejected as a conflict, not double-applied", async () => {
  const prisma = makeFakePrisma({ status: "disbursed", balances: { project: 900 } });
  const result = await advanceRequestTx(prisma, {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test", acctId: "project", proofLink: "https://example.com/proof",
  });
  assert.equal(result.conflict, true);
  assert.equal(prisma.state.balances.project, 900, "balance must not move on a rejected conflict");
  assert.equal(prisma.state.txns.length, 0);
});

test("two concurrent disbursement attempts only apply once", async () => {
  const prisma = makeFakePrisma({ status: "verified", balances: { project: 1000 } });
  const args = {
    id: "RB-1", currentStatus: "verified", nextStatus: "disbursed",
    isDisbursement: true, amount: 100, title: "Test", acctId: "project", proofLink: "https://example.com/proof",
  };
  const [a, b] = await Promise.all([
    advanceRequestTx(prisma, args),
    advanceRequestTx(prisma, args),
  ]);
  const conflicts = [a.conflict, b.conflict].filter(Boolean).length;
  assert.equal(conflicts, 1, "exactly one of the two concurrent calls must be rejected");
  assert.equal(prisma.state.balances.project, 900, "balance must only be decremented once");
  assert.equal(prisma.state.txns.length, 1);
});
