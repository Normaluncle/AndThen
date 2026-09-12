import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createLogger } from '../../src/shared/logger.js';
import type { AppInstance } from '../../src/shared/types.js';
import { createTestContext, type TestContext } from '../helpers/testdb.js';

describe('OpenAPI document', () => {
  let ctx: TestContext;
  let app: AppInstance;

  beforeAll(async () => {
    ctx = await createTestContext();
    const built = await buildApp({
      env: ctx.env,
      db: ctx.db,
      logger: createLogger(ctx.env),
      enableDocs: true,
    });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await ctx.close();
  });

  it('is served at the documented path with every implemented route', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);

    const spec = res.json() as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };

    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toContain('AndThen');
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/healthz',
        '/readyz',
        '/api/auth/sessions',
        '/api/auth/me',
        '/api/auth/logout',
      ]),
    );
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it('documents the response envelope on the session endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    const spec = res.json() as {
      paths: Record<string, { post?: { responses: Record<string, { content?: Record<string, { schema?: unknown }> }> } }>;
    };
    const schema = JSON.stringify(spec.paths['/api/auth/sessions']?.post?.responses['200']);
    expect(schema).toContain('request_id');
    expect(schema).toContain('session_token');
  });

  it('serves the docs UI', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
  });
});
