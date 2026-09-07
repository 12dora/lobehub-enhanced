// @vitest-environment node
import { loadModels } from '@lobechat/business-model-bank/model-config';
import OpenAI from 'openai';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as clientVersion from './clientVersion';
import { CODEX_CLIENT_VERSION, LobeChatGPTAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({ loadModels: vi.fn() }));
let instance: InstanceType<typeof LobeChatGPTAI>;
beforeEach(() => {
  vi.mocked(loadModels).mockResolvedValue([]);
  vi.spyOn(clientVersion, 'resolveCodexClientVersion').mockResolvedValue(CODEX_CLIENT_VERSION);
  vi.spyOn(OpenAI.prototype, 'get').mockRejectedValue(new Error('catalog offline'));
  instance = new LobeChatGPTAI({ apiKey: 'test-token', chatgptAccountId: 'test-account' });
  vi.spyOn(instance.client.responses, 'create').mockImplementation(
    () => Promise.resolve(new ReadableStream()) as never,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('live protocol discovery', () => {
  const chat = (runtime = instance, model = 'future-codex-model') =>
    runtime.chat({
      messages: [{ content: 'OK', role: 'user' }],
      model,
      stream: true,
    });
  const fixture = (useResponsesLite: boolean) => ({
    models: [
      {
        slug: 'future-codex-model',
        supported_in_api: true,
        use_responses_lite: useResponsesLite,
      },
    ],
  });
  const liteHeader = () =>
    (instance.client.responses.create as Mock).mock.lastCall?.[1]?.headers?.[
      'x-openai-internal-codex-responses-lite'
    ];

  it('discovers unknown models once across concurrent chats and honors cached false', async () => {
    const get = vi.spyOn(instance.client, 'get').mockResolvedValue(fixture(true) as never);
    await Promise.all([chat(), chat()]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(liteHeader()).toBe('true');
    await chat();
    expect(get).toHaveBeenCalledTimes(1);
    get.mockResolvedValue(fixture(false) as never);
    await instance.models();
    await chat();
    expect(liteHeader()).toBeUndefined();
  });

  it('refreshes expired flags and isolates separate runtime clients', async () => {
    vi.useFakeTimers();
    const get = vi.spyOn(instance.client, 'get').mockResolvedValue(fixture(true) as never);
    await chat();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    get.mockResolvedValue(fixture(false) as never);
    await chat();
    expect(get).toHaveBeenCalledTimes(2);
    expect(liteHeader()).toBeUndefined();
    const other = new LobeChatGPTAI({ apiKey: 'other-token', chatgptAccountId: 'other-account' });
    vi.spyOn(other.client.responses, 'create').mockImplementation(
      () => Promise.resolve(new ReadableStream()) as never,
    );
    vi.spyOn(other.client, 'get').mockResolvedValue(fixture(true) as never);
    await chat(other);
    expect((other.client.responses.create as Mock).mock.lastCall?.[1]?.headers).toHaveProperty(
      'x-openai-internal-codex-responses-lite',
      'true',
    );
  });

  it('uses live false over the static fallback and does not refetch unknown ids in a fresh catalog', async () => {
    const get = vi.spyOn(instance.client, 'get').mockResolvedValue({
      models: [{ slug: 'gpt-6-astra', use_responses_lite: false }],
    } as never);
    await instance.models();
    await chat(instance, 'gpt-6-astra');
    expect(liteHeader()).toBeUndefined();
    await chat();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('backs off after catalog failure while preserving the Astra protocol fallback', async () => {
    await chat(instance, 'gpt-6-astra');
    await chat(instance, 'gpt-6-astra');
    expect(instance.client.get).toHaveBeenCalledTimes(1);
    expect(liteHeader()).toBe('true');
  });

  it('sends the resolved version and preserves live Astra settings and ultra efforts', async () => {
    vi.mocked(clientVersion.resolveCodexClientVersion).mockResolvedValue('0.160.0');
    vi.spyOn(instance.client, 'get').mockResolvedValue({
      models: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra'].map((slug) => ({
        context_window: 272000,
        input_modalities: ['text', 'image'],
        slug,
        supported_in_api: true,
        use_responses_lite: true,
        supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(
          (effort) => ({ effort }),
        ),
      })),
    } as never);
    const models = await instance.models();
    expect(instance.client.get).toHaveBeenCalledWith(
      '/models',
      expect.objectContaining({ query: { client_version: '0.160.0' } }),
    );
    for (const id of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra']) {
      expect(models.find((card) => card.id === id)).toMatchObject({
        contextWindowTokens: 272000,
        reasoning: true,
        vision: true,
        settings: {
          chatgptResponsesLite: true,
          extendParams: expect.arrayContaining(['gpt5_6ReasoningEffort']),
        },
      });
    }
    await chat(instance, 'gpt-6-astra');
    expect(liteHeader()).toBe('true');
    expect(instance.client.get).toHaveBeenCalledTimes(1);
  });
});
