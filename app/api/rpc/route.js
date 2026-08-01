import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSessionUser, can } from "@/lib/auth";
import { sendMailToUser } from "@/lib/mail";
import { ORDER, STATUS, ADV_PERM, ADV_LABELS } from "@/lib/constants";
import { seedDemo, ROLES } from "@/lib/seed-data.mjs";
import { canManageRequestDocs } from "@/lib/permissions.mjs";
import { advanceRequestTx, resolveDisburseAccount } from "@/lib/requests.mjs";
import { approveProjectionTx, settleProjectionTx } from "@/lib/projections.mjs";
import { resolveRequestSource } from "@/lib/direct-claim.mjs";
import { addVendorDocs } from "@/lib/vendor-docs.mjs";
import { editTxnTx } from "@/lib/txn-edit.mjs";
import { receiveRevenueTx } from "@/lib/revenue.mjs";
import { isDocEditable } from "@/lib/doc-phase.mjs";
import { canApproveCategory } from "@/lib/payment-routing.mjs";
import { validateVendorAtSubmission } from "@/lib/vendor-required.mjs";
import { payDepositTx, remainingAfterDeposit } from "@/lib/deposit.mjs";
import { canReturnForCorrection } from "@/lib/return-correction.mjs";
import { syncToSheets } from "@/lib/sheets-backup.mjs";

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
        const { title, categoryId, amount, desc, eventDate, projectionId, paidVia, vendor } = body;
        if (!title || !categoryId) return err("Fill title and category.");
        const cat = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!cat || !cat.active) return err("Unknown category.");
        const vendorCheck = validateVendorAtSubmission({ categoryVendorRequired: cat.vendorRequired, vendor });
        if (vendorCheck.error) return err(vendorCheck.error);
        let proj = null;
        if (projectionId) proj = await prisma.projection.findUnique({ where: { id: projectionId } });
        const source = resolveRequestSource({
          projectionId, projectionStatus: proj?.status || null, categoryAllowDirect: cat.allowDirect,
        });
        if (source.error) return err(source.error);
        const parsedEventDate = eventDate ? new Date(eventDate) : new Date();
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
            eventDate: isNaN(parsedEventDate) ? new Date() : parsedEventDate,
            docs: [
              ...cat.docsPre.map((name) => ({ name, phase: "pre", submitted: false, link: null, fileName: null, disc: null })),
              ...cat.docsPost.map((name) => ({ name, phase: "post", submitted: false, link: null, fileName: null, disc: null })),
            ],
            driveFolder: "https://drive.google.com/drive/folders/PFMS-" + id,
            projectionId: projectionId || null,
            directClaim: source.directClaim,
            paidVia: paidVia || cat.defaultPaidVia,
            vendor: (vendor || "").trim(),
          },
        });
        if (proj) {
          await prisma.projection.update({ where: { id: proj.id }, data: { status: "linked", requestId: id } });
        }
        await audit(me, "Submitted reimbursement " + id + (proj ? " against projection " + proj.id : ""));
        await notifyPerm("verify", "New reimbursement " + id + " (" + title + ") notified to Project Finance.", "notified", me.id);
        return NextResponse.json({ ok: true, id });
      }
      case "createProjection": {
        if (!can(me, "create")) return err("Forbidden", 403);
        const { title, categoryId, amount, expectedDate } = body;
        const parsedAmount = Number(amount);
        if (!title || !categoryId) return err("Fill item and category.");
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return err("Enter a positive amount.");
        const cat = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!cat || !cat.active) return err("Unknown category.");
        const counter = await prisma.counter.update({
          where: { id: "projection" },
          data: { value: { increment: 1 } },
        });
        const id = "PJ-" + counter.value;
        await prisma.projection.create({
          data: {
            id, title, categoryId, amount: parsedAmount,
            dept: me.dept, requesterId: me.id, requesterName: me.name,
            expectedDate: expectedDate ? new Date(expectedDate) : new Date(),
          },
        });
        await audit(me, "Submitted projection " + id + " (" + fmt(parsedAmount) + ") for " + me.dept);
        await notifyPerm("create", "New projected expense " + id + " submitted by " + me.dept + " (" + fmt(parsedAmount) + ").", "notified", me.id);
        return NextResponse.json({ ok: true, id });
      }
      case "approveProjection": {
        if (!can(me, "verify") && !admin) return err("Forbidden", 403);
        const proj = await prisma.projection.findUnique({ where: { id: body.id } });
        if (!proj) return err("Not found", 404);
        const projCat = await prisma.category.findUnique({ where: { id: proj.categoryId } });
        if (!canApproveCategory({ admin, hasVerifyPerm: can(me, "verify"), roleApproverKey: me.role.approverKey, categoryApproverRole: projCat?.approverRole })) {
          return err("This expense category is routed to another approver.");
        }
        if (proj.status !== "submitted") return err("This projection cannot be approved.");
        const faculty = await prisma.account.findUnique({ where: { id: "faculty" } });
        const project = await prisma.account.findUnique({ where: { id: "project" } });
        if (!faculty || !project || !faculty.active || !project.active) return err("Faculty or Project account is unavailable.");
        if (faculty.balance < proj.amount) return err("Insufficient balance in Faculty account for this advance.");
        const result = await approveProjectionTx(prisma, {
          id: proj.id, currentStatus: "submitted", amount: proj.amount,
          facultyAcctId: "faculty", projectAcctId: "project", title: proj.title,
        });
        if (result.conflict) return err("This projection was already advanced.");
        await audit(me, "Issued advance for projection " + proj.id + " (" + fmt(proj.amount) + ")");
        await notifyPerm("create", proj.id + " advance issued — " + fmt(proj.amount) + " transferred Faculty → Project.", "disbursed", me.id);
        return NextResponse.json({ ok: true });
      }
      case "toggleCategoryDirect": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        await prisma.category.update({ where: { id: c.id }, data: { allowDirect: !c.allowDirect } });
        await audit(me, (c.allowDirect ? "Disabled" : "Enabled") + " direct reimbursement for category " + c.name);
        return NextResponse.json({ ok: true, allowDirect: !c.allowDirect });
      }
      case "toggleCategoryVendorRequired": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        await prisma.category.update({ where: { id: c.id }, data: { vendorRequired: !c.vendorRequired } });
        await audit(me, (c.vendorRequired ? "Disabled" : "Enabled") + " vendor requirement for category " + c.name);
        return NextResponse.json({ ok: true, vendorRequired: !c.vendorRequired });
      }
      // Requester (or admin) answers whether the supplier is an already-registered vendor
      case "reportVendor": {
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        if (!canManageRequestDocs(me, r, admin)) return err("Forbidden", 403);
        const exists = body.exists === true;
        let docs = r.docs;
        if (!exists) {
          const vendorDocs = await prisma.masterDoc.findMany({ where: { vendorDoc: true } });
          docs = addVendorDocs(r.docs, vendorDocs.map((d) => d.name));
        }
        await prisma.request.update({ where: { id: r.id }, data: { vendorExists: exists, vendor: (body.vendor ?? r.vendor), docs } });
        await audit(me, exists ? "Confirmed existing vendor for " + r.id : "Reported new vendor for " + r.id + " — added vendor-registration documents");
        if (!exists) {
          await notifyPerm("verify", r.id + " — supplier is not a registered vendor; vendor-registration documents added to the checklist.", "notified", me.id);
        }
        return NextResponse.json({ ok: true });
      }

      case "advanceRequest": {
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        const i = ORDER.indexOf(r.status);
        if (i >= ORDER.length - 1) return err("Already closed.");
        const next = ORDER[i + 1];
        if (!admin && !can(me, ADV_PERM[next])) return err("Forbidden", 403);
        if (next === "verified") {
          const rCat = await prisma.category.findUnique({ where: { id: r.categoryId } });
          if (!canApproveCategory({ admin, hasVerifyPerm: can(me, "verify"), roleApproverKey: me.role.approverKey, categoryApproverRole: rCat?.approverRole })) {
            return err("This expense category is routed to another approver.");
          }
        }

        let acctId, proofLink, acctName;
        if (next === "disbursed") {
          const cat = await prisma.category.findUnique({ where: { id: r.categoryId } });
          const candidateId = body.acctId || cat?.defaultAcctId;
          const account = candidateId ? await prisma.account.findUnique({ where: { id: candidateId } }) : null;
          const resolved = resolveDisburseAccount({
            providedAcctId: body.acctId, categoryDefaultAcctId: cat?.defaultAcctId,
            account, proofLink: body.proofLink,
          });
          if (resolved.error) return err(resolved.error);
          ({ acctId, proofLink } = resolved);
          acctName = account?.name || acctId;
        }

        let disburseAmount = r.amount;
        if (next === "disbursed") {
          const remaining = remainingAfterDeposit({ requestAmount: r.amount, depositAmount: r.depositAmount, depositPaid: r.depositPaid });
          if (remaining.error) return err(remaining.error);
          disburseAmount = remaining.amount;
        }

        const result = await advanceRequestTx(prisma, {
          id: r.id, currentStatus: r.status, nextStatus: next,
          isDisbursement: next === "disbursed", amount: r.depositPaid ? disburseAmount : r.amount, title: r.title,
          acctId, proofLink,
        });
        if (result.conflict) return err("This request was just updated by someone else — please refresh and try again.", 409);
        if (next === "disbursed" && r.projectionId) {
          const proj = await prisma.projection.findUnique({ where: { id: r.projectionId } });
          if (proj && proj.status === "linked") {
            const settle = await settleProjectionTx(prisma, {
              id: proj.id, currentStatus: "linked", advancedAmount: proj.amount, actualAmount: r.amount,
              facultyAcctId: "faculty", projectAcctId: "project", title: proj.title,
            });
            if (!settle.conflict && settle.refund > 0) {
              await audit(me, "Returned unspent advance " + fmt(settle.refund) + " for " + r.id + " to Faculty account");
            }
          }
        }
        const label = STATUS[next].label + (next === "disbursed" ? " (" + fmt(r.amount) + " transferred)" : "");
        await audit(me, "Advanced " + r.id + " to " + STATUS[next].label + (next === "disbursed" ? " from account " + acctName : ""));
        await notifyUser(r.requesterId !== me.id ? r.requesterId : null, r.id + " — " + label + ".", next);
        await notifyPerm("disburse", r.id + " — " + label + ".", next, me.id);
        return NextResponse.json({ ok: true });
      }
      case "payDeposit": {
        if (!admin && !can(me, "disburse")) return err("Forbidden", 403);
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        if (r.depositPaid) return err("A deposit has already been paid for this request.");
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) return err("Enter a positive deposit amount.");
        if (amount >= r.amount) return err("The deposit cannot be the full (or more than the full) request amount — use normal disbursement instead.");
        const stream = await prisma.stream.findUnique({ where: { id: body.streamId } });
        if (!stream || !stream.active) return err("Purse is unavailable.");
        if (stream.balance < amount) return err("Insufficient balance in this purse for the deposit.");
        await payDepositTx(prisma, { reqId: r.id, streamId: stream.id, amount, projectAcctId: "project", title: r.title });
        await audit(me, "Paid deposit " + fmt(amount) + " for " + r.id + " from " + stream.name + " purse");
        await notifyUser(r.requesterId !== me.id ? r.requesterId : null, r.id + " — deposit of " + fmt(amount) + " paid from " + stream.name + ".", "disbursed");
        return NextResponse.json({ ok: true });
      }
      case "issuePurchaseOrder": {
        if (!admin && !can(me, "disburse")) return err("Forbidden", 403);
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        const vendor = (body.vendor || r.vendor || "").trim();
        if (!vendor) return err("Enter the vendor name.");
        const amount = Number(body.amount) || r.amount;
        const counter = await prisma.counter.update({ where: { id: "po" }, data: { value: { increment: 1 } } });
        const number = "PO-" + counter.value;
        const po = { number, vendor, amount, link: body.link || null, note: body.note || "", issuedAt: Date.now(), issuedBy: me.name };
        await prisma.request.update({ where: { id: r.id }, data: { po } });
        await audit(me, "Issued purchase order " + number + " for " + r.id + " to " + vendor);
        await notifyUser(r.requesterId !== me.id ? r.requesterId : null, r.id + " — purchase order " + number + " issued.", "notified");
        return NextResponse.json({ ok: true, number });
      }
      case "attachProofOfPayment": {
        if (!admin && !can(me, "disburse")) return err("Forbidden", 403);
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        if (!body.link) return err("Paste a link to the transfer slip / statement.");
        const payProof = { link: body.link.trim(), ref: body.ref || "", date: body.date || new Date().toISOString().slice(0, 10), note: body.note || "", by: me.name, byRole: me.role.name, ts: Date.now() };
        await prisma.request.update({ where: { id: r.id }, data: { payProof } });
        await audit(me, "Attached proof of payment for " + r.id);
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
        if (!isDocEditable({ phase: doc.phase, status: r.status })) {
          return err((doc.phase === "post" ? "Closing documents open once funds are disbursed." : "Pre-reimbursement documents are locked after verification."));
        }
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
      case "returnForCorrection": {
        if (!admin && !can(me, "verify")) return err("Forbidden", 403);
        const r = await prisma.request.findUnique({ where: { id: body.id } });
        if (!r) return err("Not found", 404);
        const reason = (body.reason || "").trim();
        const check = canReturnForCorrection({ status: r.status, reason });
        if (check.error) return err(check.error);
        await prisma.request.update({ where: { id: r.id }, data: { status: "notified", issueReason: reason } });
        await audit(me, "Returned " + r.id + " for correction — " + reason);
        await notifyUser(r.requesterId, r.id + " returned for correction: " + reason, "notified");
        return NextResponse.json({ ok: true });
      }

      // ---------- categories / master docs (admin) ----------
      case "createCategory": {
        if (!admin) return err("Forbidden", 403);
        if (!body.name) return err("Enter a category name.");
        await prisma.category.create({
          data: { name: body.name, nameTh: body.nameTh || body.name, notes: body.notes || "", docsPre: [], docsPost: [], docExamples: {}, defaultAcctId: body.defaultAcctId || null },
        });
        await audit(me, "Created category " + body.name);
        return NextResponse.json({ ok: true });
      }
      case "updateCategoryNotes": {
        if (!admin) return err("Forbidden", 403);
        await prisma.category.update({ where: { id: body.id }, data: { notes: body.notes || "" } });
        return NextResponse.json({ ok: true });
      }
      case "updateCategoryAccount": {
        if (!admin) return err("Forbidden", 403);
        await prisma.category.update({ where: { id: body.id }, data: { defaultAcctId: body.defaultAcctId || null } });
        return NextResponse.json({ ok: true });
      }
      case "updateCategoryPaymentRouting": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        await prisma.category.update({
          where: { id: c.id },
          data: { defaultPaidVia: body.defaultPaidVia || "finance", approverRole: body.approverRole || "faculty_finance" },
        });
        await audit(me, "Updated payment routing for category " + c.name);
        return NextResponse.json({ ok: true });
      }
      case "closeCategory": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        await prisma.category.update({ where: { id: c.id }, data: { active: false } });
        await audit(me, "Closed category " + c.name);
        return NextResponse.json({ ok: true });
      }
      case "toggleCatDoc": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        const field = body.phase === "post" ? "docsPost" : "docsPre";
        const list = c[field];
        const docs = list.includes(body.name) ? list.filter((d) => d !== body.name) : [...list, body.name];
        await prisma.category.update({ where: { id: c.id }, data: { [field]: docs } });
        return NextResponse.json({ ok: true });
      }
      case "addCatDoc": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        const name = (body.name || "").trim();
        if (!name) return err("Empty document name.");
        const field = body.phase === "post" ? "docsPost" : "docsPre";
        if (!c[field].includes(name)) {
          await prisma.category.update({ where: { id: c.id }, data: { [field]: [...c[field], name] } });
          await audit(me, 'Added ' + (field === "docsPost" ? "closing" : "pre-reimbursement") + ' document "' + name + '" to category ' + c.name);
        }
        return NextResponse.json({ ok: true });
      }
      case "setCatDocExample": {
        if (!admin) return err("Forbidden", 403);
        if (!body.link) return err("Paste a Drive link for the example.");
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        const docExamples = { ...c.docExamples, [body.name]: { link: body.link.trim(), name: body.fileName || null } };
        await prisma.category.update({ where: { id: c.id }, data: { docExamples } });
        return NextResponse.json({ ok: true });
      }
      case "clearCatDocExample": {
        if (!admin) return err("Forbidden", 403);
        const c = await prisma.category.findUnique({ where: { id: body.id } });
        if (!c) return err("Not found", 404);
        const docExamples = { ...c.docExamples };
        delete docExamples[body.name];
        await prisma.category.update({ where: { id: c.id }, data: { docExamples } });
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
      case "toggleMasterDocVendor": {
        if (!admin) return err("Forbidden", 403);
        const doc = await prisma.masterDoc.findUnique({ where: { id: body.id } });
        if (!doc) return err("Not found", 404);
        await prisma.masterDoc.update({ where: { id: doc.id }, data: { vendorDoc: !doc.vendorDoc } });
        await audit(me, (doc.vendorDoc ? "Removed" : "Added") + ' vendor-registration document "' + doc.name + '"');
        return NextResponse.json({ ok: true, vendorDoc: !doc.vendorDoc });
      }

      // ---------- accounts (admin) ----------
      case "createAccount": {
        if (!admin) return err("Forbidden", 403);
        if (!body.name) return err("Enter an account name.");
        const acct = await prisma.account.create({
          data: { name: body.name, nameTh: body.nameTh || body.name, icon: body.icon || "ph-bank", balance: 0 },
        });
        await audit(me, "Created account " + acct.name);
        return NextResponse.json({ ok: true, id: acct.id });
      }
      case "createStream": {
        if (!admin) return err("Forbidden", 403);
        if (!body.name) return err("Enter a purse name.");
        const s = await prisma.stream.create({
          data: { acctId: body.acctId || "project", name: body.name, nameTh: body.nameTh || body.name, color: body.color || "#f0378a" },
        });
        await audit(me, "Created purse " + s.name);
        return NextResponse.json({ ok: true, id: s.id });
      }
      case "createRevenue": {
        if (!admin && !can(me, "accounts")) return err("Forbidden", 403);
        const { title, source, amount, expectedDate, streamId } = body;
        const parsedAmount = Number(amount);
        if (!title) return err("Enter a title.");
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return err("Enter a positive amount.");
        const counter = await prisma.counter.update({ where: { id: "revenue" }, data: { value: { increment: 1 } } });
        const id = "RV-" + counter.value;
        await prisma.revenue.create({
          data: {
            id, title, source: source || "", amount: parsedAmount, streamId: streamId || null,
            expectedDate: expectedDate ? new Date(expectedDate) : new Date(),
          },
        });
        await audit(me, "Projected revenue " + id + " — " + title + " (" + fmt(parsedAmount) + ")");
        return NextResponse.json({ ok: true, id });
      }
      case "receiveRevenue": {
        if (!admin && !can(me, "accounts")) return err("Forbidden", 403);
        const rv = await prisma.revenue.findUnique({ where: { id: body.id } });
        if (!rv) return err("Not found", 404);
        if (rv.status !== "projected") return err("This revenue is already recorded.");
        const acct = await prisma.account.findUnique({ where: { id: rv.acctId } });
        if (!acct || !acct.active) return err("Target account is unavailable.");
        const result = await receiveRevenueTx(prisma, {
          id: rv.id, currentStatus: "projected", amount: rv.amount,
          acctId: rv.acctId, streamId: rv.streamId, title: rv.title,
        });
        if (result.conflict) return err("This revenue was already recorded.");
        await audit(me, "Received revenue " + rv.id + " (" + fmt(rv.amount) + ")");
        await notifyPerm("accounts", rv.id + " — revenue received: " + fmt(rv.amount) + ".", "disbursed", me.id);
        return NextResponse.json({ ok: true });
      }
      case "updateAccount": {
        if (!admin) return err("Forbidden", 403);
        if (!body.name) return err("Enter an account name.");
        const acct = await prisma.account.findUnique({ where: { id: body.id } });
        if (!acct) return err("Not found", 404);
        await prisma.account.update({
          where: { id: body.id },
          data: { name: body.name, nameTh: body.nameTh || body.name, icon: body.icon || "ph-bank" },
        });
        return NextResponse.json({ ok: true });
      }
      case "closeAccount": {
        if (!admin) return err("Forbidden", 403);
        const acct = await prisma.account.findUnique({ where: { id: body.id } });
        if (!acct) return err("Not found", 404);
        await prisma.account.update({ where: { id: body.id }, data: { active: false } });
        await audit(me, "Closed account " + acct.name);
        return NextResponse.json({ ok: true });
      }
      case "addFunds": {
        if (!admin) return err("Forbidden", 403);
        const amount = Number(body.amount) || 0;
        if (amount <= 0) return err("Enter a positive amount.");
        const acct = await prisma.account.update({
          where: { id: body.acctId }, data: { balance: { increment: amount } },
        });
        await prisma.txn.create({ data: { acctId: acct.id, type: "in", amount, desc: body.desc || "Funds added" } });
        await audit(me, "Added " + fmt(amount) + " to account " + acct.name);
        return NextResponse.json({ ok: true });
      }
      case "editTransaction": {
        if (!admin) return err("Forbidden", 403);
        const newAmount = Number(body.amount);
        const reason = (body.reason || "").trim();
        if (!Number.isFinite(newAmount) || newAmount < 0) return err("Enter a valid amount (zero or more).");
        if (reason.length < 3) return err("A reason is required for every figure change.");
        const txn = await prisma.txn.findUnique({ where: { id: body.id } });
        if (!txn) return err("Not found", 404);
        if (newAmount === txn.amount) return err("The amount is unchanged.");
        const { delta } = await editTxnTx(prisma, {
          id: txn.id, acctId: txn.acctId, type: txn.type, oldAmount: txn.amount, newAmount,
        });
        await audit(me, "Correction — transaction \"" + txn.desc + "\" changed from " + fmt(txn.amount) + " to " + fmt(newAmount) + ". Reason: " + reason);
        return NextResponse.json({ ok: true, delta });
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
      case "updateRoleApproverKey": {
        if (!admin) return err("Forbidden", 403);
        const role = await prisma.role.findUnique({ where: { id: body.id } });
        if (!role) return err("Not found", 404);
        const key = body.approverKey || null;
        if (key && !["faculty_finance", "faculty_purchasing"].includes(key)) return err("Unknown approver key.");
        await prisma.role.update({ where: { id: role.id }, data: { approverKey: key } });
        await audit(me, "Set approver key for role " + role.name + " to " + (key || "none"));
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
      case "toggleRoleAdvDash": {
        if (!admin) return err("Forbidden", 403);
        const role = await prisma.role.findUnique({ where: { id: body.id } });
        if (!role) return err("Not found", 404);
        await prisma.role.update({ where: { id: role.id }, data: { canSeeAdvances: !role.canSeeAdvances } });
        await audit(me, (role.canSeeAdvances ? "Revoked" : "Granted") + " Projected Expenses dashboard visibility for role " + role.name);
        return NextResponse.json({ ok: true, canSeeAdvances: !role.canSeeAdvances });
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
      case "backupToSheets": {
        if (!admin) return err("Forbidden", 403);
        const result = await syncToSheets({ prisma });
        if (!result.ok) return err(result.error, 502);
        await audit(me, "Ran Google Sheets backup sync");
        return NextResponse.json({ ok: true, syncedAt: result.syncedAt });
      }

      default:
        return err("Unknown action: " + action);
    }
  } catch (e) {
    console.error(e);
    return err("Server error: " + e.message, 500);
  }
}
