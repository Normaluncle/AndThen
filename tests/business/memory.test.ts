import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHarness, seedUser, auth, type Harness } from './helpers.js';
import { authorMemories } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
it('memory consent is separate and cannot be supplied for another account', async () => {
  const a = await seedUser(h, 'author');
  const b = await seedUser(h, 'author');
  expect((await h.app.inject({ method: 'GET', url: '/api/me/memory' })).statusCode).toBe(401);
  expect((await h.app.inject({ method: 'PUT', url: '/api/me/memory/consent', headers: auth(a.token), payload: { enabled: true, user_id: b.user.id } })).statusCode).toBe(400);
  expect((await h.app.inject({ method: 'PUT', url: '/api/me/memory/consent', headers: auth(a.token), payload: { enabled: true } })).statusCode).toBe(200);
  const other = await h.app.inject({ method: 'GET', url: '/api/me/memory', headers: auth(b.token) });
  expect(other.json().data.enabled).toBe(false);
  const [before] = await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId, a.user.id));
  expect((await h.app.inject({ method: 'PUT', url: '/api/me/memory/consent', headers: auth(a.token), payload: { enabled: false } })).statusCode).toBe(200);
  const [after] = await h.ctx.db.select().from(authorMemories).where(eq(authorMemories.userId, a.user.id));
  expect(after!.generation).not.toBe(before!.generation);
  expect(after!.records).toEqual([]);
  expect(after!.enabled).toBe(false);
});
