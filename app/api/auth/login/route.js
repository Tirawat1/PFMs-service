import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession, sanitizeUser } from "@/lib/auth";
import { seedBaseline } from "@/lib/seed-data.mjs";

export async function POST(req) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  // First-run bootstrap: if the DB has no roles/users yet, create baseline
  // data + the admin account from env so the app is usable immediately.
  const roleCount = await prisma.role.count();
  if (roleCount === 0) await seedBaseline(prisma);

  const user = await prisma.user.findUnique({
    where: { username: username.trim() },
    include: { role: true },
  });
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }
  await createSession(user.id);
  return NextResponse.json({ me: sanitizeUser(user) });
}
