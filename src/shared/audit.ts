import type { Executor } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export interface AuditInput {
  actorUserId?: string | null;
  actorType?: 'user' | 'system' | 'ai';
  /** Dotted verb, e.g. `admin.user_created`, `source.permission_changed`. */
  action: string;
  subjectType: string;
  subjectId?: string | null;
  caseId?: string | null;
  /** Non-secret context only. Never put credentials or full private text here. */
  properties?: Record<string, unknown>;
  requestId?: string | null;
}

/**
 * Append an audit event.
 *
 * PRD §16.1 requires audit records for invitations, confirmations, publishes
 * and deletions; §5.2 requires the authorization basis of a published item to
 * be recoverable. Accepts a transaction so the audit row commits with the
 * change it describes.
 *
 * Never record credentials or unnecessary private text — `properties` is for
 * identifiers, counts and decisions.
 */
export async function writeAuditLog(db: Executor, input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorType ?? 'user',
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    caseId: input.caseId ?? null,
    properties: input.properties ?? {},
    requestId: input.requestId ?? null,
  });
}
