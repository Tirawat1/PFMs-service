import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  let database = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'up';
  } catch {
    database = 'down';
  }

  const body = {
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    uptimeSeconds: Math.round(process.uptime()),
    latencyMs: Date.now() - started,
    version: process.env.APP_VERSION || '1.0.0',
    time: new Date().toISOString()
  };

  return Response.json(body, { status: database === 'up' ? 200 : 503 });
}
