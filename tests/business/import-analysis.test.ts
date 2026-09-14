import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createHarness, importSource, seedUser, type Harness } from './helpers.js';
import { runJob } from '../helpers/run-job.js';

/**
 * The import flow must reach the same AI screen as every other source: after the
 * author claims the link and consents to model processing, AI-A runs on their
 * own text and the presentation (category + cover caption) becomes readable.
 */
describe('import flow: author claim unlocks AI screening of the author material', () => {
  let h: Harness;
  let server: Server;

  beforeAll(async () => {
    h = await createHarness();
    server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(JSON.parse(body).messages[1].content);
      const text: string = input.evidence[0].text;
      const candidate = {
        presentation: {
          category: '职场发展',
          tags: ['职场发展'],
          year: null,
          caption: text.replace(/[。．.]+$/, '').slice(0, 18),
          evidence_refs: [input.evidence[0].id],
        },
        case_type: 'plan',
        claims: [{ id: 'c1', text, kind: 'plan', evidence_refs: [input.evidence[0].id], time_anchor: null, time_anchor_basis: null }],
        missing_information: ['later outcome'],
        safety: 'clear_for_pilot',
        safety_reasons: [],
        recommended_action: 'invite',
        action_reasons: ['author outcome unknown'],
        reviewer_required: false,
      };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'test_fixture', choices: [{ message: { content: JSON.stringify(candidate) } }], usage: { prompt_tokens: 20, completion_tokens: 30 } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    h.moduleCtx.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    h.moduleCtx.env.LLM_MODEL = 'test_fixture';
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await h.close();
  });

  it('waits for the claim, then queues and applies analysis to the author text', async () => {
    const author = await seedUser(h, 'author', 'test_fixture');
    const excerpt = '我在大厂工作了五年，上周提交了辞职申请，准备做独立开发。';
    const imported = await importSource(h, author.token, {
      source_type: 'third_party_link',
      original_url: 'https://example.test/import-analysis/1',
      material_level: 'api_summary',
      body: '官方摘要：我在大厂工作五年后辞职。',
    });

    const consent = { purpose: 'external_model_processing', version: 'v1' };
    // A third party who only registered the link cannot consent for it, so no
    // model ever reads someone else's answer through the import flow.
    const tooEarly = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/consents`,
      headers: auth(author.token),
      payload: consent,
    });
    expect(tooEarly.statusCode, tooEarly.body).toBe(403);
    expect(tooEarly.json().error_code).toBe('forbidden');

    const claimed = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/author-claim`,
      headers: auth(author.token),
      payload: { excerpt, confirms_own_content: true },
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect(claimed.json().data.analysis_status).toBe('awaiting_model_consent');

    const granted = await h.app.inject({
      method: 'POST',
      url: `/api/sources/${imported.sourceId}/consents`,
      headers: auth(author.token),
      payload: consent,
    });
    expect(granted.statusCode, granted.body).toBe(200);
    expect(granted.json().data.analysis_status).toBe('queued');

    await runJob(h.moduleCtx, 'ai.extract');

    const read = await h.app.inject({
      url: `/api/sources/${imported.sourceId}`,
      headers: auth(author.token),
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().data.presentation.category).toBe('职场发展');
    expect(read.json().data.presentation.cover_caption).toBe(excerpt.replace(/[。．.]+$/, '').slice(0, 18));
  });
});
