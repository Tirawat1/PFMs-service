import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { readSession, seesAllDepts, SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET /api/requests?status=&dept= — scoped to the caller's department unless they see all. */
export async function GET(request) {
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const role = await prisma.role.findUnique({ where: { id: session.roleId } });
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const dept = url.searchParams.get('dept');

  const where = {};
  if (status) where.status = status;
  if (seesAllDepts(role?.permissions)) {
    if (dept && dept !== 'all') where.dept = dept;
  } else {
    where.dept = session.dept; // hard scope — a department never sees another's rows
  }

  const requests = await prisma.request.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { category: true, docs: true, requester: { select: { id: true, name: true } } }
  });

  // BigInt is not JSON-serialisable; send satang as strings.
  return Response.json(
    JSON.parse(JSON.stringify(requests, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
  );
}
