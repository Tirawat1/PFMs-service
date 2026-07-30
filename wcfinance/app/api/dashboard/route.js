import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { readSession, seesAllDepts, SESSION_COOKIE } from '@/lib/auth';
import { REIMBURSED_STATUSES } from '@/lib/workflow';

export const dynamic = 'force-dynamic';

/** Projected vs reimbursed, overall and per department. */
export async function GET(request) {
  const session = await readSession(cookies().get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  const role = await prisma.role.findUnique({ where: { id: session.roleId } });
  const all = seesAllDepts(role?.permissions);
  const dept = all ? new URL(request.url).searchParams.get('dept') : session.dept;
  const scope = dept && dept !== 'all' ? { dept } : {};

  const [projections, requests] = await Promise.all([
    prisma.projection.findMany({ where: scope, select: { dept: true, amount: true } }),
    prisma.request.findMany({ where: scope, select: { dept: true, amount: true, status: true } })
  ]);

  const byDept = new Map();
  const bucket = (d) => {
    if (!byDept.has(d)) byDept.set(d, { dept: d, projected: 0n, reimbursed: 0n, requests: 0 });
    return byDept.get(d);
  };

  for (const p of projections) bucket(p.dept).projected += p.amount;
  for (const r of requests) {
    const b = bucket(r.dept);
    b.requests += 1;
    if (REIMBURSED_STATUSES.includes(r.status)) b.reimbursed += r.amount;
  }

  const rows = [...byDept.values()].map((b) => ({
    dept: b.dept,
    requests: b.requests,
    projected: b.projected.toString(),
    reimbursed: b.reimbursed.toString(),
    coverage: b.projected > 0n ? Number(b.reimbursed) / Number(b.projected) : null
  }));

  const projected = projections.reduce((s, p) => s + p.amount, 0n);
  const reimbursed = requests
    .filter((r) => REIMBURSED_STATUSES.includes(r.status))
    .reduce((s, r) => s + r.amount, 0n);

  return Response.json({
    scope: dept && dept !== 'all' ? dept : 'all',
    totals: {
      projected: projected.toString(),
      reimbursed: reimbursed.toString(),
      coverage: projected > 0n ? Number(reimbursed) / Number(projected) : null
    },
    byDept: rows.sort((a, b) => Number(b.reimbursed) - Number(a.reimbursed))
  });
}
