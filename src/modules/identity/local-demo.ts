import { issueWebCookie, cookieToken } from '../../http/session-cookie.js';
import { parseBearerToken } from '../../http/auth.js';
import { z } from 'zod';
import { desc, eq, inArray } from 'drizzle-orm';
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
import { contentHash } from '../../ai/evidence.js';
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
    // Logging in must land in a workspace that already has something to edit, so the demo
    // samples are seeded here instead of waiting for someone to press 刷新演示数据.
    await seedPlayground(tx);
    const session = await createSession(tx, { userId: user.id, cohort: user.cohort, ttlSeconds: 7200 });
    return { session_token: session.token, user: { id: user.id, role: user.role, cohort: user.cohort, display_name: user.displayName } };
  });
}

/**
 * Brings the playground to its demo state without deleting anything: the demo users, every
 * fixture source with its snapshot/verification/consent, one case per story, the published
 * follow-up of every 已有后来 sample and the demo reader's follows.
 *
 * It runs on every demo login so a reviewer never lands in an empty workspace, which is why it
 * only ever creates what is missing (the interactive progress is left alone).
 */
export async function seedPlayground(db: Executor) {
  const authorId = DEMO_ACCOUNTS.find((item) => item.path === 'author')!.id;
  const readerId = DEMO_ACCOUNTS.find((item) => item.path === 'reader')!.id;
  for (const preset of DEMO_ACCOUNTS) {
    await db.insert(users).values({ id: preset.id, role: preset.role, displayName: preset.displayName, cohort: LOCAL_DEMO_COHORT }).onConflictDoNothing();
  }
  for (const story of FIXTURE_STORIES) {
    const [existing] = await db.select().from(sources).where(eq(sources.id, story.id));
    if (!existing) {
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
    }
    let [caseRow] = await db.select().from(followupCases).where(eq(followupCases.sourceId, story.id)).orderBy(followupCases.createdAt).limit(1);
    if (!caseRow) {
      [caseRow] = await db.insert(followupCases).values({
        sourceId: story.id,
        authorUserId: authorId,
        createdByUserId: authorId,
        status: 'eligible',
        reviewerRequired: false,
      }).returning();
    }
    if (story.followup && caseRow && !caseRow.publishedVersionId) {
      const [latest] = await db.select().from(followupVersions).where(eq(followupVersions.caseId, caseRow.id)).orderBy(desc(followupVersions.version)).limit(1);
      const statements = story.followup.statements.map((item, index) => ({
        id: `fixture:${story.id}:${index + 1}`,
        section: item.section,
        text: item.text,
        kind: 'author_report',
        evidence_refs: [],
        visibility: 'public',
      }));
      const [version] = await db.insert(followupVersions).values({
        caseId: caseRow.id,
        version: (latest?.version ?? 0) + 1,
        status: 'published',
        statements,
        contentHash: contentHash(statements),
        aiAssisted: false,
        createdByUserId: authorId,
        confirmedAt: new Date(story.followup.publishedAt),
        publishedAt: new Date(story.followup.publishedAt),
      }).returning();
      await db.update(followupCases).set({ status: 'published', publishedVersionId: version!.id, updatedAt: new Date() }).where(eq(followupCases.id, caseRow.id));
      // The reader receives the same notification a real publish fans out, so the demo shows
      // the whole loop (关注 → 作者补充 → 通知 → 阅读后来).
      await db.insert(notifications).values({ readerKey: readerId, caseId: caseRow.id, followupVersionId: version!.id }).onConflictDoNothing();
    }
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

/** Wipes the interactive progress and rebuilds the samples from scratch. */
export async function resetPlayground(db: Executor) {
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
  await db.update(followupCases)
    .set({ status: 'eligible', declineFlag: false, doNotContact: false, publishedVersionId: null })
    .where(inArray(followupCases.sourceId, sourceIds));
  return seedPlayground(db);
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
