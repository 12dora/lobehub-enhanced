// @vitest-environment node
import { loadModels } from '@lobechat/business-model-bank/model-config';
import OpenAI from 'openai';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as clientVersion from './clientVersion';
import { CODEX_CLIENT_VERSION, LobeChatGPTAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({ loadModels: vi.fn() }));
let instance: InstanceType<typeof LobeChatGPTAI>;
let accountId: string;
let accountSequence = 0;
const createRuntime = (options: ConstructorParameters<typeof LobeChatGPTAI>[0] = {}) => {
  const runtime = new LobeChatGPTAI({
    apiKey: 'test-token',
    chatgptAccountId: accountId,
    ...options,
  });
  vi.spyOn(runtime.client.responses, 'create').mockImplementation(
    () => Promise.resolve(new ReadableStream()) as never,
  );
  return runtime;
};
beforeEach(() => {
  vi.mocked(loadModels).mockResolvedValue([]);
  vi.spyOn(clientVersion, 'resolveCodexClientVersion').mockResolvedValue(CODEX_CLIENT_VERSION);
  vi.spyOn(OpenAI.prototype, 'get').mockRejectedValue(new Error('catalog offline'));
  accountId = `test-account-${++accountSequence}`;
  instance = createRuntime();
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
  const liteHeader = (runtime = instance) =>
    (runtime.client.responses.create as Mock).mock.lastCall?.[1]?.headers?.[
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

  it('refreshes expired flags and isolates separate accounts', async () => {
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

  it('shares in-flight discovery and cached flags across three runtimes with the same credentials', async () => {
    let resolveCatalog!: (payload: unknown) => void;
    const get = vi.mocked(OpenAI.prototype.get).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCatalog = resolve;
        }) as never,
    );
    const second = createRuntime();
    const pending = [chat(), chat(second)];
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    resolveCatalog(fixture(true));
    await Promise.all(pending);
    const third = createRuntime();
    await chat(third);
    expect(get).toHaveBeenCalledTimes(1);
    for (const runtime of [instance, second, third]) expect(liteHeader(runtime)).toBe('true');
  });

  it('shares failure backoff across three runtimes and retries after one hour', async () => {
    vi.useFakeTimers();
    for (const runtime of [instance, createRuntime(), createRuntime()]) {
      await chat(runtime, 'gpt-6-astra');
      expect(liteHeader(runtime)).toBe('true');
    }
    expect(OpenAI.prototype.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    vi.mocked(OpenAI.prototype.get).mockResolvedValue(fixture(true) as never);
    const next = createRuntime();
    await chat(next);
    expect(OpenAI.prototype.get).toHaveBeenCalledTimes(2);
    expect(liteHeader(next)).toBe('true');
  });

  it.each([
    { chatgptAccountId: 'different-account' },
    { apiKey: 'different-token' },
    { baseURL: 'https://other.example/codex' },
  ])('isolates catalog flags for different identity components: %j', async (options) => {
    const get = vi.mocked(OpenAI.prototype.get).mockResolvedValue(fixture(true) as never);
    await chat();
    get.mockResolvedValue(fixture(false) as never);
    const other = createRuntime(options);
    await chat(other);
    expect(get).toHaveBeenCalledTimes(2);
    expect(liteHeader()).toBe('true');
    expect(liteHeader(other)).toBeUndefined();
  });

  it('falls back within ten seconds when headers arrive but JSON parsing never completes', async () => {
    vi.useFakeTimers();
    vi.mocked(OpenAI.prototype.get).mockRestore();
    const response = new Response('', { headers: { 'content-type': 'application/json' } });
    const json = vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}));
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    let startedAt = 0;
    vi.mocked(clientVersion.resolveCodexClientVersion).mockImplementation(async () => {
      startedAt = Date.now();
      return CODEX_CLIENT_VERSION;
    });
    instance = createRuntime({ fetch });
    const pending = chat(instance, 'gpt-6-astra');
    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9999 - (Date.now() - startedAt));
    expect(instance.client.responses.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(liteHeader()).toBe('true');
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    // The stuck body must not keep later runtime instances waiting or retrying.
    await chat(createRuntime({ fetch }), 'gpt-6-astra');
    expect(fetch).toHaveBeenCalledTimes(1);
    // An explicit refresh bypasses backoff and proves the in-flight slot was cleared.
    fetch.mockResolvedValue(
      new Response(JSON.stringify(fixture(true)), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    await instance.models();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves cached protocol flags when refreshing an expired catalog fails', async () => {
    vi.useFakeTimers();
    const get = vi.mocked(OpenAI.prototype.get).mockResolvedValue(fixture(true) as never);
    await chat();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    get.mockRejectedValue(new Error('catalog offline'));
    const second = createRuntime();
    await chat(second);
    await chat(createRuntime());
    expect(get).toHaveBeenCalledTimes(2);
    expect(liteHeader(second)).toBe('true');
  });

  it('evicts the least recently used catalog above 64 accounts', async () => {
    const get = vi.mocked(OpenAI.prototype.get).mockResolvedValue(fixture(true) as never);
    await chat();
    for (let index = 0; index < 63; index++) {
      await chat(createRuntime({ chatgptAccountId: `${accountId}-${index}` }));
    }
    await chat(createRuntime()); // Keep the original account recently used.
    await chat(createRuntime({ chatgptAccountId: `${accountId}-overflow` }));
    await chat(createRuntime());
    expect(get).toHaveBeenCalledTimes(65);
    await chat(createRuntime({ chatgptAccountId: `${accountId}-0` }));
    expect(get).toHaveBeenCalledTimes(66);
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
