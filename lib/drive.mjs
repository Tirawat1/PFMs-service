import { google } from "googleapis";
import { Readable } from "node:stream";

// Reuses the same OAuth2 client credentials as lib/sheets-backup.mjs — the refresh
// token must be re-issued with the added scope https://www.googleapis.com/auth/drive.file
// (the Sheets-only token won't carry Drive access).
function defaultDriveClient({ clientId, clientSecret, refreshToken }) {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth: oauth2Client });
}

function driveEnv(env) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_PARENT_FOLDER_ID } = env ?? process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !GOOGLE_DRIVE_PARENT_FOLDER_ID) return null;
  return { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_PARENT_FOLDER_ID };
}

// Best-effort — returns null (never throws) when Drive isn't configured or the API call
// fails, so callers fall back to the synthesized placeholder link untouched.
export async function ensureRequestFolder({ requestId, title, driveClient, env } = {}) {
  const creds = driveEnv(env);
  if (!creds) return null;
  try {
    const drive = driveClient ?? defaultDriveClient({ clientId: creds.GOOGLE_CLIENT_ID, clientSecret: creds.GOOGLE_CLIENT_SECRET, refreshToken: creds.GOOGLE_REFRESH_TOKEN });
    const res = await drive.files.create({
      requestBody: {
        name: requestId + " — " + title,
        mimeType: "application/vnd.google-apps.folder",
        parents: [creds.GOOGLE_DRIVE_PARENT_FOLDER_ID],
      },
      fields: "id, webViewLink",
    });
    return { id: res.data.id, link: res.data.webViewLink };
  } catch (e) {
    console.error("Drive folder creation failed:", e.message);
    return null;
  }
}

// Also best-effort. Returns null on failure so the caller keeps the paste-a-link path
// as a fallback for this one attach action.
export async function uploadFileToFolder({ folderId, name, mimeType, buffer, driveClient, env } = {}) {
  const creds = driveEnv(env);
  if (!creds || !folderId) return null;
  try {
    const drive = driveClient ?? defaultDriveClient({ clientId: creds.GOOGLE_CLIENT_ID, clientSecret: creds.GOOGLE_CLIENT_SECRET, refreshToken: creds.GOOGLE_REFRESH_TOKEN });
    const res = await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: "id, webViewLink, name",
    });
    return { link: res.data.webViewLink, fileName: res.data.name };
  } catch (e) {
    console.error("Drive upload failed:", e.message);
    return null;
  }
}
