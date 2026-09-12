/** Explicit disposable fixture setup for an isolated local browser acceptance database. */
import { randomUUID } from 'node:crypto';
import { getEnv } from '../src/config/env.js';
import { createPool, createDatabase } from '../src/db/client.js';
import { sources, sourceSnapshots, authorVerifications, consents, followupCases } from '../src/db/schema.js';
import { createUser, issueLoginToken } from '../src/modules/identity/service.js';
import { sha256 } from '../src/modules/identity/tokens.js';

const env = getEnv();
if (!new URL(env.DATABASE_URL).pathname.endsWith('/andthen_v12_demo')) throw new Error('Fixture seed requires the named isolated demo database');
const pool = createPool({ connectionString: env.DATABASE_URL });
const db = createDatabase(pool);
try {
 const author = await createUser(db, { role: 'author', cohort: 'team_test', displayName: '测试作者 · 转行回访' });
 const admin = await createUser(db, { role: 'admin', cohort: 'team_test', displayName: '测试管理员' });
 const [source] = await db.insert(sources).values({ sourceType: 'author_paste', originalUrl: `https://example.test/fixture/${randomUUID()}`, title: '【测试材料】当年说半年转行，后来怎么样了？', permissionStatus: 'public_approved', provenance: 'test_fixture', createdByUserId: author.id }).returning();
 const excerpt = '【虚构测试资料】2021年我开始学习编程，计划半年内找到第一份软件工作。后来花了八个月。最大的困难是没有经验，面试机会少。我不想讨论工资。';
 const [snapshot] = await db.insert(sourceSnapshots).values({ sourceId: source!.id, materialLevel: 'exact_excerpt', excerpt, excerptLocation: '测试全文', contentHash: sha256(excerpt), createdByUserId: author.id }).returning();
 await db.insert(authorVerifications).values({ sourceId: source!.id, userId: author.id, method: 'manual', status: 'verified', verifierUserId: admin.id, evidenceRef: 'fixture://v12/explicit-test-person', scope: 'test_fixture', verifiedAt: new Date() });
 await db.insert(consents).values({ sourceId: source!.id, userId: author.id, purpose: 'demo_public_display', status: 'granted' });
 const [c] = await db.insert(followupCases).values({ sourceId: source!.id, authorUserId: author.id, createdByUserId: admin.id, launchType: 'pilot_preauthorized', status: 'invite_recorded', reviewerRequired: false }).returning();
 const authorLogin = await issueLoginToken(db, { userId: author.id, ttlSeconds: 3600 });
 // These one-time credentials are returned once to the controlling tester, never stored raw.
 process.stdout.write(JSON.stringify({ author_login_token: authorLogin.token, source_id: source!.id, case_id: c!.id, snapshot_id: snapshot!.id })+'\n');
} finally { await pool.end(); }
