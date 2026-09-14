import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { siteVisits, sources, followupVersions, users } from '../../db/schema.js';
import { parseBearerToken } from '../../http/auth.js';
import { cookieToken } from '../../http/session-cookie.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { AppError, success } from '../../http/errors.js';
import { resolveSession } from '../identity/service.js';
import { hashToken } from '../identity/tokens.js';
import type { AppInstance, ModuleContext } from '../../shared/types.js';

const VISITOR_COOKIE = 'andthen_vid';
const pageSchema = z.string().max(400).regex(/^\/(?:\?screen=\d{2}(?:&[a-z_]+=[A-Za-z0-9._~%-]+)*)?$/);
const bodySchema = z.object({
  client_event_id: z.string().uuid(),
  page: pageSchema,
  source_id: z.string().uuid().optional(),
  followup_id: z.string().uuid().optional(),
  dwell_ms: z.number().int().min(0).max(1_800_000).default(0),
}).strict();

function readVisitorCookie(request: { headers: { cookie?: string } }): string | null {
  const prefix = `${VISITOR_COOKIE}=`;
  const values = (request.headers.cookie ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(prefix));
  return values.length === 1 ? decodeURIComponent(values[0]!.slice(prefix.length)) : null;
}

function issueVisitorCookie(reply: { header: (name: string, value: string) => unknown }, env: { PUBLIC_BASE_URL: string }, token: string) {
  const secure = env.PUBLIC_BASE_URL.startsWith('https:') ? '; Secure' : '';
  reply.header('Set-Cookie', `${VISITOR_COOKIE}=${encodeURIComponent(token)}; Max-Age=31536000; Path=/; HttpOnly${secure}; SameSite=Lax`);
}

export async function registerTelemetryRoutes(app: AppInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.post('/telemetry/page-view', {
    schema: {
      tags: ['community'],
      body: bodySchema,
      response: { 200: envelopeSchema(z.object({ recorded: z.literal(true) })), 400: errorEnvelopeSchema, 409: errorEnvelopeSchema },
    },
  }, async (request, reply) => {
    let visitor = readVisitorCookie(request);
    if (!visitor || !/^[A-Za-z0-9_-]{16,80}$/.test(visitor)) {
      visitor = randomUUID();
      issueVisitorCookie(reply, ctx.env, visitor);
    }
    const visitorKey = hashToken(visitor);
    const token = request.headers.authorization ? parseBearerToken(request.headers.authorization) : cookieToken(request, ctx.env);
    const session = token ? await resolveSession(ctx.db, token) : null;
    await ctx.db.transaction(async (tx) => {
      if (request.body.source_id) {
        const [source] = await tx.select({ id: sources.id }).from(sources).where(eq(sources.id, request.body.source_id));
        if (!source) throw AppError.notFound();
      }
      if (request.body.followup_id) {
        const [version] = await tx.select({ id: followupVersions.id }).from(followupVersions).where(eq(followupVersions.id, request.body.followup_id));
        if (!version) throw AppError.notFound();
      }
      if (session) {
        const [actor] = await tx.select({ id: users.id, disabledAt: users.disabledAt }).from(users).where(eq(users.id, session.user.id));
        if (!actor || actor.disabledAt) throw AppError.unauthorized('Account unavailable');
      }
      const [existing] = await tx.select().from(siteVisits).where(eq(siteVisits.clientEventId, request.body.client_event_id)).for('update');
      if (existing) {
        if (existing.page !== request.body.page || existing.sourceId !== (request.body.source_id ?? null) || existing.followupId !== (request.body.followup_id ?? null)) {
          throw AppError.conflict('Visit key was already used');
        }
        await tx.update(siteVisits).set({
          dwellMs: Math.max(existing.dwellMs, request.body.dwell_ms),
          userId: existing.userId ?? session?.user.id ?? null,
          updatedAt: ctx.now(),
        }).where(eq(siteVisits.id, existing.id));
        return;
      }
      await tx.insert(siteVisits).values({
        visitorKey,
        userId: session?.user.id ?? null,
        page: request.body.page,
        sourceId: request.body.source_id ?? null,
        followupId: request.body.followup_id ?? null,
        dwellMs: request.body.dwell_ms,
        clientEventId: request.body.client_event_id,
        createdAt: ctx.now(),
        updatedAt: ctx.now(),
      });
    });
    return success(request.id, { recorded: true as const });
  });
}
