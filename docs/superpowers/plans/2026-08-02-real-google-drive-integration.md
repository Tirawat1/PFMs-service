# Real Google Drive integration

Not part of `docs/design_PFMS_feature.md` — the client mockup never had real Drive
integration either (every "Drive link" there is a simulated placeholder), so there was
nothing to port. This is genuinely new work, requested directly.

**Status: implemented** (see Tasks below — all done). This doc is kept as the design
record.

## Goal

Replace the synthesized `driveFolder` placeholder string and paste-a-link-only document
attachment with a real Google Drive folder per request and real file uploads into it,
via the Drive API — while keeping the whole thing **optional**, exactly like email
(`lib/mail.js`) and the existing Sheets backup (`lib/sheets-backup.mjs`): if it isn't
configured, or a call fails, the app falls back to today's behavior without ever
blocking a mutation or throwing to the user.

## Architecture

- **Reuses the existing OAuth2 refresh token**, not a new Service Account. A Service
  Account was tried first but reversed: bare Service Accounts have no storage quota of
  their own and generally can't create files in a normal personal/Workspace-less Drive
  (that only works cleanly against a Shared Drive). The existing `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` (already used by `lib/sheets-backup.mjs`)
  work fine here too, as long as the refresh token was issued with the added scope
  `https://www.googleapis.com/auth/drive.file` alongside the Sheets scope — **the refresh
  token must be re-issued** (via OAuth Playground: re-authorize with both
  `.../auth/spreadsheets` and `.../auth/drive.file` scopes checked, exchange for a new
  refresh token, replace `GOOGLE_REFRESH_TOKEN` in `.env`).
- **New env var**: `GOOGLE_DRIVE_PARENT_FOLDER_ID` — a folder (owned by whichever Google
  account authorized that refresh token) that all per-request folders are created under.
- **`lib/drive.mjs`** — mirrors the shape of `lib/sheets-backup.mjs`: a thin
  `defaultDriveClient(...)` builder plus exported functions that accept an injectable
  client for testing, so the Drive-API-calling code stays out of the pure logic:

  ```js
  import { google } from "googleapis";

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

  // Best-effort — returns null (never throws) when unconfigured or the API call fails,
  // so callers can fall back to the synthesized placeholder link untouched.
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
  ```

  (`Readable.from(buffer)` from `node:stream` — googleapis' `media.body` wants a stream,
  not a raw buffer.)

- **Schema**: `Request.driveFolderId String?` — the real Drive folder id (`null` when
  Drive isn't configured or folder creation failed), kept alongside the existing
  `driveFolder` (which stays as the *link* shown in the UI — either the real
  `webViewLink` or today's synthesized placeholder, chosen by whichever `ensureRequestFolder`
  returned).

- **`createRequest` RPC case** (`app/api/rpc/route.js`) — after generating `id`, best-effort
  call `ensureRequestFolder` and use its result if present, else keep today's synthesized
  string:

  ```js
  const folder = await ensureRequestFolder({ requestId: id, title });
  const driveFolder = folder?.link || "https://drive.google.com/drive/folders/PFMS-" + id;
  // ...
  data: { ..., driveFolder, driveFolderId: folder?.id || null },
  ```

- **Shared doc-mutation helper (`lib/attach-doc.mjs`)** — `applyDocAttachment(docs, idx, { link, fileName })`
  is the actual "mark this checklist document submitted" mutation, extracted so the
  `attachDoc` RPC action and the new upload endpoint can't silently diverge on what
  "submitted" means.

- **Upload endpoint (`app/api/drive/upload/route.js`, `POST`)** — the existing `/api/rpc`
  route is JSON-only; a real file upload needs `multipart/form-data`, so this is a new
  route, not an RPC action. Reads a `FormData` body (`id`, `idx`, `file`), authorizes the
  same way `attachDoc` does (`canManageRequestDocs` + `isDocEditable`), then:
  1. If the request has no `driveFolderId` (Drive wasn't configured at creation, or
     creation failed), respond `{ error: "FALLBACK_TO_LINK" }` (409) so the client falls
     back to the paste-a-link modal instead of dead-ending the user.
  2. Call `uploadFileToFolder`; on `null` (failure), same fallback response.
  3. On success, call `applyDocAttachment`, persist, audit, and notify — mirroring
     `attachDoc`'s side effects.

- **UI (`components/App.jsx`)** — the "attach" modal gets a real file `<input type="file">`
  when `modal.driveFolderId` is present (passed in from `r.driveFolderId` when the modal
  opens); otherwise it looks exactly as it does today. Picking a file `POST`s a
  `FormData` to `/api/drive/upload`; on `FALLBACK_TO_LINK` the modal reveals the
  paste-a-link fields (with a one-line explanation) instead of dead-ending. The generic
  "Submit" button is hidden while the file-upload path is active, since the file input
  itself submits on change.

## Global constraints

- **Never block a mutation on Drive.** `createRequest` must succeed identically whether
  or not Drive is configured or reachable — `ensureRequestFolder` swallows its own errors
  and returns `null`, exactly like `sendMailToUser` and `syncToSheets` already do for
  email/Sheets.
- **The paste-a-link path must keep working unconditionally** — real upload is additive.
  A request created before Drive was configured (`driveFolderId: null`) must still be
  able to attach documents via pasted links forever.
- **Least-privilege scope** (`drive.file`, not full `drive`) — the app must not be able to
  read/write files it didn't create itself.
- **No new secrets committed** — the re-issued refresh token and parent folder id go in
  `.env` / deployment secrets only; `.env.example` gets the new key name with an empty
  value plus setup comments.
- Reuse `lib/sheets-backup.mjs`'s pattern (injectable client for tests, `env` param
  instead of reading `process.env` directly inside test-covered functions) so
  `lib/drive.mjs` can be unit-tested the same way — fake `driveClient` objects, no real
  network calls in `tests/*.test.mjs`.

## Tasks

1. ✅ `prisma/schema.prisma`: `Request.driveFolderId String?`.
2. ✅ `lib/drive.mjs` + `tests/drive.test.mjs` — `ensureRequestFolder`, `uploadFileToFolder`,
   both covered with a fake `driveClient` (success, misconfigured-env, and thrown-error
   paths — asserting `null` is returned, never an exception).
3. ✅ Wired `ensureRequestFolder` into the `createRequest` RPC case.
4. ✅ `lib/attach-doc.mjs` (`applyDocAttachment`) extracted and used by both `attachDoc`
   and the new upload route.
5. ✅ `app/api/drive/upload/route.js` — multipart upload endpoint.
6. ✅ `components/App.jsx` — real file input in the attach-document modal, gated on
   `driveFolderId`, falling back to the paste-a-link fields on any upload error.
7. ✅ `.env.example` + `docker-compose.yml` — `GOOGLE_DRIVE_PARENT_FOLDER_ID` added with
   a setup comment; note added above `GOOGLE_REFRESH_TOKEN` that it must carry the
   `drive.file` scope too.

## Non-goals

- No change to the existing synthesized-placeholder behavior for requests created
  without Drive configured — this plan is additive only.
- No move away from `driveFolder` as a plain link string on `Request` — the UI still just
  renders a link; nothing needs to enumerate a folder's contents from our side.
- No handling of Drive storage quota/billing — out of scope, assumed the org's existing
  Drive already has room.
