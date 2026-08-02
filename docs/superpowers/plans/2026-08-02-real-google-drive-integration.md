# Real Google Drive integration

Not part of `docs/design_PFMS_feature.md` — the client mockup never had real Drive
integration either (every "Drive link" there is a simulated placeholder), so there was
nothing to port. This is genuinely new work, requested directly.

## Goal

Replace the synthesized `driveFolder` placeholder string and paste-a-link-only document
attachment with a real Google Drive folder per request and real file uploads into it,
via the Drive API — while keeping the whole thing **optional**, exactly like email
(`lib/mail.js`) and the existing Sheets backup (`lib/sheets-backup.mjs`): if it isn't
configured, or a call fails, the app falls back to today's behavior without ever
blocking a mutation or throwing to the user.

## Architecture

- **Reuse the existing OAuth2 credentials**, not a new service account. `lib/sheets-backup.mjs`
  already authenticates via `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN`
  for Sheets; the same refresh token can drive the Drive API too, provided it was issued
  with the added scope `https://www.googleapis.com/auth/drive.file` (drive.file — the app
  can only see/manage files *it* creates, not the whole Drive — the least-privilege scope
  for this use case). **Setup note to call out in `step_deploy_explained.md`**: the refresh
  token must be re-generated after adding this scope; the old one won't carry it.
- **New env var**: `GOOGLE_DRIVE_PARENT_FOLDER_ID` — a folder (in a Shared Drive or the
  service identity's own Drive) that all per-request folders are created under.
- **`lib/drive.mjs`** (new) — mirrors the shape of `lib/sheets-backup.mjs`: a thin
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
      const drive = driveClient ?? defaultDriveClient(creds);
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
      const drive = driveClient ?? defaultDriveClient(creds);
      const res = await drive.files.create({
        requestBody: { name, parents: [folderId] },
        media: { mimeType, body: bufferToStream(buffer) },
        fields: "id, webViewLink, name",
      });
      return { link: res.data.webViewLink, fileName: res.data.name };
    } catch (e) {
      console.error("Drive upload failed:", e.message);
      return null;
    }
  }
  ```

  (`bufferToStream` — a small `stream.Readable.from(buffer)` helper; googleapis' `media.body`
  wants a stream, not a raw buffer.)

- **Schema**: add `Request.driveFolderId String?` — the real Drive folder id (`null` when
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

- **New upload endpoint** — the existing `/api/rpc` route is JSON-only; a real file upload
  needs `multipart/form-data`, so this is a new route, not an RPC action:
  `app/api/drive/upload/route.js` (`POST`), reading a `FormData` body
  (`requestId`, `idx`, `file`), authorizing the same way `attachDoc` does
  (`canManageRequestDocs`), then:
  1. Look up the request; if it has no `driveFolderId` (Drive wasn't configured at
     creation, or creation failed), return an error telling the client to fall back to
     the paste-a-link modal instead.
  2. Call `uploadFileToFolder`; on `null` (failure), same fallback error.
  3. On success, call the **same** doc-mutation logic `attachDoc` uses (extract that
     doc-array mutation into a small shared helper so the two entry points can't drift)
     with `link: result.link, fileName: result.fileName`.

- **UI (`components/App.jsx`)** — the "attach" modal gets a real file `<input type="file">`
  alongside the existing paste-a-link field, shown only when `r.driveFolderId` is present
  (i.e., Drive is actually wired up for this request); otherwise the modal looks exactly
  as it does today. On file pick, `POST` a `FormData` to `/api/drive/upload` instead of
  calling the `attachDoc` RPC action directly; on the endpoint's fallback error, show the
  existing paste-a-link field so the user isn't stuck.

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
- **No new secrets committed** — `GOOGLE_DRIVE_PARENT_FOLDER_ID` and the scope-updated
  refresh token go in `.env` / deployment secrets only, `.env.example` gets the new key
  name with an empty value plus a comment on the required scope.
- Reuse `lib/sheets-backup.mjs`'s pattern (injectable client for tests, `env` param
  instead of reading `process.env` directly inside test-covered functions) so
  `lib/drive.mjs` can be unit-tested the same way — fake `driveClient` objects, no real
  network calls in `tests/*.test.mjs`.

## Tasks (not yet started)

1. `prisma/schema.prisma`: add `Request.driveFolderId String?`.
2. `lib/drive.mjs` + `tests/drive.test.mjs` — `ensureRequestFolder`, `uploadFileToFolder`,
   both covered with a fake `driveClient` (success, misconfigured-env, and thrown-error
   paths — asserting `null` is returned, never an exception).
3. Wire `ensureRequestFolder` into the `createRequest` RPC case.
4. `app/api/drive/upload/route.js` — multipart upload endpoint, reusing `attachDoc`'s
   authorization + doc-mutation logic (extracted to a shared helper first so the two
   entry points can't silently diverge).
5. `components/App.jsx` — real file input in the attach-document modal, gated on
   `r.driveFolderId`, falling back to the paste-a-link field on any upload error.
6. `.env.example` — add `GOOGLE_DRIVE_PARENT_FOLDER_ID=` with a comment; note in
   `step_deploy_explained.md` that the Sheets refresh token must be regenerated with the
   `drive.file` scope added.

## Non-goals

- No change to the existing synthesized-placeholder behavior for requests created
  without Drive configured — this plan is additive only.
- No move away from `driveFolder` as a plain link string on `Request` — the UI still just
  renders a link; nothing needs to enumerate a folder's contents from our side.
- No handling of Drive storage quota/billing — out of scope, assumed the org's existing
  Drive already has room.
