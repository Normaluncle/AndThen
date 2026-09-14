import { issueWebCookie, cookieToken } from '../../http/session-cookie.js';
import { parseBearerToken } from '../../http/auth.js';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Executor } from '../../db/client.js';
import type { AppInstance, ModuleContext } from '../../shared/types.js';
import {
  authorVerifications,
  consents,
  followupCases,
  followupVersions,
  interests,
  interviewMessages,
  interviewSessions,
  notifications,
  sourceSnapshots,
  sources,
  users,
} from '../../db/schema.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { AppError, success } from '../../http/errors.js';
import { createSession, resolveSession } from './service.js';
import { snapshotContentHash } from '../sources/service.js';
import { DEMO_ACCOUNTS, FIXTURE_STORIES, LOCAL_DEMO_COHORT, playgroundResetAllowed } from './playground.js';
import { verifyAdminConsolePassword } from './admin-gate.js';

export { DEMO_ACCOUNTS, FIXTURE_STORIES, playgroundResetAllowed } from './playground.js';

export function localDemoEnabled(ctx: ModuleContext) {
  if (!ctx.env.LOCAL_DEMO_LOGIN) return false;
  // A deployed review site is never reachable through localhost, so serving the demo
  // accounts from a public host needs its own explicit opt-in on top of the local flag.
  if (ctx.env.PUBLIC_DEMO_LOGIN) return true;
  return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(ctx.env.PUBLIC_BASE_URL).hostname);
}

function assertSameOrigin(request: { headers: { origin?: string } }, ctx: ModuleContext) {
  const origin = request.headers.origin;
  if (origin && origin !== new URL(ctx.env.PUBLIC_BASE_URL).origin) throw AppError.forbidden('Local demo requires same-origin requests');
}

const sessionUserSchema = z.object({
  session_token: z.string(),
  user: z.object({ id: z.string(), role: z.string(), cohort: z.string(), display_name: z.string().nullable() }),
});

async function loginPreset(ctx: ModuleContext, path: (typeof DEMO_ACCOUNTS)[number]['path']) {
  const preset = DEMO_ACCOUNTS.find((item) => item.path === path);
  if (!preset) throw AppError.notFound();
  return ctx.db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: preset.id,
      role: preset.role,
      displayName: preset.displayName,
      cohort: LOCAL_DEMO_COHORT,
    }).onConflictDoNothing();
    const [user] = await tx.select().from(users).where(eq(users.id, preset.id)).for('update');
    if (!user || user.disabledAt || user.role !== preset.role || user.cohort !== LOCAL_DEMO_COHORT) {
      throw AppError.forbidden('Local demo account is not provisioned');
    }
    const session = await createSession(tx, { userId: user.id, cohort: user.cohort, ttlSeconds: 7200 });
    return { session_token: session.token, user: { id: user.id, role: user.role, cohort: user.cohort, display_name: user.displayName } };
  });
}

