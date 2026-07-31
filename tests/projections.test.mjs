import { test } from "node:test";
import assert from "node:assert/strict";
import { approveProjectionTx, settleProjectionTx } from "../lib/projections.mjs";

function makeFakePrisma({ status, balances }) {
  const state = { status, balances: { ...balances }, txns: [], projectionUpdates: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        projection: {
          updateMany: async ({ where, data }) => {
            if (where.status !== state.status) return { count: 0 };
            state.status = data.status;
            return { count: 1 };
          },
        },
        account: {
          update: async ({ where, data }) => {
            if (data.balance?.decrement != null) state.balances[where.id] -= data.balance.decrement;
            if (data.balance?.increment != null) state.balances[where.id] += data.balance.increment;
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

test("approving a projection transfers the amount from faculty to project exactly once", async () => {
  const prisma = makeFakePrisma({ status: "submitted", balances: { faculty: 5000, project: 1000 } });
  const result = await approveProjectionTx(prisma, {
    id: "PJ-2000", currentStatus: "submitted", amount: 300,
    facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel",
  });
  assert.equal(result.conflict, false);
  assert.equal(prisma.state.status, "advanced");
  assert.equal(prisma.state.balances.faculty, 4700);
  assert.equal(prisma.state.balances.project, 1300);
  assert.equal(prisma.state.txns.length, 2);
  assert.equal(prisma.state.txns[0].acctId, "faculty");
  assert.equal(prisma.state.txns[0].type, "out");
  assert.equal(prisma.state.txns[1].acctId, "project");
  assert.equal(prisma.state.txns[1].type, "in");
});

test("a stale approve (status already moved on) is rejected as a conflict, not double-applied", async () => {
  const prisma = makeFakePrisma({ status: "advanced", balances: { faculty: 4700, project: 1300 } });
  const result = await approveProjectionTx(prisma, {
    id: "PJ-2000", currentStatus: "submitted", amount: 300,
    facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel",
  });
  assert.equal(result.conflict, true);
  assert.equal(prisma.state.balances.faculty, 4700, "balance must not move on a rejected conflict");
  assert.equal(prisma.state.txns.length, 0);
});

test("two concurrent approvals only apply once", async () => {
  const prisma = makeFakePrisma({ status: "submitted", balances: { faculty: 5000, project: 1000 } });
  const args = { id: "PJ-2000", currentStatus: "submitted", amount: 300, facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel" };
  const [a, b] = await Promise.all([approveProjectionTx(prisma, args), approveProjectionTx(prisma, args)]);
  const conflicts = [a.conflict, b.conflict].filter(Boolean).length;
  assert.equal(conflicts, 1, "exactly one of the two concurrent calls must be rejected");
  assert.equal(prisma.state.balances.faculty, 4700);
  assert.equal(prisma.state.txns.length, 2);
});

function makeFakeProjectionPrisma({ status, balances }) {
  const state = { status, balances: { ...balances }, txns: [] };
  return {
    state,
    $transaction: async (fn) =>
      fn({
        projection: {
          updateMany: async ({ where, data }) => {
            if (where.status !== state.status) return { count: 0 };
            state.status = data.status;
            return { count: 1 };
          },
        },
        account: {
          update: async ({ where, data }) => {
            if (data.balance?.decrement != null) state.balances[where.id] -= data.balance.decrement;
            if (data.balance?.increment != null) state.balances[where.id] += data.balance.increment;
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

test("settling with actual spend below the advance returns the difference to faculty", async () => {
  const prisma = makeFakeProjectionPrisma({ status: "linked", balances: { faculty: 4700, project: 1300 } });
  const result = await settleProjectionTx(prisma, {
    id: "PJ-2000", currentStatus: "linked", advancedAmount: 300, actualAmount: 250,
    facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel",
  });
  assert.equal(result.conflict, false);
  assert.equal(result.refund, 50);
  assert.equal(prisma.state.status, "settled");
  assert.equal(prisma.state.balances.project, 1250);
  assert.equal(prisma.state.balances.faculty, 4750);
  assert.equal(prisma.state.txns.length, 2);
});

test("settling with actual spend equal to the advance moves no money and creates no txns", async () => {
  const prisma = makeFakeProjectionPrisma({ status: "linked", balances: { faculty: 4700, project: 1300 } });
  const result = await settleProjectionTx(prisma, {
    id: "PJ-2000", currentStatus: "linked", advancedAmount: 300, actualAmount: 300,
    facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel",
  });
  assert.equal(result.conflict, false);
  assert.equal(result.refund, 0);
  assert.equal(prisma.state.balances.project, 1300);
  assert.equal(prisma.state.balances.faculty, 4700);
  assert.equal(prisma.state.txns.length, 0);
});

test("a stale settle (already settled) is rejected as a conflict", async () => {
  const prisma = makeFakeProjectionPrisma({ status: "settled", balances: { faculty: 4750, project: 1250 } });
  const result = await settleProjectionTx(prisma, {
    id: "PJ-2000", currentStatus: "linked", advancedAmount: 300, actualAmount: 250,
    facultyAcctId: "faculty", projectAcctId: "project", title: "Hotel",
  });
  assert.equal(result.conflict, true);
  assert.equal(result.refund, 0);
  assert.equal(prisma.state.balances.faculty, 4750, "balance must not move on a rejected conflict");
});
