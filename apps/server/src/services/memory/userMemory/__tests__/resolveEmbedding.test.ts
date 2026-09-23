import { describe, expect, it } from 'vitest';

import { resolveMemoryServiceAgent } from '../resolveEmbedding';

const fallback = {
  apiKey: 'env-key',
  baseURL: 'https://fallback.example/v1',
  contextLimit: 8192,
  language: 'Chinese',
  model: 'text-embedding-3-small',
  provider: 'openai',
};

describe('resolveMemoryServiceAgent', () => {
  it('uses the fallback when the admin has not selected an embedding model', () => {
    expect(resolveMemoryServiceAgent(undefined, fallback)).toEqual(fallback);
  });

  it('prefers the published userMemoryEmbedding model and provider', () => {
    expect(
      resolveMemoryServiceAgent(
        { model: 'Qwen/Qwen3-Embedding-4B', provider: 'siliconcloud' },
        fallback,
      ),
    ).toEqual({
      apiKey: undefined,
      baseURL: undefined,
      contextLimit: 8192,
      language: 'Chinese',
      model: 'Qwen/Qwen3-Embedding-4B',
      provider: 'siliconcloud',
      reasoningEffort: undefined,
    });
  });

  it('keeps the fallback key when the override provider is the same', () => {
    expect(
      resolveMemoryServiceAgent({ model: 'text-embedding-3-large', provider: 'OpenAI' }, fallback),
    ).toMatchObject({
      apiKey: 'env-key',
      baseURL: 'https://fallback.example/v1',
      model: 'text-embedding-3-large',
      provider: 'OpenAI',
    });
  });
});
