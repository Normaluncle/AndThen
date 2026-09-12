import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './helpers.js';

/**
 * The OpenAPI document must keep generating and must describe every business
 * route this worktree owns. `POST /sources/:id/analyze` is deliberately absent:
 * it is owned by the AI module, not by sources.
 */
describe('business routes appear in the OpenAPI document', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness({ enableDocs: true });
  });
  afterAll(async () => {
    await h.close();
  });

  it('documents the sources and cases routes', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json() as { paths: Record<string, unknown> };
    const paths = Object.keys(spec.paths);

    for (const expected of [
      '/api/sources',
      '/api/sources/{id}',
      '/api/sources/{id}/snapshots',
      '/api/sources/{id}/consents',
      '/api/sources/{id}/consents/{purpose}',
      '/api/sources/{id}/author-verifications',
      '/api/stories',
      '/api/stories/{id}',
      '/api/stories/{id}/interest',
      '/api/me/following',
      '/api/me/notifications',
      '/api/me/data-deletion',
      '/api/interviews/{id}/finish',
      '/api/cases',
      '/api/cases/{id}',
      '/api/cases/{id}/invitations',
      '/api/cases/{id}/decision',
    ]) {
      expect(paths, `missing documented route ${expected}`).toContain(expected);
    }

    // The integrated AI handlers now publish their contracts alongside business routes.
    expect(paths).toContain('/api/sources/{id}/analyze');
    expect(paths).toContain('/api/drafts/{id}/validate');
  });
});
