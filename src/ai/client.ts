import { isLlmConfigured, llmKeyPolicy, type Env } from '../config/env.js';
import { AppError } from '../http/errors.js';
import type { Logger } from '../shared/logger.js';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionRequest {
  messages: LlmChatMessage[];
  /** Overrides env.LLM_MODEL for this call. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object body (OpenAI-compatible `response_format`). */
  json?: boolean;
  /** Caller cancellation, combined with the configured timeout. */
  signal?: AbortSignal;
}

export interface LlmUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LlmCompletion {
  content: string;
  model: string;
  finishReason: string | null;
  usage: LlmUsage;
  latencyMs: number;
}

export interface LlmClient {
  readonly configured: boolean;
  readonly model: string | null;
  readonly baseUrl: string | null;
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
}

interface OpenAiChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed;
}

/**
 * Minimal OpenAI-compatible client (`POST {LLM_BASE_URL}/chat/completions`).
 *
 * This is provider-agnostic and independent of any platform API. It is the
 * only place the LLM credential is read, and it never logs it.
 */
export function createLlmClient(env: Env, logger: Logger, fetchImpl: typeof fetch = fetch): LlmClient {
  const baseUrl = env.LLM_BASE_URL ? normalizeBaseUrl(env.LLM_BASE_URL) : null;
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL ?? null;
  const configured = Boolean(baseUrl && model);

  async function complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    if (!configured || !baseUrl) {
      throw AppError.serviceUnavailable(
        'LLM provider is not configured (set LLM_BASE_URL and LLM_MODEL)',
      );
    }

    const started = Date.now();
    if (Buffer.byteLength(JSON.stringify(request.messages), 'utf8') > env.LLM_MAX_INPUT_BYTES) {
      throw AppError.sourceIncomplete('Model input exceeds configured byte budget');
    }
    if (request.model && request.model !== model) throw AppError.validation('Per-request model switching is disabled');

    const body: Record<string, unknown> = {
      model: request.model ?? model,
      messages: request.messages,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    body.max_tokens = Math.min(request.maxTokens ?? env.LLM_MAX_OUTPUT_TOKENS, env.LLM_MAX_OUTPUT_TOKENS);
    if (request.json) body.response_format = { type: 'json_object' };

    let lastError: unknown;
    const maxRetries = Math.min(env.LLM_MAX_RETRIES, 1);
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      request.signal?.throwIfAborted();
      const timeoutSignal = AbortSignal.timeout(env.LLM_TIMEOUT_MS);
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeoutSignal])
        : timeoutSignal;
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal,
        });

        if (!response.ok) {
          await response.body?.cancel();
          // Provider error text may echo request content; keep only the status.
          logger.warn(
            { status: response.status, attempt },
            'llm request failed',
          );
          if (response.status === 429) throw new AppError({ code: 'quota_exhausted', message: 'LLM quota exhausted' });
          if (response.status >= 500) {
            throw AppError.serviceUnavailable(`LLM provider error (${response.status})`);
          }
          throw AppError.serviceUnavailable(`LLM request rejected (${response.status})`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw AppError.serviceUnavailable('LLM returned no response body');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > env.LLM_MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw AppError.sourceIncomplete('Model response exceeds configured byte budget');
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as OpenAiChatResponse;
        const choice = payload.choices?.[0];
        if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) {
          throw AppError.serviceUnavailable('LLM returned no usable content');
        }
        return {
          content: choice?.message?.content ?? '',
          model: payload.model ?? request.model ?? model ?? 'unknown',
          finishReason: choice?.finish_reason ?? null,
          usage: {
            inputTokens: payload.usage?.prompt_tokens ?? null,
            outputTokens: payload.usage?.completion_tokens ?? null,
          },
          latencyMs: Date.now() - started,
        };
      } catch (err: unknown) {
        request.signal?.throwIfAborted();
        lastError = timeoutSignal.aborted
          ? new AppError({ code: 'model_timeout', message: 'LLM request timed out' })
          : err;
        if (err instanceof AppError && err.code === 'source_incomplete') break;
        if (attempt === maxRetries) break;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }

    if (lastError instanceof AppError) throw lastError;
    throw AppError.serviceUnavailable('LLM request failed after retries');
  }

  return { configured, model, baseUrl, complete };
}

/**
 * Report the LLM credential policy once at boot.
 *
 * `anonymous_local` is a supported configuration (no key needed). A remote base
 * URL without a key is surfaced as a warning instead of failing silently at the
 * first call. `unconfigured` is not an error: AI tasks stay disabled and the
 * manual path is unaffected.
 */
export function logLlmPolicy(env: Env, logger: Logger): void {
  switch (llmKeyPolicy(env)) {
    case 'key_missing_for_remote':
      logger.warn(
        { llmBaseUrl: env.LLM_BASE_URL },
        'LLM_BASE_URL is remote but LLM_API_KEY is unset; AI calls will fail until a key is provided',
      );
      break;
    case 'anonymous_local':
      logger.info(
        { llmBaseUrl: env.LLM_BASE_URL },
        'LLM provider is local and anonymous; no API key required',
      );
      break;
    case 'unconfigured':
      logger.info(
        'LLM provider is not configured; AI tasks stay disabled and manual mode is unaffected',
      );
      break;
    case 'key_present':
      break;
  }
}

export { isLlmConfigured };

export type { Env };
