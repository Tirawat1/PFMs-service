import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, can, sanitizeUser } from "@/lib/auth";
import { shapeSnapshot } from "@/lib/snapshot.mjs";

// Returns the full app snapshot, filtered by the caller's permissions.
export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = can(me, "*") || (me.role.perms || []).includes("*");

  const [roles, users, categories, masterDocs, accounts, txns, requests, notifs, audit] =
    await Promise.all([
      prisma.role.findMany(),
      prisma.user.findMany({ include: { role: true } }),
      prisma.category.findMany(),
      prisma.masterDoc.findMany(),
      prisma.account.findMany(),
      prisma.txn.findMany({ orderBy: { date: "desc" }, take: 200 }),
      prisma.request.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.notification.findMany({ where: { userId: me.id }, orderBy: { ts: "desc" }, take: 100 }),
      admin ? prisma.audit.findMany({ orderBy: { ts: "desc" }, take: 300 }) : Promise.resolve([]),
    ]);

  const shaped = shapeSnapshot(
    { admin, canAccounts: can(me, "accounts"), canRequests: can(me, "requests") },
    { roles, users: users.map(sanitizeUser), categories, masterDocs, accounts, txns, requests, notifs, audit }
  );

  return NextResponse.json({ me: sanitizeUser(me), ...shaped });
}
