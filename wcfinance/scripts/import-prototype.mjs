#!/usr/bin/env node
/**
 * One-way import of a browser prototype's local-storage export into Postgres.
 *
 *   1. In the running prototype: Settings → Export data  (saves pfms-export.json)
 *   2. node scripts/import-prototype.mjs pfms-export.json
 *
 * Idempotent: existing ids are updated, not duplicated. Passwords are NOT
 * imported — the prototype stores them in clear text. Users arrive disabled
 * with a random hash; set real passwords before enabling them.
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/import-prototype.mjs <export.json>'); process.exit(1); }

const db = JSON.parse(readFileSync(file, 'utf8'));
const S = (baht) => BigInt(Math.round(Number(baht || 0) * 100));
const D = (ms) => (ms ? new Date(Number(ms)) : null);

async function main() {
  for (const r of db.roles || []) {
    await prisma.role.upsert({ where: { id: r.id }, update: { name: r.name, permissions: r.perms || [] }, create: { id: r.id, name: r.name, permissions: r.perms || [] } });
  }

  for (const u of db.users || []) {
    const passwordHash = await bcrypt.hash(randomBytes(24).toString('hex'), 12);
    await prisma.user.upsert({
      where: { username: u.username },
      update: { name: u.name, dept: u.dept || null, email: u.email || null, roleId: u.roleId },
      create: { id: u.id, name: u.name, username: u.username, passwordHash, dept: u.dept || null, email: u.email || null, emailNotify: !!u.emailNotify, roleId: u.roleId, active: false }
    });
  }

  for (const a of db.accounts || []) {
    await prisma.account.upsert({ where: { id: a.id }, update: { name: a.name, balance: S(a.balance) }, create: { id: a.id, name: a.name, nameTh: a.nameTh, icon: a.icon, balance: S(a.balance), active: a.active !== false } });
  }

  for (const s of db.streams || []) {
    await prisma.stream.upsert({ where: { id: s.id }, update: { name: s.name, balance: S(s.balance) }, create: { id: s.id, name: s.name, color: s.color, icon: s.icon, balance: S(s.balance) } });
  }

  for (const c of db.categories || []) {
    const data = {
      name: c.name, nameTh: c.nameTh, icon: c.icon, notes: c.notes || null,
      docsPre: c.docsPre || [], docsPost: c.docsPost || [], docExamples: c.docExamples || {},
      defaultAcctId: c.defaultAcctId || null, defaultPaidVia: c.defaultPaidVia || 'finance',
      approverRole: c.approverRole || 'faculty_finance', vendorRequired: !!c.vendorRequired,
      requireCompletionDocs: c.requireCompletionDocs !== false, allowDirect: !!c.allowDirect,
      active: c.active !== false
    };
    await prisma.category.upsert({ where: { id: c.id }, update: data, create: { id: c.id, ...data } });
  }

  for (const p of db.projections || []) {
    const data = { title: p.title, categoryId: p.categoryId, dept: p.dept, requesterId: p.requesterId, amount: S(p.amount), expectedDate: D(p.expectedDate), status: p.status, vendorRequired: !!p.vendorRequired };
    await prisma.projection.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data, createdAt: D(p.createdAt) || new Date() } });
  }

  for (const r of db.requests || []) {
    const data = {
      title: r.title, categoryId: r.categoryId, accountId: r.acctId || r.accountId || null,
      streamId: r.streamId || null, amount: S(r.amount),
      actualAmount: r.actualAmount != null ? S(r.actualAmount) : null, refundAmount: S(r.refundAmount),
      dept: r.dept, requesterId: r.requesterId, status: r.status, paidVia: r.paidVia || 'finance',
      fundRoute: r.fundRoute || null, vendor: r.vendor || null, vendorRequired: !!r.vendorRequired,
      vendorExists: r.vendorExists ?? null, driveFolder: r.driveFolder || null,
      issueReason: r.issueReason || null, directClaim: !!r.directClaim,
      bank: r.bank || null, payProof: r.payProof || null, po: r.po || null,
      eventDate: D(r.eventDate), projectionId: r.projectionId || null
    };
    await prisma.request.upsert({ where: { id: r.id }, update: data, create: { id: r.id, ...data, createdAt: D(r.createdAt) || new Date() } });

    await prisma.requestDoc.deleteMany({ where: { requestId: r.id } });
    for (const d of r.docs || []) {
      await prisma.requestDoc.create({ data: { requestId: r.id, name: d.name, phase: d.phase || 'pre', submitted: !!d.submitted, link: d.link || null, fileName: d.fileName || null, disc: d.disc || null } });
    }
  }

  for (const t of db.txns || []) {
    await prisma.transaction.upsert({
      where: { id: t.id },
      update: {},
      create: { id: t.id, accountId: t.acctId, streamId: t.streamId || null, type: t.type, amount: S(t.amount), desc: t.desc, date: D(t.date) || new Date() }
    });
  }

  for (const v of db.revenues || []) {
    const data = { title: v.title, source: v.source, accountId: v.accountId, streamId: v.streamId || null, amount: S(v.amount), expectedDate: D(v.expectedDate), status: v.status };
    await prisma.revenue.upsert({ where: { id: v.id }, update: data, create: { id: v.id, ...data, createdAt: D(v.createdAt) || new Date() } });
  }

  const counts = {
    users: await prisma.user.count(), categories: await prisma.category.count(),
    requests: await prisma.request.count(), projections: await prisma.projection.count(),
    transactions: await prisma.transaction.count(), revenues: await prisma.revenue.count()
  };
  console.log('import complete:', counts);
  console.log('! imported users are DISABLED with random passwords — set real ones, then activate.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
