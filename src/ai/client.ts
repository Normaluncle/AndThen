import type { Env } from '../config/env.js';
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
    const timeoutSignal = AbortSignal.timeout(env.LLM_TIMEOUT_MS);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;

    const body: Record<string, unknown> = {
      model: request.model ?? model,
      messages: request.messages,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.json) body.response_format = { type: 'json_object' };

    let lastError: unknown;
    for (let attempt = 0; attempt <= env.LLM_MAX_RETRIES; attempt += 1) {
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
          const text = await response.text().catch(() => '');
          // Provider error text may echo request content; keep only the status.
          logger.warn(
            { status: response.status, attempt, providerMessage: text.slice(0, 200) },
            'llm request failed',
          );
          if (response.status === 429) throw AppError.conflict('LLM quota exhausted');
          if (response.status >= 500) {
            throw AppError.serviceUnavailable(`LLM provider error (${response.status})`);
          }
          throw AppError.serviceUnavailable(`LLM request rejected (${response.status})`);
        }

        const payload = (await response.json()) as OpenAiChatResponse;
        const choice = payload.choices?.[0];
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
        lastError = err;
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        if (isTimeout) throw AppError.serviceUnavailable('LLM request timed out');
        if (attempt === env.LLM_MAX_RETRIES) break;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }

    if (lastError instanceof AppError) throw lastError;
    throw AppError.serviceUnavailable('LLM request failed after retries');
  }

  return { configured, model, baseUrl, complete };
}

export type { Env };