export async function resetPlayground(db: Executor) {
  const authorId = DEMO_ACCOUNTS.find((item) => item.path === 'author')!.id;
  const sourceIds = FIXTURE_STORIES.map((item) => item.id);
  const cases = await db.select({ id: followupCases.id }).from(followupCases).where(inArray(followupCases.sourceId, sourceIds));
  const caseIds = cases.map((row) => row.id);
  if (caseIds.length) {
    await db.delete(notifications).where(inArray(notifications.caseId, caseIds));
    await db.delete(followupVersions).where(inArray(followupVersions.caseId, caseIds));
    const sessions = await db.select({ id: interviewSessions.id }).from(interviewSessions).where(inArray(interviewSessions.caseId, caseIds));
    const sessionIds = sessions.map((row) => row.id);
    if (sessionIds.length) {
      await db.delete(interviewMessages).where(inArray(interviewMessages.sessionId, sessionIds));
      await db.delete(interviewSessions).where(inArray(interviewSessions.id, sessionIds));
    }
  }
  await db.delete(interests).where(inArray(interests.sourceId, sourceIds));
  const readerId = DEMO_ACCOUNTS.find((item) => item.path === 'reader')!.id;
  await db.update(followupCases).set({ status: 'eligible', declineFlag: false, doNotContact: false }).where(inArray(followupCases.sourceId, sourceIds));
  for (const preset of DEMO_ACCOUNTS) {
    await db.insert(users).values({ id: preset.id, role: preset.role, displayName: preset.displayName, cohort: LOCAL_DEMO_COHORT }).onConflictDoNothing();
  }
  for (const story of FIXTURE_STORIES) {
    const [existing] = await db.select().from(sources).where(eq(sources.id, story.id));
    if (existing) continue;
    await db.insert(sources).values({
      id: story.id,
      title: story.title,
      sourceType: 'author_paste',
      createdByUserId: authorId,
      provenance: 'test_fixture',
      permissionStatus: 'public_approved',
    });
    await db.insert(sourceSnapshots).values({
      sourceId: story.id,
      version: 1,
      materialLevel: 'exact_excerpt',
      excerpt: story.excerpt,
      contentHash: snapshotContentHash({ materialLevel: 'exact_excerpt', excerpt: story.excerpt, body: null, excerptLocation: null }),
      createdByUserId: authorId,
    });
    await db.insert(authorVerifications).values({
      sourceId: story.id,
      userId: authorId,
      method: 'manual',
      status: 'verified',
      evidenceRef: 'fixture:local-playground-not-real-author',
      verifiedAt: new Date(),
    });
    await db.insert(consents).values(['private_interview', 'external_model_processing', 'demo_public_display'].map((purpose) => ({
      sourceId: story.id,
      userId: authorId,
      purpose: purpose as 'private_interview' | 'external_model_processing' | 'demo_public_display',
      version: 'local-demo-fixture-v1',
    })));
    await db.insert(followupCases).values({
      sourceId: story.id,
      authorUserId: authorId,
      createdByUserId: authorId,
      status: 'eligible',
      reviewerRequired: false,
    });
  }
  for (const story of FIXTURE_STORIES) {
    await db.insert(interests).values({
      readerKey: readerId,
      sourceId: story.id,
      active: true,
      cohort: LOCAL_DEMO_COHORT,
      triggeredBy: 'natural',
      excluded: true,
    }).onConflictDoNothing();
  }
  return { stories: FIXTURE_STORIES.length };
}

export async function registerLocalDemoRoutes(app: AppInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/auth/demo/status', { schema: { response: { 200: envelopeSchema(z.object({ enabled: z.boolean() })) } } }, async (request) => success(request.id, { enabled: localDemoEnabled(ctx) }));
  for (const preset of DEMO_ACCOUNTS) r.post('/auth/demo/' + preset.path, {
    schema: {
      tags: ['identity'],
      body: preset.path === 'admin' ? z.object({ password: z.string().min(1).max(200) }).strict() : z.object({}).strict(),
      response: { 200: envelopeSchema(sessionUserSchema), 401: errorEnvelopeSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema },
    },
  }, async (request, reply) => {
    if (!localDemoEnabled(ctx)) throw AppError.notFound();
    assertSameOrigin(request, ctx);
    if (preset.path === 'admin') {
      const password = 'password' in request.body ? request.body.password : '';
      if (!await verifyAdminConsolePassword(password)) throw AppError.unauthorized();
    }
    const result = await loginPreset(ctx, preset.path);
    issueWebCookie(request, reply, ctx.env, result.session_token, 7200);
    reply.header('cache-control', 'no-store');
    return success(request.id, result);
  });
  r.post('/auth/demo/reset', {
    schema: { tags: ['identity'], body: z.object({}).strict(), response: { 200: envelopeSchema(z.object({ reset: z.boolean(), stories: z.number() })) } },
  }, async (request) => {
    if (!localDemoEnabled(ctx)) throw AppError.notFound();
    assertSameOrigin(request, ctx);
    const token = request.headers.authorization ? parseBearerToken(request.headers.authorization) : cookieToken(request, ctx.env);
    if (token) {
      const resolved = await resolveSession(ctx.db, token);
      if (resolved && !playgroundResetAllowed(resolved.user.cohort)) throw AppError.forbidden('Playground reset is only for local demo accounts');
    }
    const result = await ctx.db.transaction(async (tx) => resetPlayground(tx));
    return success(request.id, { reset: true, stories: result.stories });
  });
}
