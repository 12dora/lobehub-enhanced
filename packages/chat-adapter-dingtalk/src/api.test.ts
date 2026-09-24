import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DingTalkApiClient, type DingTalkTokenCache, type DingTalkTokenKind } from './api';
import { DINGTALK_API_BASE, DINGTALK_OAPI_BASE } from './types';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

describe('DingTalkApiClient', () => {
  let client: DingTalkApiClient;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    client = new DingTalkApiClient('app_key', 'app_secret');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('token cache', () => {
    it('requests oauth2/accessToken and reuses the cached token', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'tok_1', expireIn: 7200 }));
      fetchMock.mockResolvedValueOnce(jsonResponse({}));

      await client.sendOtoMessage({
        msgKey: 'sampleText',
        msgParam: '{"content":"hi"}',
        robotCode: 'robot',
        userIds: ['u1'],
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe(`${DINGTALK_API_BASE}/v1.0/oauth2/accessToken`);
      const tokenBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(tokenBody).toEqual({ appKey: 'app_key', appSecret: 'app_secret' });

      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await client.sendOtoMessage({
        msgKey: 'sampleText',
        msgParam: '{"content":"hi2"}',
        robotCode: 'robot',
        userIds: ['u1'],
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(String(fetchMock.mock.calls[2][0])).toContain('/v1.0/robot/oToMessages/batchSend');
    });

    it('refreshes 5 minutes before expiry', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ accessToken: 'tok_1', expireIn: 7200 }));
      await client.getAccessToken();
      fetchMock.mockClear();

      vi.advanceTimersByTime((7200 - 300) * 1000 + 1);
      fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'tok_2', expireIn: 7200 }));
      const token = await client.getAccessToken();
      expect(token).toBe('tok_2');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('endpoints', () => {
    const withToken = () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'tok', expireIn: 7200 }));
    };

    it('sendBySessionWebhook posts JSON with no token header', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0 }));
      await client.sendBySessionWebhook(
        'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
        {
          markdown: { text: 'hi', title: 't' },
          msgtype: 'markdown',
        },
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://oapi.dingtalk.com/robot/sendBySession?session=abc');
      expect((init as RequestInit).redirect).toBe('error');
      expect(
        (init.headers as Record<string, string>)['x-acs-dingtalk-access-token'],
      ).toBeUndefined();
    });

    it('rejects a sessionWebhook whose host is not *.dingtalk.com', async () => {
      await expect(
        client.sendBySessionWebhook('http://169.254.169.254/latest/meta-data', {
          msgtype: 'markdown',
        }),
      ).rejects.toMatchObject({
        code: 'invalid_webhook',
        name: 'DingTalkApiError',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not put the webhook query string in the API error message', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ errmsg: 'boom', errcode: 400 }, 400));
      const webhook = 'https://oapi.dingtalk.com/robot/sendBySession?session=secret-token';
      await expect(
        client.sendBySessionWebhook(webhook, { msgtype: 'markdown' }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('sessionWebhook'),
      });
      try {
        fetchMock.mockResolvedValueOnce(jsonResponse({ errmsg: 'boom', errcode: 400 }, 400));
        await client.sendBySessionWebhook(webhook, { msgtype: 'markdown' });
      } catch (error) {
        expect((error as Error).message).not.toContain('session=');
        expect((error as Error).message).not.toContain('secret-token');
        expect((error as Error).message).not.toContain(webhook);
      }
    });

    it('sendOtoMessage and sendGroupMessage hit robot APIs with the ACS token', async () => {
      withToken();
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await client.sendOtoMessage({
        msgKey: 'sampleMarkdown',
        msgParam: '{"title":"t","text":"hi"}',
        robotCode: 'r',
        userIds: ['staff1'],
      });
      expect(String(fetchMock.mock.calls[1][0])).toBe(
        `${DINGTALK_API_BASE}/v1.0/robot/oToMessages/batchSend`,
      );
      const otoHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<
        string,
        string
      >;
      expect(otoHeaders['x-acs-dingtalk-access-token']).toBe('tok');

      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await client.sendGroupMessage({
        msgKey: 'sampleMarkdown',
        msgParam: '{"title":"t","text":"hi"}',
        openConversationId: 'cid',
        robotCode: 'r',
      });
      expect(String(fetchMock.mock.calls[2][0])).toBe(
        `${DINGTALK_API_BASE}/v1.0/robot/groupMessages/send`,
      );
    });

    it('downloadMessageFile follows downloadUrl and returns buffer + filename/mime', async () => {
      withToken();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ downloadUrl: 'https://cdn.example/file.bin' }),
      );
      fetchMock.mockResolvedValueOnce(
        new Response(Buffer.from('file-bytes'), {
          headers: {
            'Content-Disposition': 'attachment; filename="report.pdf"',
            'Content-Type': 'application/pdf',
          },
          status: 200,
        }),
      );

      const file = await client.downloadMessageFile({ downloadCode: 'dl', robotCode: 'r' });
      expect(file.buffer.toString()).toBe('file-bytes');
      expect(file.filename).toBe('report.pdf');
      expect(file.mimeType).toBe('application/pdf');
    });

    it('uploadMedia uses legacy gettoken + oapi media/upload', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ access_token: 'legacy', errcode: 0, expires_in: 7200 }),
      );
      fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, media_id: 'media_1' }));

      const mediaId = await client.uploadMedia({
        buffer: Buffer.from('img'),
        filename: 'pic.jpg',
        type: 'image',
      });
      expect(mediaId).toBe('media_1');
      expect(String(fetchMock.mock.calls[0][0])).toContain(`${DINGTALK_OAPI_BASE}/gettoken`);
      expect(String(fetchMock.mock.calls[1][0])).toContain(`${DINGTALK_OAPI_BASE}/media/upload`);
    });

    it('createAndDeliverCard / streamCard / updateCard hit card endpoints', async () => {
      withToken();
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await client.createAndDeliverCard({
        cardTemplateId: 'tpl',
        outTrackId: 'out_1',
        robotCode: 'r',
        staffId: 'staff1',
      });
      expect(String(fetchMock.mock.calls[1][0])).toBe(`${DINGTALK_API_BASE}/v1.0/card/instances`);
      expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');

      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await client.streamCard({
        content: 'hello',
        isFinalize: false,
        isFull: true,
        outTrackId: 'out_1',
      });
      const streamInit = fetchMock.mock.calls[2][1] as RequestInit;
      expect(String(fetchMock.mock.calls[2][0])).toBe(`${DINGTALK_API_BASE}/v1.0/card/streaming`);
      expect(streamInit.method).toBe('PUT');
      expect(JSON.parse(streamInit.body as string)).toMatchObject({
        content: 'hello',
        isFinalize: false,
        isFull: true,
        key: 'content',
      });

      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await client.updateCard({
        cardData: { cardParamMap: { content: 'done' } },
        outTrackId: 'out_1',
      });
      expect(String(fetchMock.mock.calls[3][0])).toBe(`${DINGTALK_API_BASE}/v1.0/card/instances`);
      expect((fetchMock.mock.calls[3][1] as RequestInit).method).toBe('PUT');
    });

    it('returns processQueryKey from sendOtoMessage', async () => {
      withToken();
      fetchMock.mockResolvedValueOnce(jsonResponse({ processQueryKey: 'pqk-1' }));
      const result = await client.sendOtoMessage({
        msgKey: 'sampleMarkdown',
        msgParam: '{"title":"t","text":"hi"}',
        robotCode: 'r',
        userIds: ['staff1'],
      });
      expect(result).toEqual({ processQueryKey: 'pqk-1' });
    });

    it('recalls 1:1 messages via otoMessages/batchRecall', async () => {
      withToken();
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await client.recallMessage({ processQueryKeys: ['pqk-1'], robotCode: 'r' });
      expect(String(fetchMock.mock.calls[1][0])).toBe(
        `${DINGTALK_API_BASE}/v1.0/robot/otoMessages/batchRecall`,
      );
      expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
        processQueryKeys: ['pqk-1'],
        robotCode: 'r',
      });
    });

    it('recalls group messages via groupMessages/recall', async () => {
      withToken();
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await client.recallMessage({
        openConversationId: 'cid',
        processQueryKeys: ['pqk-g'],
        robotCode: 'r',
      });
      expect(String(fetchMock.mock.calls[1][0])).toBe(
        `${DINGTALK_API_BASE}/v1.0/robot/groupMessages/recall`,
      );
      expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
        openConversationId: 'cid',
        processQueryKeys: ['pqk-g'],
        robotCode: 'r',
      });
    });

    it('logs warn and does not throw when recall returns 200 with failedResult', async () => {
      withToken();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ failedResult: { 'pqk-1': 'notRevoke.all.messages' } }),
      );
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      await expect(
        client.recallMessage({ processQueryKeys: ['pqk-1'], robotCode: 'r' }),
      ).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith('DingTalk recall failedResult keys=%O', ['pqk-1']);
      warn.mockRestore();
    });

    it('does not warn when recall 200 has an empty failedResult', async () => {
      withToken();
      fetchMock.mockResolvedValueOnce(jsonResponse({ failedResult: {} }));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      await expect(
        client.recallMessage({ processQueryKeys: ['pqk-1'], robotCode: 'r' }),
      ).resolves.toBeUndefined();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('extractProcessQueryKey', () => {
    it('reads top-level, nested result, and processQueryKeys[0]', async () => {
      const { extractProcessQueryKey } = await import('./api');
      expect(extractProcessQueryKey({ processQueryKey: 'a' })).toBe('a');
      expect(extractProcessQueryKey({ result: { processQueryKey: 'b' } })).toBe('b');
      expect(extractProcessQueryKey({ processQueryKeys: ['c'] })).toBe('c');
      expect(extractProcessQueryKey({})).toBeUndefined();
    });
  });

  describe('error mapping', () => {
    it('maps DingTalk code/message onto DingTalkApiError', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ code: 'InvalidAuthentication', message: 'bad secret' }, 400),
      );
      await expect(client.getAccessToken()).rejects.toMatchObject({
        code: 'InvalidAuthentication',
        message: expect.stringContaining('bad secret'),
        name: 'DingTalkApiError',
      });
    });
  });
});

