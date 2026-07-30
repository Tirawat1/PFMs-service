import { prisma } from './db.js';

/**
 * Every state change writes one audit line. Call inside the same transaction
 * as the change so the trail can never diverge from the data.
 */
export async function audit(tx, { text, actor, refId }) {
  const client = tx ?? prisma;
  return client.auditEntry.create({
    data: {
      text,
      refId: refId ?? null,
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      actorRole: actor?.roleName ?? null
    }
  });
}

export async function notify(tx, { text, topic, refId, userId, sender, senderRole, dept }) {
  const client = tx ?? prisma;
  return client.notification.create({
    data: { text, topic, refId, userId, sender, senderRole, dept }
  });
}
