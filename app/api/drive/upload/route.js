import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, can } from "@/lib/auth";
import { canManageRequestDocs } from "@/lib/permissions.mjs";
import { isDocEditable } from "@/lib/doc-phase.mjs";
import { uploadFileToFolder } from "@/lib/drive.mjs";
import { applyDocAttachment } from "@/lib/attach-doc.mjs";
import { buildDriveFileName } from "@/lib/file-naming.mjs";
import { sendMailToUser } from "@/lib/mail.js";

function err(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function notifyPerm(perm, text, type, excludeId) {
  const users = await prisma.user.findMany({ include: { role: true } });
  const targets = users.filter((u) => {
    const p = u.role.perms || [];
    return u.id !== excludeId && (p.includes("*") || p.includes(perm));
  });
  if (targets.length === 0) return;
  await prisma.notification.createMany({ data: targets.map((u) => ({ userId: u.id, text, type })) });
  for (const u of targets) await sendMailToUser(u, "WC Finance — " + text.slice(0, 80), text);
}

// Real file upload into a request's Drive folder — a separate route from /api/rpc
// because that route is JSON-only and this one needs multipart/form-data. Falls back
// with a distinct error (FALLBACK_TO_LINK) when the request has no Drive folder, so the
// client can drop back to the paste-a-link modal instead of dead-ending the user.
export async function POST(req) {
  const me = await getSessionUser();
  if (!me) return err("Unauthorized", 401);
  const admin = can(me, "*") || (me.role.perms || []).includes("*");

  const form = await req.formData();
  const id = form.get("id");
  const idx = Number(form.get("idx"));
  const file = form.get("file");
  if (!id || !Number.isInteger(idx) || !file) return err("Missing id, idx, or file.");

  const r = await prisma.request.findUnique({ where: { id } });
  if (!r) return err("Not found", 404);
  if (!canManageRequestDocs(me, r, admin)) return err("Forbidden", 403);
  const doc = r.docs[idx];
  if (!doc) return err("Unknown document.");
  if (!isDocEditable({ phase: doc.phase, status: r.status, admin })) {
    return err(doc.phase === "post" ? "Closing documents open once funds are disbursed." : "Pre-reimbursement documents are locked after verification.");
  }
  if (!r.driveFolderId) return err("FALLBACK_TO_LINK", 409);

  const buffer = Buffer.from(await file.arrayBuffer());
  const driveName = buildDriveFileName({ docName: doc.name, date: new Date(), by: me.name, originalName: file.name });
  const uploaded = await uploadFileToFolder({ folderId: r.driveFolderId, name: driveName, mimeType: file.type || "application/octet-stream", buffer });
  if (!uploaded) return err("FALLBACK_TO_LINK", 409);

  const docs = r.docs;
  const result = applyDocAttachment(docs, idx, { link: uploaded.link, fileName: uploaded.fileName });
  if (result.error) return err(result.error);
  await prisma.request.update({ where: { id: r.id }, data: { docs } });
  await prisma.audit.create({ data: { user: me.name, role: me.role.name, action: 'Uploaded document "' + doc.name + '" for ' + r.id } });
  await notifyPerm("verify", r.id + ' — document "' + doc.name + '" submitted (Google Drive).', "docs_submitted", me.id);

  return NextResponse.json({ ok: true, link: uploaded.link, fileName: uploaded.fileName });
}
