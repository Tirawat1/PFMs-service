import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSessionUser, can } from "@/lib/auth";
import { sendMailToUser } from "@/lib/mail";
import { ORDER, STATUS, ADV_PERM, ADV_LABELS } from "@/lib/constants";
import { seedDemo, ROLES } from "@/lib/seed-data.mjs";
import { canManageRequestDocs } from "@/lib/permissions.mjs";
import { advanceRequestTx } from "@/lib/requests.mjs";

const err = (msg, status = 400) => NextResponse.json({ error: msg }, { status });
const fmt = (n) => "฿" + Math.round(n).toLocaleString("en-US");

async function audit(me, action) {
  await prisma.audit.create({ data: { user: me.name, role: me.role.name, action } });
}

async function notifyUser(userId, text, type) {
  if (!userId) return;
  await prisma.notification.create({ data: { userId, text, type } });
  const u = await prisma.user.findUnique({ where: { id: userId } });
  await sendMailToUser(u, "WC Finance — " + text.slice(0, 80), text);
}

// notify every user whose role includes `perm` (or admin), except `excludeId`
async function notifyPerm(perm, text, type, excludeId) {
  const users = await prisma.user.findMany({ include: { role: true } });
  const targets = users.filter((u) => {
    const p = u.role.perms || [];
    return u.id !== excludeId && (p.includes("*") || p.includes(perm));
  });
  if (targets.length === 0) return;
  await prisma.notification.createMany({
    data: targets.map((u) => ({ userId: u.id, text, type })),
  });
  for (const u of targets) await sendMailToUser(u, "WC Finance — " + text.slice(0, 80), text);
}

