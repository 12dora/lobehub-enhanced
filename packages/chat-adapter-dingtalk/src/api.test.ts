import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DingTalkApiClient } from './api';
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
