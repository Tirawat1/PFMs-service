import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyPassword, createSession, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';

const Body = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200)
});

export async function POST(request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid request.' }, { status: 400 });

  const { username, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { username }, include: { role: true } });

  // Same response either way — never reveal which half was wrong.
  const ok = user && user.active && (await verifyPassword(password, user.passwordHash));
  if (!ok) return Response.json({ error: 'Incorrect username or password.' }, { status: 401 });

  const token = await createSession({ userId: user.id, roleId: user.roleId, dept: user.dept });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return Response.json({
    user: { id: user.id, name: user.name, dept: user.dept, role: { id: user.role.id, name: user.role.name, permissions: user.role.permissions } }
  });
}