describe('DingTalkApiClient shared token cache', () => {
  const fetchMock = vi.fn<typeof fetch>();

  const memoryCache = (): DingTalkTokenCache & {
    store: Map<string, { expiresAt: number; token: string }>;
  } => {
    const store = new Map<string, { expiresAt: number; token: string }>();
    return {
      store,
      async delete(kind: DingTalkTokenKind) {
        store.delete(kind);
      },
      async get(kind: DingTalkTokenKind) {
        const hit = store.get(kind);
        if (!hit || hit.expiresAt <= Date.now()) return null;
        return hit;
      },
      async set(kind: DingTalkTokenKind, token: string, ttlMs: number) {
        store.set(kind, { expiresAt: Date.now() + ttlMs, token });
      },
    };
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shares a token across two clients through the injected cache', async () => {
    const cache = memoryCache();
    const first = new DingTalkApiClient('app_key', 'app_secret', { tokenCache: cache });
    const second = new DingTalkApiClient('app_key', 'app_secret', { tokenCache: cache });
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'shared', expireIn: 7200 }));

    await expect(first.getAccessToken()).resolves.toBe('shared');
    await expect(second.getAccessToken()).resolves.toBe('shared');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.store.get('accessToken')?.token).toBe('shared');
  });

  it('single-flights two concurrent refreshes into one fetch', async () => {
    const flights = new Map<DingTalkTokenKind, Promise<string>>();
    const singleFlight = (
      kind: DingTalkTokenKind,
      task: () => Promise<string>,
    ): Promise<string> => {
      const pending = flights.get(kind);
      if (pending) return pending;
      const promise = task().finally(() => {
        if (flights.get(kind) === promise) flights.delete(kind);
      });
      flights.set(kind, promise);
      return promise;
    };
    const clientA = new DingTalkApiClient('app_key', 'app_secret', { singleFlight });
    const clientB = new DingTalkApiClient('app_key', 'app_secret', { singleFlight });
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: 'once', expireIn: 7200 }));

    const [a, b] = await Promise.all([clientA.getAccessToken(), clientB.getAccessToken()]);
    expect(a).toBe('once');
    expect(b).toBe('once');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('calls onRequest for token, robot, webhook, legacy upload, and file download', async () => {
    const seen: Array<{ method: string; url: string }> = [];
    const client = new DingTalkApiClient('app_key', 'app_secret', {
      onRequest: (info) => {
        seen.push(info);
      },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'tok', expireIn: 7200 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await client.sendOtoMessage({
      msgKey: 'sampleText',
      msgParam: '{}',
      robotCode: 'r',
      userIds: ['u'],
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0 }));
    await client.sendBySessionWebhook(
      'https://oapi.dingtalk.com/robot/sendBySession?session=secret',
      {
        msgtype: 'markdown',
      },
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'legacy', errcode: 0, expires_in: 7200 }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, media_id: 'mid' }));
    await client.uploadMedia({ buffer: Buffer.from('x'), filename: 'a.png', type: 'image' });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ downloadUrl: 'https://cdn.dingtalk.com/file?token=secret' }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' }, status: 200 }),
    );
    await client.downloadMessageFile({ downloadCode: 'd', robotCode: 'r' });

    expect(seen).toEqual([
      { method: 'POST', url: `${DINGTALK_API_BASE}/v1.0/oauth2/accessToken` },
      { method: 'POST', url: `${DINGTALK_API_BASE}/v1.0/robot/oToMessages/batchSend` },
      { method: 'POST', url: 'https://oapi.dingtalk.com/robot/sendBySession' },
      { method: 'GET', url: `${DINGTALK_OAPI_BASE}/gettoken` },
      { method: 'POST', url: `${DINGTALK_OAPI_BASE}/media/upload` },
      { method: 'POST', url: `${DINGTALK_API_BASE}/v1.0/robot/messageFiles/download` },
      { method: 'GET', url: 'https://cdn.dingtalk.com/file' },
    ]);
    expect(JSON.stringify(seen)).not.toContain('secret');
    expect(JSON.stringify(seen)).not.toContain('app_secret');
  });

  it('ignores a throwing onRequest hook', async () => {
    const client = new DingTalkApiClient('app_key', 'app_secret', {
      onRequest: () => {
        throw new Error('counter down');
      },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'tok', expireIn: 7200 }));
    await expect(client.getAccessToken()).resolves.toBe('tok');
  });

  it('drops an invalid token and retries the request once', async () => {
    const cache = memoryCache();
    const client = new DingTalkApiClient('app_key', 'app_secret', { tokenCache: cache });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'stale', expireIn: 7200 }))
      .mockResolvedValueOnce(
        jsonResponse({ code: 'InvalidAuthentication', message: 'invalid token' }, 401),
      )
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'fresh', expireIn: 7200 }))
      .mockResolvedValueOnce(jsonResponse({}));

    await client.sendOtoMessage({
      msgKey: 'sampleText',
      msgParam: '{}',
      robotCode: 'r',
      userIds: ['u'],
    });

    const tokenPosts = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/oauth2/accessToken'),
    );
    expect(tokenPosts).toHaveLength(2);
    const sends = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/oToMessages/batchSend'),
    );
    expect(sends).toHaveLength(2);
    const retriedHeaders = (sends[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(retriedHeaders['x-acs-dingtalk-access-token']).toBe('fresh');
    expect(cache.store.get('accessToken')?.token).toBe('fresh');
  });

  it('countedRequest fires onRequest for the OpenAPI url', async () => {
    const seen: Array<{ method: string; url: string }> = [];
    const counted = new DingTalkApiClient('app_key', 'app_secret', {
      onRequest: (info) => {
        seen.push(info);
      },
      tokenCache: {
        get: () => ({ expiresAt: Date.now() + 60_000, token: 'tok' }),
        set: () => undefined,
      },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));
    await counted.countedRequest('POST', '/v1.0/card/instances/createAndDeliver', {
      outTrackId: 'confirm-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      {
        method: 'POST',
        url: `${DINGTALK_API_BASE}/v1.0/card/instances/createAndDeliver`,
      },
    ]);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ outTrackId: 'confirm-1' });
  });
});
