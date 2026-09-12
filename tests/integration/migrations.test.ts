import { readdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveMigrationsDir } from '../../src/config/env.js';
import { createDatabase, createPool, type Database } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { isolatedDatabaseName, makeTestEnv, testDatabaseUrl, withDatabaseName } from '../helpers/testdb.js';

const FRESH_DB = isolatedDatabaseName('migrations_fresh');

const EXPECTED_TABLES = [
  'ai_runs',
  'audit_logs',
  'author_memories',
  'author_verifications',
  'consents',
  'deletion_jobs',
  'discovery_candidates',
  'followup_cases',
  'followup_versions',
  'idempotency_keys',
  'interests',
  'interview_messages',
  'interview_sessions',
  'invitations',
  'jobs',
  'login_tokens',
  'notifications',
  'outbox',
  'research_events',
  'sessions',
  'source_preparations',
  'source_snapshots',
  'sources',
  'users',
  'worker_heartbeats',
  'zhihu_comment_syncs',
  'zhihu_oauth_attempts',
];

const EXPECTED_INDEXES = [
  'jobs_dedupe_active_uq',
  'outbox_topic_dedupe_uq',
  'notifications_reader_version_uq',
  'interests_reader_source_uq',
  'sessions_token_hash_uq',
  'interview_sessions_case_active_uq',
  'idempotency_scope_key_uq',
];

describe('database migrations (real Postgres)', () => {
  let admin: Database;
  let adminPool: ReturnType<typeof createPool>;
  let fresh: Database | undefined;
  let freshPool: ReturnType<typeof createPool> | undefined;

  const env = makeTestEnv();
  const migrationsDir = resolveMigrationsDir(env);

  beforeAll(async () => {
    adminPool = createPool({ connectionString: testDatabaseUrl(), max: 1, applicationName: 'andthen-mig-admin' });
    admin = createDatabase(adminPool);
    await admin.execute(sql.raw(`DROP DATABASE IF EXISTS "${FRESH_DB}" WITH (FORCE)`));
    await admin.execute(sql.raw(`CREATE DATABASE "${FRESH_DB}"`));

    freshPool = createPool({
      connectionString: withDatabaseName(testDatabaseUrl(), FRESH_DB),
      max: 2,
      applicationName: 'andthen-mig-fresh',
    });
    fresh = createDatabase(freshPool);
  });

  afterAll(async () => {
    if (freshPool) await freshPool.end();
    if (adminPool) {
      await admin.execute(sql.raw(`DROP DATABASE IF EXISTS "${FRESH_DB}" WITH (FORCE)`));
      await adminPool.end();
    }
  });

  it('applies every migration to an empty database', async () => {
    expect(fresh).toBeDefined();
    const result = await runMigrations(fresh!, migrationsDir);
    expect(result.migrationsFolder).toBe(migrationsDir);

    const tables = await fresh!.execute(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    const names = (tables.rows as Array<{ tablename: string }>).map((r) => r.tablename);
    for (const expected of EXPECTED_TABLES) {
      expect(names, `missing table ${expected}`).toContain(expected);
    }
    expect(names).toHaveLength(EXPECTED_TABLES.length);

    const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const applied = await fresh!.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    expect((applied.rows[0] as { count: number }).count).toBe(sqlFiles.length);
  });

  it('creates the concurrency-critical unique indexes', async () => {
    const indexes = await fresh!.execute(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    );
    const names = (indexes.rows as Array<{ indexname: string }>).map((r) => r.indexname);
    for (const expected of EXPECTED_INDEXES) {
      expect(names, `missing index ${expected}`).toContain(expected);
    }
  });

  it('is idempotent: re-running applies nothing and does not throw', async () => {
    await expect(runMigrations(fresh!, migrationsDir)).resolves.toBeDefined();
    const tables = await fresh!.execute(
      sql`select count(*)::int as count from pg_tables where schemaname = 'public'`,
    );
    expect((tables.rows[0] as { count: number }).count).toBe(EXPECTED_TABLES.length);
  });

  it('enforces the jobs dedupe partial unique index for active jobs only', async () => {
    // Two active jobs with the same dedupe key must collide.
    await fresh!.execute(sql`
      insert into jobs (kind, dedupe_key, status)
      values ('test.noop', 'dup-key', 'queued')
    `);
    await expect(
      fresh!.execute(sql`
        insert into jobs (kind, dedupe_key, status)
        values ('test.noop', 'dup-key', 'queued')
      `),
    ).rejects.toThrow();

    // A finished job may share the key with a new active one.
    await fresh!.execute(sql`update jobs set status = 'succeeded' where dedupe_key = 'dup-key'`);
    await expect(
      fresh!.execute(sql`
        insert into jobs (kind, dedupe_key, status)
        values ('test.noop', 'dup-key', 'queued')
      `),
    ).resolves.toBeDefined();

    // Null dedupe keys never collide.
    await fresh!.execute(sql`insert into jobs (kind, status) values ('test.noop', 'queued')`);
    await fresh!.execute(sql`insert into jobs (kind, status) values ('test.noop', 'queued')`);
  });

  it('keeps source published_at and snapshot acquired_at independent', async () => {
    const source = await fresh!.execute(sql`
      insert into sources (source_type, provenance)
      values ('author_paste', 'test_fixture')
      returning id
    `);
    const sourceId = (source.rows[0] as { id: string }).id;

    await fresh!.execute(sql`
      insert into source_snapshots (source_id, material_level, content_hash, published_at)
      values (${sourceId}, 'exact_excerpt', 'h1', '2021-01-01T00:00:00Z')
    `);
    const row = await fresh!.execute(sql`
      select
        published_at is not null as published_known,
        acquired_at is not null as acquired_known,
        published_at < acquired_at as correctly_ordered
      from source_snapshots
      where source_id = ${sourceId}
    `);
    const snapshot = row.rows[0] as {
      published_known: boolean;
      acquired_known: boolean;
      correctly_ordered: boolean;
    };
    expect(snapshot.published_known).toBe(true);
    expect(snapshot.acquired_known).toBe(true);
    expect(snapshot.correctly_ordered).toBe(true);
  });
});
