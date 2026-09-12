/**
 * Shared harness for the business-module integration tests.
 *
 * These tests run against a real Postgres. They target the per-agent database
 * `andthen_test_business` through `TEST_DATABASE_URL` so they never touch the
 * foundation's `andthen` database or another agent's database.
 */
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import {
  authorVerifications,
  consents,
  followupCases,
  followupVersions,
  sourceSnapshots,
  sources,
  type FollowupCaseRow,
  type SourceRow,
  type SourceSnapshotRow,
  type UserRow,
} from '../../src/db/schema.js';
import { createUser, issueLoginToken } from '../../src/modules/identity/service.js';
import { createLogger } from '../../src/shared/logger.js';
import type { AppInstance } from '../../src/shared/types.js';
import { createTestContext, type TestContext } from '../helpers/testdb.js';

export interface Harness {
  ctx: TestContext;
  app: AppInstance;
  close: () => Promise<void>;
}

export async function createHarness(options: { enableDocs?: boolean } = {}): Promise<Harness> {
  const ctx = await createTestContext();
  const built = await buildApp({
    env: ctx.env,
    db: ctx.db,
    logger: createLogger(ctx.env),
    enableDocs: options.enableDocs ?? false,
  });
  await built.app.ready();
  return {
    ctx,
    app: built.app,
    close: async () => {
      await built.app.close();
      await ctx.close();
    },
  };
}

export interface SeededUser {
  user: UserRow;
  token: string;
}

export async function seedUser(
  harness: Harness,
  role: UserRow['role'],
  cohort = 'external',
): Promise<SeededUser> {
  const user = await createUser(harness.ctx.db, { role, cohort });
  const loginToken = await issueLoginToken(harness.ctx.db, { userId: user.id, ttlSeconds: 3600 });
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/sessions',
    payload: { login_token: loginToken.token },
  });
  if (res.statusCode !== 200) throw new Error(`failed to seed ${role} session: ${res.body}`);
  const body = res.json() as { data: { session_token: string } };
  return { user, token: body.data.session_token };
}

export function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

export interface ImportedSource {
  sourceId: string;
  snapshotId: string;
  body: Record<string, unknown>;
}

/** Import a source over HTTP as the given session. */
export async function importSource(
  harness: Harness,
  token: string,
  payload: Record<string, unknown>,
): Promise<ImportedSource> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/sources',
    headers: auth(token),
    payload,
  });
  if (res.statusCode !== 200) {
    throw new Error(`import failed (${res.statusCode}): ${res.body}`);
  }
  const body = res.json() as { data: { source_id: string; snapshot_id: string } };
  return { sourceId: body.data.source_id, snapshotId: body.data.snapshot_id, body: body.data };
}

export interface PublishedStory {
  source: SourceRow;
  snapshot: SourceSnapshotRow;
  followupCase: FollowupCaseRow;
  versionId: string;
}

export interface SeedStoryOptions {
  author: UserRow;
  researcher?: UserRow;
  excerpt?: string;
  publishedAt?: Date | null;
  provenance?: string;
  permissionStatus?: SourceRow['permissionStatus'];
  verifyAuthor?: boolean;
  grantPublicConsent?: boolean;
  statements?: Array<{ id: string; text: string; kind: string; visibility: string }>;
}

/**
 * Seed a published story directly in the database — this is the shape the
 * publish module will produce, so the public projection can be tested without
 * depending on that module.
 */
export async function seedPublishedStory(
  harness: Harness,
  options: SeedStoryOptions,
): Promise<PublishedStory> {
  const db = harness.ctx.db;
  const now = new Date();
  const sourceRows = await db
    .insert(sources)
    .values({
      sourceType: 'author_paste',
      originalUrl: `https://example.test/story/${Math.random().toString(36).slice(2)}`,
      title: '一条获准展示的旧回答',
      permissionStatus: options.permissionStatus ?? 'public_approved',
      provenance: options.provenance ?? 'test_fixture',
      createdByUserId: options.author.id,
    })
    .returning();
  const source = sourceRows[0]!;

  const snapshotRows = await db
    .insert(sourceSnapshots)
    .values({
      sourceId: source.id,
      version: 1,
      materialLevel: 'exact_excerpt',
      excerpt: options.excerpt ?? '当时我决定先完成这个项目。',
      excerptLocation: '第 2 段',
      contentHash: `seed-${source.id}`,
      publishedAt: options.publishedAt === undefined ? new Date('2021-03-01T00:00:00Z') : options.publishedAt,
      acquiredAt: now,
      createdByUserId: options.author.id,
    })
    .returning();
  const snapshot = snapshotRows[0]!;

  if (options.grantPublicConsent !== false) {
    await db.insert(consents).values({
      userId: options.author.id,
      sourceId: source.id,
      purpose: 'demo_public_display',
      status: 'granted',
      version: 'v1',
      grantedAt: now,
    });
  }

  if (options.verifyAuthor) {
    await db.insert(authorVerifications).values({
      userId: options.author.id,
      sourceId: source.id,
      method: 'manual',
      status: 'verified',
      evidenceRef: 'evidence://test/seed',
      verifierUserId: options.researcher?.id ?? options.author.id,
      verifiedAt: now,
    });
  }

  const caseRows = await db
    .insert(followupCases)
    .values({
      sourceId: source.id,
      authorUserId: options.author.id,
      status: 'published',
      launchType: 'author_initiated',
      createdByUserId: options.researcher?.id ?? options.author.id,
    })
    .returning();
  const followupCase = caseRows[0]!;

  const versionRows = await db
    .insert(followupVersions)
    .values({
      caseId: followupCase.id,
      version: 1,
      status: 'published',
      statements: options.statements ?? [
        { id: 's1', text: '项目后来完成了。', kind: 'author_report', visibility: 'public' },
        { id: 's2', text: '这里有一句不公开的话。', kind: 'author_reflection', visibility: 'private' },
      ],
      contentHash: `seed-version-${source.id}`,
      aiAssisted: true,
      createdByUserId: options.author.id,
      confirmedAt: now,
      publishedAt: now,
    })
    .returning();
  const version = versionRows[0]!;

  await db
    .update(followupCases)
    .set({ publishedVersionId: version.id })
    .where(eq(followupCases.id, followupCase.id));

  const refreshed = await db
    .select()
    .from(followupCases)
    .where(eq(followupCases.id, followupCase.id))
    .limit(1);

  return { source, snapshot, followupCase: refreshed[0] ?? followupCase, versionId: version.id };
}
