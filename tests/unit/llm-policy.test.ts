import { describe, expect, it } from 'vitest';
import {
  isLlmConfigured,
  isLocalLlmHost,
  llmKeyPolicy,
  loadEnv,
} from '../../src/config/env.js';

const BASE = { DATABASE_URL: 'postgres://andthen:andthen@127.0.0.1:55432/andthen' };

function envWith(overrides: Record<string, string> = {}) {
  return loadEnv({ ...BASE, ...overrides });
}

describe('LLM key policy', () => {
  it('recognises loopback, private and in-cluster hosts as local', () => {
    for (const url of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:8000/v1',
      'http://[::1]:8080/v1',
      'http://ollama:11434/v1',
      'http://host.docker.internal:11434/v1',
      'http://10.1.2.3:8000/v1',
      'http://192.168.1.50:8000/v1',
      'http://172.16.5.5:8000/v1',
      'http://172.31.255.1:8000/v1',
      'http://169.254.1.1:8000/v1',
      'http://llm.internal/v1',
      'http://box.local/v1',
    ]) {
      expect(isLocalLlmHost(url), url).toBe(true);
    }
  });

  it('treats public hosts as remote', () => {
    for (const url of [
      'https://api.openai.com/v1',
      'https://api.example.com/v1',
      'https://8.8.8.8/v1',
      'https://172.32.0.1/v1',
      'https://172.15.0.1/v1',
    ]) {
      expect(isLocalLlmHost(url), url).toBe(false);
    }
  });

  it('classifies the four configuration states', () => {
    expect(llmKeyPolicy(envWith())).toBe('unconfigured');
    expect(llmKeyPolicy(envWith({ LLM_BASE_URL: 'http://localhost:11434/v1' }))).toBe(
      'unconfigured',
    );
    expect(
      llmKeyPolicy(envWith({ LLM_BASE_URL: 'http://localhost:11434/v1', LLM_MODEL: 'llama3' })),
    ).toBe('anonymous_local');
    expect(
      llmKeyPolicy(
        envWith({
          LLM_BASE_URL: 'https://api.example.com/v1',
          LLM_MODEL: 'gpt-x',
        }),
      ),
    ).toBe('key_missing_for_remote');
    expect(
      llmKeyPolicy(
        envWith({
          LLM_BASE_URL: 'https://api.example.com/v1',
          LLM_MODEL: 'gpt-x',
          LLM_API_KEY: 'sk-test',
        }),
      ),
    ).toBe('key_present');
    expect(
      llmKeyPolicy(
        envWith({
          LLM_BASE_URL: 'http://localhost:11434/v1',
          LLM_MODEL: 'llama3',
          LLM_API_KEY: 'unused-but-present',
        }),
      ),
    ).toBe('key_present');
  });

  it('treats an anonymous local provider as configured and an empty config as disabled', () => {
    // Manual mode is unaffected: nothing configured means AI is simply off.
    expect(isLlmConfigured(envWith())).toBe(false);

    expect(
      isLlmConfigured(envWith({ LLM_BASE_URL: 'http://localhost:11434/v1', LLM_MODEL: 'llama3' })),
    ).toBe(true);

    // A remote URL without a key is still "configured" — the caller gets a
    // warning at boot rather than a silent disable.
    expect(
      isLlmConfigured(envWith({ LLM_BASE_URL: 'https://api.example.com/v1', LLM_MODEL: 'gpt-x' })),
    ).toBe(true);
  });
});
