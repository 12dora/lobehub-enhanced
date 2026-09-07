// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const npmUrl = 'https://registry.npmjs.org/@openai/codex/latest';
const githubUrl = 'https://api.github.com/repos/openai/codex/releases/latest';
const json = (body: unknown) => new Response(JSON.stringify(body));
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('CHATGPT_CODEX_CLIENT_VERSION', '');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const resolver = () => import('./clientVersion');

describe('resolveCodexClientVersion', () => {
  it.each(['0.160.0', '1.0.0', '0.154.0-beta.1'])(
    'honors valid env override %s',
    async (version) => {
      vi.stubEnv('CHATGPT_CODEX_CLIENT_VERSION', version);
      expect(await (await resolver()).resolveCodexClientVersion()).toBe(version);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['0.1.0', '0.153.4-beta.1'])('clamps env %s to the stable floor', async (version) => {
    vi.stubEnv('CHATGPT_CODEX_CLIENT_VERSION', version);
    const { CODEX_CLIENT_VERSION, resolveCodexClientVersion } = await resolver();
    expect(await resolveCodexClientVersion()).toBe(CODEX_CLIENT_VERSION);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores invalid env, shares in-flight lookup and caches npm for six hours', async () => {
    vi.useFakeTimers();
    vi.stubEnv('CHATGPT_CODEX_CLIENT_VERSION', '999.invalid');
    fetchMock.mockResolvedValue(json({ version: '0.160.0' }));
    const { resolveCodexClientVersion } = await resolver();
    expect(await Promise.all([resolveCodexClientVersion(), resolveCodexClientVersion()])).toEqual([
      '0.160.0',
      '0.160.0',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      npmUrl,
      expect.objectContaining({
        headers: { 'Accept': 'application/json', 'User-Agent': expect.any(String) },
        signal: expect.any(AbortSignal),
      }),
    );
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1);
    expect(await resolveCodexClientVersion()).toBe('0.160.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.stubEnv('CHATGPT_CODEX_CLIENT_VERSION', '0.170.0');
    expect(await resolveCodexClientVersion()).toBe('0.170.0');
    vi.stubEnv('CHATGPT_CODEX_CLIENT_VERSION', '');
    await vi.advanceTimersByTimeAsync(1);
    fetchMock.mockResolvedValue(json({ version: '0.161.0' }));
    expect(await resolveCodexClientVersion()).toBe('0.161.0');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['http', 'network', 'json', 'semver'])(
    'falls back to GitHub after npm %s failure',
    async (failure) => {
      if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'));
      else
        fetchMock.mockResolvedValueOnce(
          failure === 'http'
            ? new Response('', { status: 503 })
            : failure === 'json'
              ? new Response('{')
              : json({ version: 'latest' }),
        );
      fetchMock.mockResolvedValueOnce(json({ tag_name: 'rust-v0.160.0' }));
      expect(await (await resolver()).resolveCodexClientVersion()).toBe('0.160.0');
      expect(fetchMock.mock.calls[1][0]).toBe(githubUrl);
    },
  );

  it.each(['npm', 'github'])('clamps older %s releases to the floor', async (source) => {
    if (source === 'github') fetchMock.mockRejectedValueOnce(new Error('offline'));
    fetchMock.mockResolvedValueOnce(
      json(source === 'npm' ? { version: '0.10.0' } : { tag_name: 'rust-v0.10.0' }),
    );
    expect(await (await resolver()).resolveCodexClientVersion()).toBe('0.153.4');
  });

  it('uses and caches the floor when both sources fail validation', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ version: null }))
      .mockResolvedValueOnce(json({ tag_name: 'v9.0.0' }));
    const { resolveCodexClientVersion } = await resolver();
    expect(await resolveCodexClientVersion()).toBe('0.153.4');
    expect(await resolveCodexClientVersion()).toBe('0.153.4');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts each lookup after five seconds and returns within ten even if fetch ignores abort', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { resolveCodexClientVersion } = await resolver();
    const pending = resolveCodexClientVersion();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    expect(await pending).toBe('0.153.4');
  });

  it('also bounds stalled JSON decoding', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    const pending = (await resolver()).resolveCodexClientVersion();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe('0.153.4');
  });
});
