import { test } from "node:test";
import assert from "node:assert/strict";
import { reverseRequestTx } from "../lib/reversal.mjs";

function makeFakePrisma({ status, balances, streamBalances, projections }) {
  const state = { status, balances: { ...balances }, streamBalances: { ...(streamBalances || {}) }, projections: { ...(projections || {}) }, txns: [], requestUpdates: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        request: {
          updateMany: async ({ where, data }) => {
            if (where.status !== state.status) return { count: 0 };
            state.status = data.status;
            state.requestUpdates.push(data);
            return { count: 1 };
          },
        },
        account: {
          update: async ({ where, data }) => {
            if (data.balance.increment != null) state.balances[where.id] += data.balance.increment;
            else state.balances[where.id] -= data.balance.decrement;
          },
        },
        stream: {
          update: async ({ where, data }) => {
            if (data.balance.increment != null) state.streamBalances[where.id] += data.balance.increment;
            else state.streamBalances[where.id] -= data.balance.decrement;
          },
        },
        txn: {
          create: async ({ data }) => {
            state.txns.push(data);
          },
        },
        projection: {
          findUnique: async ({ where }) => ({ id: where.id, fundingAcctId: state.balances.personal ? "personal" : null }),
          updateMany: async ({ where, data }) => {
            if (state.projections[where.id] !== where.status) return { count: 0 };
            state.projections[where.id] = data.status;
            return { count: 1 };
          },
        },
      }),
  };
}

test("reversing out of disbursed returns the disbursed amount to the account", async () => {
  const prisma = makeFakePrisma({ status: "disbursed", balances: { project: 700 } });
  const result = await reverseRequestTx(prisma, {
    id: "RB-1", currentStatus: "disbursed", prevStatus: "verified",
    acctId: "project", streamId: null, disbursedAmount: 300, refundAmount: 0,
    facultyAcctId: "faculty", projectAcctId: "project", projectionId: null,
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.status, "verified");
  assert.equal(prisma.state.balances.project, 1000);
  assert.equal(prisma.state.requestUpdates[0].acctId, null);
  assert.equal(prisma.state.requestUpdates[0].refundAmount, 0);
});

test("reversing out of disbursed also returns the amount to the purse it came from", async () => {
  const prisma = makeFakePrisma({ status: "disbursed", balances: { project: 700 }, streamBalances: { s_advance: 100 } });
  await reverseRequestTx(prisma, {
    id: "RB-1", currentStatus: "disbursed", prevStatus: "verified",
    acctId: "project", streamId: "s_advance", disbursedAmount: 300, refundAmount: 0,
    facultyAcctId: "faculty", projectAcctId: "project", projectionId: null,
  });
  assert.equal(prisma.state.streamBalances.s_advance, 400);
});

test("reversing out of disbursed also undoes a Faculty advance-return refund", async () => {
  const prisma = makeFakePrisma({ status: "disbursed", balances: { project: 700, faculty: 5250 } });
  await reverseRequestTx(prisma, {
    id: "RB-1", currentStatus: "disbursed", prevStatus: "verified",
    acctId: "project", streamId: null, disbursedAmount: 750, refundAmount: 250,
    facultyAcctId: "faculty", projectAcctId: "project", projectionId: null,
  });
  assert.equal(prisma.state.balances.project, 700 + 750 + 250);
  assert.equal(prisma.state.balances.faculty, 5250 - 250);
});

test("reversing out of disbursed uses the projection's funding account for the refund unwind", async () => {
  const prisma = makeFakePrisma({ status: "disbursed", balances: { project: 700, personal: 5250 }, projections: { "PJ-1": "settled" } });
  await reverseRequestTx(prisma, {
    id: "RB-1", currentStatus: "disbursed", prevStatus: "verified",
    acctId: "project", streamId: null, disbursedAmount: 750, refundAmount: 250,
    facultyAcctId: "faculty", projectAcctId: "project", projectionId: "PJ-1",
  });
  assert.equal(prisma.state.balances.project, 700 + 750 + 250);
  assert.equal(prisma.state.balances.personal, 5250 - 250);
});

test("reversing out of verified clears an issued PO", async () => {
  const prisma = makeFakePrisma({ status: "verified", balances: {} });
  await reverseRequestTx(prisma, {
    id: "RB-1", currentStatus: "verified", prevStatus: "docs_submitted",
    acctId: null, streamId: null, disbursedAmount: 0, refundAmount: 0,
    facultyAcctId: "faculty", projectAcctId: "project", projectionId: null,
  });
  assert.equal(prisma.state.requestUpdates[0].po, null);
  assert.equal(prisma.state.txns.length, 0, "no money moves when reversing out of verified");
});

test("reversing out of closed re-opens a settled linked projection", async () => {
  const prisma = makeFakePrisma({ status: "closed", balances: {}, projections: { "PJ-1": "settled" } });
  await reverseRequestTx(prisma, {
    id: "RB-1", currentStatus: "closed", prevStatus: "purchase_complete",
    acctId: null, streamId: null, disbursedAmount: 0, refundAmount: 0,
    facultyAcctId: "faculty", projectAcctId: "project", projectionId: "PJ-1",
  });
  assert.equal(prisma.state.projections["PJ-1"], "linked");
});

test("a stale reversal (status already moved on) is rejected as a conflict, not double-applied", async () => {
  const prisma = makeFakePrisma({ status: "verified", balances: { project: 1000 } });
  const result = await reverseRequestTx(prisma, {
    id: "RB-1", currentStatus: "disbursed", prevStatus: "verified",
    acctId: "project", streamId: null, disbursedAmount: 300, refundAmount: 0,
    facultyAcctId: "faculty", projectAcctId: "project", projectionId: null,
  });
  assert.equal(result.conflict, true);
  assert.equal(prisma.state.balances.project, 1000);
});