export async function POST(req) {
  const me = await getSessionUser();
  if (!me) return err("Unauthorized", 401);
  const admin = (me.role.perms || []).includes("*");
  const body = await req.json();
  const { action } = body;

  try {
    switch (action) {
      // ---------- requests ----------
      case "createRequest": {
        if (!can(me, "create")) return err("Forbidden", 403);
        const { title, categoryId, amount, desc } = body;
        if (!title || !categoryId) return err("Fill title and category.");
        const cat = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!cat) return err("Unknown category.");
        const counter = await prisma.counter.update({
          where: { id: "request" },
          data: { value: { increment: 1 } },
        });
        const id = "RB-" + counter.value;
        await prisma.request.create({
          data: {
            id, title, categoryId, amount: Number(amount) || 0,
            dept: me.dept, requesterId: me.id, requesterName: me.name,
            desc: desc || "", status: "notified",
            docs: cat.docs.map((name) => ({ name, submitted: false, link: null, fileName: null, disc: null })),
            driveFolder: "https://drive.google.com/drive/folders/PFMS-" + id,
          },
        });
        await audit(me, "Submitted reimbursement " + id);
        await notifyPerm("verify", "New reimbursement " + id + " (" + title + ") notified to Project Finance.", "notified", me.id);
        return NextResponse.json({ ok: true, id });
      }

      case "advanceRequest": {
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        const i = ORDER.indexOf(r.status);
        if (i >= ORDER.length - 1) return err("Already closed.");
        const next = ORDER[i + 1];
        if (!admin && !can(me, ADV_PERM[next])) return err("Forbidden", 403);
        const result = await advanceRequestTx(prisma, {
          id: r.id, currentStatus: r.status, nextStatus: next,
          isDisbursement: next === "disbursed", amount: r.amount, title: r.title,
        });
        if (result.conflict) return err("This request was just updated by someone else — please refresh and try again.", 409);
        const label = STATUS[next].label + (next === "disbursed" ? " (" + fmt(r.amount) + " transferred)" : "");
        await audit(me, "Advanced " + r.id + " to " + STATUS[next].label);
        await notifyUser(r.requesterId !== me.id ? r.requesterId : null, r.id + " — " + label + ".", next);
        await notifyPerm("disburse", r.id + " — " + label + ".", next, me.id);
        return NextResponse.json({ ok: true });
      }

      // ---------- documents ----------
      case "attachDoc":
      case "detachDoc": {
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        if (!canManageRequestDocs(me, r, admin)) return err("Forbidden", 403);
        const docs = r.docs;
        const doc = docs[body.idx];
        if (!doc) return err("Unknown document.");
        if (action === "attachDoc") {
          if (!body.link) return err("Paste a Google Drive link.");
          doc.submitted = true;
          doc.link = body.link.trim();
          doc.fileName = body.fileName || null;
          if (doc.disc && doc.disc.open) doc.disc.fixed = true;
          await audit(me, 'Submitted document "' + doc.name + '" for ' + r.id);
          await notifyPerm("verify", r.id + ' — document "' + doc.name + '" submitted (Google Drive).', "docs_submitted", me.id);
        } else {
          doc.submitted = false;
          doc.link = null;
          doc.fileName = null;
        }
        await prisma.request.update({ where: { id: r.id }, data: { docs } });
        return NextResponse.json({ ok: true });
      }

      // Officer/admin flags a document discrepancy (needs change)
      case "flagDiscrepancy": {
        if (!admin && !can(me, "verify")) return err("Forbidden", 403);
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        const docs = r.docs;
        const doc = docs[body.idx];
        if (!doc) return err("Unknown document.");
        doc.disc = { open: true, note: body.note || "", by: me.name, ts: Date.now(), fixed: false, fixedNote: "" };
        await prisma.request.update({ where: { id: r.id }, data: { docs } });
        await audit(me, 'Flagged discrepancy on "' + doc.name + '" (' + r.id + ")");
        await notifyUser(r.requesterId, r.id + ' — discrepancy flagged on "' + doc.name + '": ' + (body.note || "please revise the document."), "discrepancy");
        return NextResponse.json({ ok: true });
      }

      // Requester marks the flagged document as changed/fixed
      case "markFixed": {
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        if (!canManageRequestDocs(me, r, admin)) return err("Forbidden", 403);
        const docs = r.docs;
        const doc = docs[body.idx];
        if (!doc || !doc.disc || !doc.disc.open) return err("No open discrepancy.");
        doc.disc.fixed = true;
        doc.disc.fixedNote = body.note || "";
        await prisma.request.update({ where: { id: r.id }, data: { docs } });
        await audit(me, 'Marked "' + doc.name + '" as revised (' + r.id + ")");
        await notifyPerm("verify", r.id + ' — "' + doc.name + '" was revised by ' + me.name + ". Please re-check.", "fixed", me.id);
        return NextResponse.json({ ok: true });
      }

      // Officer marks the discrepancy case as solved
      case "resolveDiscrepancy": {
        if (!admin && !can(me, "verify")) return err("Forbidden", 403);
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        const docs = r.docs;
        const doc = docs[body.idx];
        if (!doc || !doc.disc) return err("No discrepancy.");
        doc.disc = null;
        await prisma.request.update({ where: { id: r.id }, data: { docs } });
        await audit(me, 'Resolved discrepancy on "' + doc.name + '" (' + r.id + ")");
        await notifyUser(r.requesterId, r.id + ' — discrepancy on "' + doc.name + '" marked solved by ' + me.name + ".", "solved");
        return NextResponse.json({ ok: true });
      }

      // ---------- categories / master docs (admin) ----------
      case "createCategory": {
        if (!admin) return err("Forbidden", 403);
        if (!body.name) return err("Enter a category name.");
        await prisma.category.create({ data: { name: body.name, nameTh: body.nameTh || body.name, notes: body.notes || "", docs: [] } });
        await audit(me, "Created category " + body.name);
        return NextResponse.json({ ok: true });
      }
      case "updateCategoryNotes": {
        if (!admin) return err("Forbidden", 403);
        await prisma.category.update({ where: { id: body.id }, data: { notes: body.notes || "" } });
        return NextResponse.json({ ok: true });
      }
      case "toggleCatDoc": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        const docs = c.docs.includes(body.name) ? c.docs.filter((d) => d !== body.name) : [...c.docs, body.name];
        await prisma.category.update({ where: { id: c.id }, data: { docs } });
        return NextResponse.json({ ok: true });
      }
      case "addCatDoc": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        const name = (body.name || "").trim();
        if (!name) return err("Empty document name.");
        if (!c.docs.includes(name)) {
          await prisma.category.update({ where: { id: c.id }, data: { docs: [...c.docs, name] } });
          await audit(me, 'Added document "' + name + '" to category ' + c.name);
        }
        return NextResponse.json({ ok: true });
      }
      case "addMasterDoc": {
        if (!admin) return err("Forbidden", 403);
        const name = (body.name || "").trim();
        if (!name) return err("Empty document name.");
        await prisma.masterDoc.upsert({ where: { name }, create: { name }, update: {} });
        await audit(me, 'Added master document "' + name + '"');
        return NextResponse.json({ ok: true });
      }
      case "removeMasterDoc": {
        if (!admin) return err("Forbidden", 403);
        await prisma.masterDoc.deleteMany({ where: { name: body.name } });
        return NextResponse.json({ ok: true });
      }

      // ---------- users & roles (admin) ----------
      case "createUser": {
        if (!admin) return err("Forbidden", 403);
        if (!body.name || !body.username || !body.password) return err("Fill name, username and password.");
        const exists = await prisma.user.findUnique({ where: { username: body.username.trim() } });
        if (exists) return err("Username already taken.");
        await prisma.user.create({
          data: {
            name: body.name, username: body.username.trim(),
            passwordHash: bcrypt.hashSync(body.password, 10),
            dept: body.dept || "", roleId: body.roleId, email: body.email || "",
          },
        });
        await audit(me, "Added user " + body.name);
        return NextResponse.json({ ok: true });
      }
      case "deleteUser": {
        if (!admin) return err("Forbidden", 403);
        if (body.id === me.id) return err("You cannot delete yourself.");
        const u = await prisma.user.delete({ where: { id: body.id } });
        await audit(me, "Removed user " + u.name);
        return NextResponse.json({ ok: true });
      }
      case "createRole": {
        if (!admin) return err("Forbidden", 403);
        if (!body.name) return err("Enter a role name.");
        await prisma.role.create({
          data: { name: body.name, nameTh: body.nameTh || body.name, perms: body.perms || ["dashboard"], contact: body.contact || "" },
        });
        await audit(me, "Created role " + body.name);
        return NextResponse.json({ ok: true });
      }
      case "deleteRole": {
        if (!admin) return err("Forbidden", 403);
        const inUse = await prisma.user.count({ where: { roleId: body.id } });
        if (inUse) return err("Role is assigned to " + inUse + " user(s).");
        const r = await prisma.role.findUnique({ where: { id: body.id } });
        if (r?.system) return err("System role cannot be deleted.");
        await prisma.role.delete({ where: { id: body.id } });
        await audit(me, "Removed role " + (r?.name || body.id));
        return NextResponse.json({ ok: true });
      }

      // ---------- misc ----------
      case "markAllRead": {
        await prisma.notification.updateMany({ where: { userId: me.id }, data: { read: true } });
        return NextResponse.json({ ok: true });
      }
      case "updateSettings": {
        await prisma.user.update({
          where: { id: me.id },
          data: { email: body.email ?? me.email, emailNotify: !!body.emailNotify },
        });
        return NextResponse.json({ ok: true });
      }
      case "loadDemoData": {
        if (!admin) return err("Forbidden", 403);
        const reqCount = await prisma.request.count();
        if (reqCount > 0) return err("Database already has requests — demo data not loaded.");
        const roles = await prisma.role.findMany();
        const roleIds = {};
        for (const seedRole of ROLES) {
          const match = roles.find((r) => r.name === seedRole.name);
          if (match) roleIds[seedRole.key] = match.id;
        }
        await seedDemo(prisma, roleIds);
        await audit(me, "Loaded demo dataset");
        return NextResponse.json({ ok: true });
      }

      default:
        return err("Unknown action: " + action);
    }
  } catch (e) {
    console.error(e);
    return err("Server error: " + e.message, 500);
  }
}
