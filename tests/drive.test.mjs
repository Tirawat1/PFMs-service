import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureRequestFolder, uploadFileToFolder } from "../lib/drive.mjs";

const FULL_ENV = {
  GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REFRESH_TOKEN: "token", GOOGLE_DRIVE_PARENT_FOLDER_ID: "parent-folder",
};

test("ensureRequestFolder returns null when Drive env vars are not fully configured", async () => {
  const result = await ensureRequestFolder({ requestId: "RB-1", title: "Snacks", env: { GOOGLE_CLIENT_ID: "id" } });
  assert.equal(result, null);
});

test("ensureRequestFolder creates a folder under the configured parent and returns its id/link", async () => {
  let requestBody;
  const fakeClient = { files: { create: async (args) => { requestBody = args.requestBody; return { data: { id: "folder-1", webViewLink: "https://drive.google.com/drive/folders/folder-1" } }; } } };
  const result = await ensureRequestFolder({ requestId: "RB-1", title: "Snacks", driveClient: fakeClient, env: FULL_ENV });
  assert.deepEqual(result, { id: "folder-1", link: "https://drive.google.com/drive/folders/folder-1" });
  assert.equal(requestBody.name, "RB-1 — Snacks");
  assert.deepEqual(requestBody.parents, ["parent-folder"]);
  assert.equal(requestBody.mimeType, "application/vnd.google-apps.folder");
});

test("ensureRequestFolder returns null (never throws) when the Drive API call fails", async () => {
  const fakeClient = { files: { create: async () => { throw new Error("quota exceeded"); } } };
  const result = await ensureRequestFolder({ requestId: "RB-1", title: "Snacks", driveClient: fakeClient, env: FULL_ENV });
  assert.equal(result, null);
});

test("uploadFileToFolder returns null when Drive env vars are not fully configured", async () => {
  const result = await uploadFileToFolder({ folderId: "folder-1", name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("x"), env: {} });
  assert.equal(result, null);
});

test("uploadFileToFolder returns null when no folderId is given, even with full env", async () => {
  const result = await uploadFileToFolder({ folderId: null, name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("x"), env: FULL_ENV });
  assert.equal(result, null);
});

test("uploadFileToFolder uploads into the given folder and returns link/fileName", async () => {
  let requestBody, media;
  const fakeClient = { files: { create: async (args) => { requestBody = args.requestBody; media = args.media; return { data: { id: "file-1", webViewLink: "https://drive.google.com/file/d/file-1/view", name: "receipt.pdf" } }; } } };
  const result = await uploadFileToFolder({ folderId: "folder-1", name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello"), driveClient: fakeClient, env: FULL_ENV });
  assert.deepEqual(result, { link: "https://drive.google.com/file/d/file-1/view", fileName: "receipt.pdf" });
  assert.deepEqual(requestBody.parents, ["folder-1"]);
  assert.equal(media.mimeType, "application/pdf");
});

test("uploadFileToFolder returns null (never throws) when the Drive API call fails", async () => {
  const fakeClient = { files: { create: async () => { throw new Error("network error"); } } };
  const result = await uploadFileToFolder({ folderId: "folder-1", name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("x"), driveClient: fakeClient, env: FULL_ENV });
  assert.equal(result, null);
});
