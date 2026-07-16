import { google } from "googleapis";

const REQUESTS_HEADER = ["ID", "Title", "Category", "Amount", "Department", "Requester", "Status", "Created At", "Updated At", "Drive Folder"];
const DOCUMENTS_HEADER = ["Request ID", "Document Name", "Submitted", "Link", "Discrepancy Open", "Discrepancy Note"];
const ACCOUNTS_HEADER = ["ID", "Name", "Balance"];
const TRANSACTIONS_HEADER = ["ID", "Account ID", "Type", "Amount", "Description", "Date"];
const AUDIT_HEADER = ["User", "Role", "Action", "Timestamp"];

export function buildSheetRows({ requests, categories, accounts, txns, audits }) {
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const requestRows = requests.map((r) => [
    r.id, r.title, categoryNameById.get(r.categoryId) ?? r.categoryId, r.amount, r.dept,
    r.requesterName, r.status, r.createdAt.toISOString(), r.updatedAt.toISOString(), r.driveFolder,
  ]);

  const documentRows = requests.flatMap((r) =>
    (r.docs || []).map((doc) => [
      r.id, doc.name, !!doc.submitted, doc.link || "", !!(doc.disc && doc.disc.open), doc.disc?.note || "",
    ])
  );

  const accountRows = accounts.map((a) => [a.id, a.name, a.balance]);
  const transactionRows = txns.map((t) => [t.id, t.acctId, t.type, t.amount, t.desc, t.date.toISOString()]);
  const auditRows = audits.map((au) => [au.user, au.role, au.action, au.ts.toISOString()]);

  return {
    Requests: [REQUESTS_HEADER, ...requestRows],
    Documents: [DOCUMENTS_HEADER, ...documentRows],
    Accounts: [ACCOUNTS_HEADER, ...accountRows],
    Transactions: [TRANSACTIONS_HEADER, ...transactionRows],
    Audit: [AUDIT_HEADER, ...auditRows],
  };
}

function defaultSheetsClient({ clientId, clientSecret, refreshToken }) {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

// One-way mirror: queries Prisma, rebuilds every tab from scratch, writes it to the
// configured Google Sheet. Best-effort — a failure here must never affect the app itself.
export async function syncToSheets({ prisma, sheetsClient, env } = {}) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SHEETS_BACKUP_ID } = env ?? process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !GOOGLE_SHEETS_BACKUP_ID) {
    return { ok: false, error: "Google Sheets backup is not configured." };
  }
  try {
    const [requests, categories, accounts, txns, audits] = await Promise.all([
      prisma.request.findMany(),
      prisma.category.findMany(),
      prisma.account.findMany(),
      prisma.txn.findMany(),
      prisma.audit.findMany(),
    ]);
    const sheetsData = buildSheetRows({ requests, categories, accounts, txns, audits });
    const sheets = sheetsClient ?? defaultSheetsClient({
      clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, refreshToken: GOOGLE_REFRESH_TOKEN,
    });

    const syncedAt = new Date().toISOString();
    for (const [tab, rows] of Object.entries(sheetsData)) {
      const rowsWithFooter = [...rows, [], ["Last updated:", syncedAt]];
      await sheets.spreadsheets.values.clear({ spreadsheetId: GOOGLE_SHEETS_BACKUP_ID, range: tab });
      await sheets.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEETS_BACKUP_ID,
        range: `${tab}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: rowsWithFooter },
      });
    }
    return { ok: true, syncedAt };
  } catch (e) {
    console.error("Google Sheets backup failed:", e.message);
    return { ok: false, error: e.message };
  }
}
