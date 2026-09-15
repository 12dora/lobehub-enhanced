import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let capturedOptions: any;

vi.mock('@lobechat/chat-adapter-dingtalk', () => ({
  DingTalkStreamConnection: vi.fn().mockImplementation((options: any) => {
    capturedOptions = options;
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };
  }),
}));

const { DingTalkWSConnection } = await import('./gateway');

describe('DingTalkWSConnection', () => {
  beforeEach(() => {
    capturedOptions = undefined;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('forwards robot messages as synthetic webhooks', async () => {
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
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        method: 'POST',
      }),
    );
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
});
