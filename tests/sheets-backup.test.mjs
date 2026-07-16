import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSheetRows } from "../lib/sheets-backup.mjs";

test("builds header-only rows when everything is empty", () => {
  const sheets = buildSheetRows({ requests: [], categories: [], accounts: [], txns: [], audits: [] });
  assert.deepEqual(sheets.Requests, [["ID", "Title", "Category", "Amount", "Department", "Requester", "Status", "Created At", "Updated At", "Drive Folder"]]);
  assert.deepEqual(sheets.Documents, [["Request ID", "Document Name", "Submitted", "Link", "Discrepancy Open", "Discrepancy Note"]]);
  assert.deepEqual(sheets.Accounts, [["ID", "Name", "Balance"]]);
  assert.deepEqual(sheets.Transactions, [["ID", "Account ID", "Type", "Amount", "Description", "Date"]]);
  assert.deepEqual(sheets.Audit, [["User", "Role", "Action", "Timestamp"]]);
});

test("maps a request's categoryId to the category name", () => {
  const request = {
    id: "RB-1", title: "Snacks", categoryId: "cat-1", amount: 500, dept: "IT",
    requesterName: "Alice", status: "notified",
    createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    driveFolder: "https://drive.example/RB-1", docs: [],
  };
  const categories = [{ id: "cat-1", name: "Office Supplies" }];
  const sheets = buildSheetRows({ requests: [request], categories, accounts: [], txns: [], audits: [] });
  assert.deepEqual(sheets.Requests[1], [
    "RB-1", "Snacks", "Office Supplies", 500, "IT", "Alice", "notified",
    "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "https://drive.example/RB-1",
  ]);
});

test("falls back to the raw categoryId when the category is unknown", () => {
  const request = {
    id: "RB-2", title: "Mystery", categoryId: "missing-cat", amount: 100, dept: "HR",
    requesterName: "Bob", status: "notified",
    createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    driveFolder: "", docs: [],
  };
  const sheets = buildSheetRows({ requests: [request], categories: [], accounts: [], txns: [], audits: [] });
  assert.equal(sheets.Requests[1][2], "missing-cat");
});

test("flattens each request's docs into one Documents row per doc", () => {
  const request = {
    id: "RB-3", title: "T", categoryId: "c", amount: 1, dept: "D", requesterName: "R", status: "notified",
    createdAt: new Date(), updatedAt: new Date(), driveFolder: "",
    docs: [
      { name: "Receipt", submitted: true, link: "https://drive.example/receipt", disc: null },
      { name: "Quote", submitted: false, link: "", disc: { open: true, note: "wrong file", fixed: false } },
    ],
  };
  const sheets = buildSheetRows({ requests: [request], categories: [], accounts: [], txns: [], audits: [] });
  assert.deepEqual(sheets.Documents.slice(1), [
    ["RB-3", "Receipt", true, "https://drive.example/receipt", false, ""],
    ["RB-3", "Quote", false, "", true, "wrong file"],
  ]);
});

test("maps accounts, transactions and audit rows directly", () => {
  const accounts = [{ id: "faculty", name: "Faculty Account", balance: 1000 }];
  const txns = [{ id: "t1", acctId: "faculty", type: "out", amount: 200, desc: "Disbursed", date: new Date("2026-01-03T00:00:00.000Z") }];
  const audits = [{ user: "Admin", role: "Admin", action: "Did a thing", ts: new Date("2026-01-04T00:00:00.000Z") }];
  const sheets = buildSheetRows({ requests: [], categories: [], accounts, txns, audits });
  assert.deepEqual(sheets.Accounts[1], ["faculty", "Faculty Account", 1000]);
  assert.deepEqual(sheets.Transactions[1], ["t1", "faculty", "out", 200, "Disbursed", "2026-01-03T00:00:00.000Z"]);
  assert.deepEqual(sheets.Audit[1], ["Admin", "Admin", "Did a thing", "2026-01-04T00:00:00.000Z"]);
});

import { syncToSheets } from "../lib/sheets-backup.mjs";

function makeFakePrisma({ requests = [], categories = [], accounts = [], txns = [], audits = [] } = {}) {
  return {
    request: { findMany: async () => requests },
    category: { findMany: async () => categories },
    account: { findMany: async () => accounts },
    txn: { findMany: async () => txns },
    audit: { findMany: async () => audits },
  };
}

function makeFakeSheetsClient() {
  const calls = { cleared: [], updated: [] };
  return {
    calls,
    spreadsheets: {
      values: {
        clear: async ({ range }) => { calls.cleared.push(range); },
        update: async ({ range, requestBody }) => { calls.updated.push({ range, rows: requestBody.values }); },
      },
    },
  };
}

const FAKE_ENV = {
  GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REFRESH_TOKEN: "token", GOOGLE_SHEETS_BACKUP_ID: "sheet-id",
};

test("syncToSheets returns a config error when Google env vars are missing", async () => {
  const result = await syncToSheets({ prisma: makeFakePrisma(), env: {} });
  assert.deepEqual(result, { ok: false, error: "Google Sheets backup is not configured." });
});

test("syncToSheets clears and rewrites every tab from fresh Prisma data", async () => {
  const prisma = makeFakePrisma({ accounts: [{ id: "faculty", name: "Faculty Account", balance: 1000 }] });
  const sheetsClient = makeFakeSheetsClient();
  const result = await syncToSheets({ prisma, sheetsClient, env: FAKE_ENV });
  assert.equal(result.ok, true);
  assert.ok(result.syncedAt);
  assert.deepEqual(sheetsClient.calls.cleared, ["Requests", "Documents", "Accounts", "Transactions", "Audit"]);
  const accountsUpdate = sheetsClient.calls.updated.find((u) => u.range === "Accounts!A1");
  assert.deepEqual(accountsUpdate.rows[1], ["faculty", "Faculty Account", 1000]);
});

test("syncToSheets appends a 'Last updated' footer row (with a blank separator) to every tab", async () => {
  const prisma = makeFakePrisma({ accounts: [{ id: "faculty", name: "Faculty Account", balance: 1000 }] });
  const sheetsClient = makeFakeSheetsClient();
  const result = await syncToSheets({ prisma, sheetsClient, env: FAKE_ENV });
  for (const update of sheetsClient.calls.updated) {
    const footer = update.rows.at(-1);
    assert.equal(footer[0], "Last updated:");
    assert.equal(footer[1], result.syncedAt);
    assert.deepEqual(update.rows.at(-2), [], `${update.range} should have a blank separator row before the footer`);
  }
});

test("syncToSheets reports the error instead of throwing when the Sheets API call fails", async () => {
  const sheetsClient = { spreadsheets: { values: { clear: async () => { throw new Error("API quota exceeded"); } } } };
  const result = await syncToSheets({ prisma: makeFakePrisma(), sheetsClient, env: FAKE_ENV });
  assert.equal(result.ok, false);
  assert.equal(result.error, "API quota exceeded");
});
