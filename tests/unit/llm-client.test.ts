import { describe, it, expect, vi } from 'vitest';
import { createLlmClient } from '../../src/ai/client.js';
import { loadEnv } from '../../src/config/env.js';
import { createLogger } from '../../src/shared/logger.js';

const env = loadEnv({ DATABASE_URL: 'postgres://unused/unused', LOG_LEVEL: 'silent', LLM_BASE_URL: 'http://localhost:1234/v1', LLM_MODEL: 'test_fixture', LLM_MAX_RETRIES: '1', LLM_TIMEOUT_MS: '1000' });
const logger = createLogger(env);
const request = { messages: [{ role: 'user' as const, content: 'test_fixture' }] };
describe('independent LLM adapter failures', () => {
  it('rejects oversized UTF-8 input and model switching before any request', async () => {
    const send = vi.fn();
    const client = createLlmClient({ ...env, LLM_MAX_INPUT_BYTES: 1024 }, logger, send);
    await expect(client.complete({ messages: [{ role: 'user', content: '汉'.repeat(500) }] })).rejects.toMatchObject({ code: 'source_incomplete' });
    await expect(client.complete({ ...request, model: 'different-model' })).rejects.toMatchObject({ code: 'validation_error' });
    expect(send).not.toHaveBeenCalled();
  });
  it('caps output tokens and stops an oversized streamed response without retry', async () => {
    let cancelled = false;
    const send = vi.fn(async (_url, init) => {
      expect(JSON.parse(init!.body as string).max_tokens).toBe(100);
      return new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(2048)); },
        cancel() { cancelled = true; },
      }));
    });
    const client = createLlmClient({ ...env, LLM_MAX_RESPONSE_BYTES: 1024, LLM_MAX_OUTPUT_TOKENS: 100 }, logger, send);
    await expect(client.complete({ ...request, maxTokens: 5000 })).rejects.toMatchObject({ code: 'source_incomplete' });
    expect(cancelled).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not call a provider without model configuration', async () => {
    const send = vi.fn();
    const client = createLlmClient({ ...env, LLM_MODEL: undefined }, logger, send);
    await expect(client.complete(request)).rejects.toMatchObject({ code: 'service_unavailable' });
    expect(send).not.toHaveBeenCalled();
  });
  it('caps retries at one and reports 429 using the quota code without provider text', async () => {
    const send = vi.fn(async () => new Response('PRIVATE PROVIDER TEXT', { status: 429 }));
    const client = createLlmClient({ ...env, LLM_MAX_RETRIES: 5 }, logger, send);
    await expect(client.complete(request)).rejects.toMatchObject({ code: 'quota_exhausted', message: 'LLM quota exhausted' });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed and empty replies', async () => {
    for (const body of ['{', JSON.stringify({ choices: [] })]) {
      const client = createLlmClient({ ...env, LLM_MAX_RETRIES: 0 }, logger, async () => new Response(body));
      await expect(client.complete(request)).rejects.toMatchObject({ code: 'service_unavailable' });
    }
  });
  it('creates a fresh timeout for retry, so the second request can succeed', async () => {
    let count = 0;
    const send: typeof fetch = async (_url, init) => {
      count++;
      if (count === 1) return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      });
      expect(init?.signal?.aborted).toBe(false);
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    };
    const result = await createLlmClient(env, logger, send).complete(request);
    expect(result.content).toBe('{"ok":true}');
    expect(count).toBe(2);
  });
  it('does not retry caller cancellation', async () => {
    const controller = new AbortController();
    const send = vi.fn(async () => { controller.abort(); throw controller.signal.reason; });
    await expect(createLlmClient(env, logger, send).complete({ ...request, signal: controller.signal })).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
