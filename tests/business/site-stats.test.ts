import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
import { auth, createHarness, seedUser, seedPublishedStory } from './helpers.js';
import { zhihuAccounts } from '../../src/db/schema.js';

it('records anonymous visits and shows real admin overview counts', async () => {
  const h = await createHarness();
  try {
    const author = await seedUser(h, 'author');
    const reader = await seedUser(h, 'reader');
    const admin = await seedUser(h, 'admin');
    const story = await seedPublishedStory(h, { author: author.user, verifyAuthor: true });
    const eventId = randomUUID();
    const visit = (dwell: number, id = eventId) => h.app.inject({
      method: 'POST',
      url: '/api/telemetry/page-view',
      headers: { 'x-andthen-web': '1', origin: 'http://127.0.0.1:5174' },
      payload: { client_event_id: id, page: `/?screen=02&source=${story.source.id}`, source_id: story.source.id, dwell_ms: dwell },
    });
    expect((await visit(0)).statusCode).toBe(200);
    expect((await visit(8000)).statusCode).toBe(200);
    await h.ctx.db.insert(zhihuAccounts).values({
      userId: reader.user.id,
      uid: `zhihu-${reader.user.id.slice(0, 8)}`,
      expiresAt: new Date(Date.now() + 86400000),
    });
    await h.app.inject({ method: 'PUT', url: `/api/stories/${story.source.id}/read`, headers: auth(reader.token), payload: {} });
    expect((await h.app.inject({ url: '/api/admin/overview' })).statusCode).toBe(401);
    const overview = (await h.app.inject({ url: '/api/admin/overview', headers: auth(admin.token) })).json().data;
    expect(overview.visitors).toBe(1);
    expect(overview.authorized_users).toBe(1);
    expect(overview.authorized_reads).toBe(1);
    expect(overview.heat_score).toBeGreaterThan(0);
    expect(overview.samples.some((row: { id: string }) => row.id === story.source.id)).toBe(true);
  } finally {
    await h.close();
  }
});
