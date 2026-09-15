import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let capturedOptions: any;

vi.mock('@lobechat/chat-adapter-dingtalk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    DingTalkStreamConnection: vi.fn().mockImplementation((options: any) => {
      capturedOptions = options;
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        get state() {
          return 'connected';
        },
      };
    }),
  };
});

const { DingTalkWSConnection } = await import('./gateway');
const {
  clearDingTalkCards,
  clearDingTalkSessions,
  DINGTALK_FORWARD_HEADER,
  rememberDingTalkCard,
  rememberDingTalkSession,
  verifyDingTalkForwardHeaders,
} = await import('@lobechat/chat-adapter-dingtalk');

describe('DingTalkWSConnection', () => {
  beforeEach(() => {
    capturedOptions = undefined;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearDingTalkSessions();
    clearDingTalkCards();
  });

  it('forwards robot messages as synthetic webhooks with forward-auth headers', async () => {
    const conn = new DingTalkWSConnection({
      clientId: 'app_key',
      clientSecret: 'secret',
      webhookUrl: 'http://localhost:3000/api/agent/webhooks/dingtalk/app_key',
    });
    await conn.start();

    expect(capturedOptions.onRobotMessage).toBeTypeOf('function');

    const ack = vi.fn();
    const payload = {
      conversationId: 'cid_1',
      conversationType: '1',
      msgId: 'm1',
      msgtype: 'text',
      senderStaffId: 'staff_1',
      text: { content: 'hi' },
    };
    await capturedOptions.onRobotMessage(payload, ack);

    expect(ack).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/agent/webhooks/dingtalk/app_key',
      expect.objectContaining({
        body: JSON.stringify(payload),
        method: 'POST',
      }),
    );
    const headers = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers[DINGTALK_FORWARD_HEADER]).toBeTruthy();
    expect(
      verifyDingTalkForwardHeaders(headers, { appId: 'app_key', clientSecret: 'secret' }),
    ).toBe(true);
  });

  it('forwards card callbacks to the same webhook', async () => {
    const conn = new DingTalkWSConnection({
      clientId: 'app_key',
      clientSecret: 'secret',
      webhookUrl: 'http://localhost:3000/api/agent/webhooks/dingtalk/app_key',
    });
    await conn.start();

    await capturedOptions.onCardCallback({ outTrackId: 'out_1', userId: 'staff_1' }, vi.fn());

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.outTrackId).toBe('out_1');
  });

  it('sends 仅提问人可操作 when the webhook reports ignored not_asker without replied', async () => {
    rememberDingTalkSession({
      conversationId: 'cid_1',
      conversationType: '2',
      robotCode: 'robot',
      senderStaffId: 'staff_alice',
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
      sessionWebhookExpiredTime: Date.now() + 60_000,
    });
    rememberDingTalkCard('out_1', {
      askerStaffId: 'staff_alice',
      conversationId: 'cid_1',
      conversationType: '2',
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ignored: 'not_asker', ok: true }), { status: 200 }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"errcode":0}', { status: 200 }));

    const conn = new DingTalkWSConnection({
      clientId: 'app_key',
      clientSecret: 'secret',
      webhookUrl: 'http://localhost:3000/api/agent/webhooks/dingtalk/app_key',
    });
    await conn.start();
    await capturedOptions.onCardCallback({ outTrackId: 'out_1', userId: 'staff_bob' }, vi.fn());

    expect(fetch).toHaveBeenCalledTimes(2);
    const secondInit = vi.mocked(fetch).mock.calls[1][1] as RequestInit;
    const secondBody = JSON.parse(secondInit.body as string);
    expect(secondBody.markdown.text).toContain('仅提问人可操作');
  });

  it('does not send again when the webhook already replied to not_asker', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ignored: 'not_asker', ok: true, replied: true }), {
        status: 200,
      }),
    );

    const conn = new DingTalkWSConnection({
      clientId: 'app_key',
      clientSecret: 'secret',
      webhookUrl: 'http://localhost:3000/api/agent/webhooks/dingtalk/app_key',
    });
    await conn.start();
    await capturedOptions.onCardCallback({ outTrackId: 'out_1', userId: 'staff_bob' }, vi.fn());

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
