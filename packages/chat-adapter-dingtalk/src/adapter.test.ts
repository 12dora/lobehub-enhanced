import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DingTalkAdapter } from './adapter';
import {
  chunkMarkdown,
  createDingTalkAdapter,
  decodeDingTalkThreadId,
  encodeDingTalkThreadId,
  extractMediaMetadata,
} from './adapter';
import { buildDingTalkForwardHeaders } from './forwardAuth';
import { clearDingTalkCards, clearDingTalkSessions, rememberDingTalkCard } from './threadId';
import type { DingTalkRobotMessage } from './types';
import { MARKDOWN_MAX_BYTES } from './types';

const CLIENT_ID = 'app_key';
const CLIENT_SECRET = 'app_secret';

function makePayload(overrides: Partial<DingTalkRobotMessage> = {}): DingTalkRobotMessage {
  return {
    conversationId: 'cid_dm_1',
    conversationType: '1',
    createAt: 1_700_000_000_000,
    msgId: 'msg_001',
    msgtype: 'text',
    robotCode: 'robot_abc',
    senderNick: 'Alice',
    senderStaffId: 'staff_alice',
    sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
    sessionWebhookExpiredTime: Date.now() + 60_000,
    text: { content: 'hello' },
    ...overrides,
  };
}

function makeRequest(body: unknown, extraHeaders?: Record<string, string>): Request {
  return new Request('http://localhost/webhook', {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...buildDingTalkForwardHeaders({ appId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
      ...extraHeaders,
    },
    method: 'POST',
  });
}

describe('DingTalk thread id codec', () => {
  it('encodes DM as dingtalk:<conversationId>', () => {
    expect(encodeDingTalkThreadId({ conversationId: 'cid1' })).toBe('dingtalk:cid1');
  });

  it('encodes group as dingtalk:<conversationId>:<senderStaffId>', () => {
    expect(encodeDingTalkThreadId({ conversationId: 'cid1', senderStaffId: 'staff1' })).toBe(
      'dingtalk:cid1:staff1',
    );
  });

  it('decodes DM and group and round-trips', () => {
    expect(decodeDingTalkThreadId('dingtalk:cid1')).toEqual({ conversationId: 'cid1' });
    expect(decodeDingTalkThreadId('dingtalk:cid1:staff1')).toEqual({
      conversationId: 'cid1',
      senderStaffId: 'staff1',
    });
    const group = { conversationId: 'cid:with:colons', senderStaffId: 'staff1' };
    expect(decodeDingTalkThreadId(encodeDingTalkThreadId(group))).toEqual(group);
  });
});

describe('chunkMarkdown', () => {
  it('returns a single chunk when under the limit', () => {
    expect(chunkMarkdown('hello')).toEqual(['hello']);
  });

  it('splits at paragraph boundaries under 18 KiB', () => {
    const para = 'x'.repeat(10_000);
    const chunks = chunkMarkdown(`${para}\n\n${para}\n\n${para}`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(MARKDOWN_MAX_BYTES);
    }
  });
});

describe('DingTalkAdapter inbound', () => {
  let adapter: DingTalkAdapter;
  const processMessage = vi.fn();
  const mockChat = {
    getLogger: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    })),
    getUserName: vi.fn(() => 'TestBot'),
    processMessage,
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ accessToken: 'tok', expireIn: 7200 }), { status: 200 }),
        ),
    );
    clearDingTalkSessions();
    clearDingTalkCards();
    adapter = createDingTalkAdapter({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      robotCode: 'robot_abc',
    });
    processMessage.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearDingTalkSessions();
    clearDingTalkCards();
  });

  const init = async () => adapter.initialize(mockChat as any);

  it('normalizes a DM text message and marks it as a mention', async () => {
    await init();
    const payload = makePayload();
    const res = await adapter.handleWebhook(makeRequest(payload));
    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
    const [plat, threadId, factory] = processMessage.mock.calls[0];
    expect(plat).toBe(adapter);
    expect(threadId).toBe('dingtalk:cid_dm_1');
    expect(adapter.isDM(threadId)).toBe(true);

    const message = await factory();
    expect(message.text).toBe('hello');
    expect(message.author.userId).toBe('staff_alice');
    expect(message.isMention).toBe(true);
    expect(message.raw.msgtype).toBe('text');
  });

  it('normalizes a group text message with per-asker thread id', async () => {
    await init();
    const payload = makePayload({
      atUsers: [{ staffId: 'staff_alice' }],
      conversationId: 'cid_group_1',
      conversationType: '2',
      isInAtList: true,
      text: { content: '@bot help me' },
    });
    await adapter.handleWebhook(makeRequest(payload));
    const threadId = processMessage.mock.calls[0][1];
    expect(threadId).toBe('dingtalk:cid_group_1:staff_alice');
    expect(adapter.isDM(threadId)).toBe(false);
    const message = await processMessage.mock.calls[0][2]();
    expect(message.isMention).toBe(true);
  });

  it('extracts picture downloadCode as image metadata', async () => {
    await init();
    const payload = makePayload({
      content: { downloadCode: 'dl_pic_1' },
      msgtype: 'picture',
      text: undefined,
    });
    await adapter.handleWebhook(makeRequest(payload));
    const message = await processMessage.mock.calls[0][2]();
    expect(message.attachments).toEqual([
      expect.objectContaining({ mimeType: 'image/jpeg', name: 'image.jpg', type: 'image' }),
    ]);
    expect(extractMediaMetadata(payload)).toHaveLength(1);
  });

  it('extracts file metadata including fileName', async () => {
    const payload = makePayload({
      content: { downloadCode: 'dl_file_1', fileName: 'report.pdf' },
      msgtype: 'file',
      text: undefined,
    });
    expect(extractMediaMetadata(payload)).toEqual([
      expect.objectContaining({ mimeType: 'application/pdf', name: 'report.pdf', type: 'file' }),
    ]);
  });

  it('@-mentions the asker on group replies via session webhook', async () => {
    await init();
    const payload = makePayload({
      conversationId: 'cid_group_1',
      conversationType: '2',
      isInAtList: true,
    });
    await adapter.handleWebhook(makeRequest(payload));

    const fetchMock = fetch as unknown as Mock;
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response('{"errcode":0}', { status: 200 }));

    await adapter.sendMarkdown('dingtalk:cid_group_1:staff_alice', 'here is the answer');

    expect(fetchMock).toHaveBeenCalled();
    const [, initReq] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(initReq.body as string);
    expect(body.msgtype).toBe('markdown');
    expect(body.at.atUserIds).toEqual(['staff_alice']);
    expect(body.markdown.text).toContain('@Alice');
    expect(body.markdown.text).toContain('here is the answer');
  });

  it('returns 401 when forward-auth headers are missing', async () => {
    await init();
    const res = await adapter.handleWebhook(
      new Request('http://localhost/webhook', {
        body: JSON.stringify(makePayload()),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(res.status).toBe(401);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    await init();
    const res = await adapter.handleWebhook(makeRequest('{'));
    expect(res.status).toBe(400);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('turns a card callback into a synthetic command on the remembered thread', async () => {
    await init();
    rememberDingTalkCard('out_1', {
      askerStaffId: 'staff_alice',
      conversationId: 'cid_dm_1',
      conversationType: '1',
    });
    const res = await adapter.handleWebhook(
      makeRequest({
        content: { cardPrivateData: { actionIds: ['switch:agent_1'] } },
        outTrackId: 'out_1',
        userId: 'staff_alice',
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(processMessage).toHaveBeenCalledTimes(1);
    const [, threadId, factory] = processMessage.mock.calls[0];
    expect(threadId).toBe('dingtalk:cid_dm_1');
    const message = await factory();
    expect(message.text).toBe('switch:agent_1');
  });

  it('ignores card taps from a user who is not the asker', async () => {
    await init();
    rememberDingTalkCard('out_1', {
      askerStaffId: 'staff_alice',
      conversationId: 'cid_dm_1',
      conversationType: '1',
    });
    const res = await adapter.handleWebhook(
      makeRequest({
        content: { cardPrivateData: { params: { command: 'resume:topic_1' } } },
        outTrackId: 'out_1',
        userId: 'staff_bob',
      }),
    );
    expect(await res.json()).toEqual({ ignored: 'not_asker', ok: true, replied: true });
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('returns ignored unknown_card when the tap has no remembered card', async () => {
    await init();
    const res = await adapter.handleWebhook(
      makeRequest({
        content: { cardPrivateData: { actionIds: ['switch:agent_1'] } },
        outTrackId: 'missing',
        userId: 'staff_alice',
      }),
    );
    expect(await res.json()).toEqual({ ignored: 'unknown_card', ok: true });
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('falls back to oto/group robot APIs when the session webhook is expired', async () => {
    await init();
    const fetchMock = fetch as unknown as Mock;

    await adapter.handleWebhook(
      makeRequest(
        makePayload({
          sessionWebhookExpiredTime: Date.now() - 1000,
        }),
      ),
    );
    processMessage.mockReset();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await adapter.sendMarkdown('dingtalk:cid_dm_1', 'dm after expiry');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1.0/robot/oToMessages/batchSend');
    const otoBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(JSON.parse(otoBody.msgParam)).toEqual({
      text: 'dm after expiry',
      title: 'dm after expiry',
    });

    await adapter.handleWebhook(
      makeRequest(
        makePayload({
          conversationId: 'cid_group_1',
          conversationType: '2',
          isInAtList: true,
          sessionWebhookExpiredTime: Date.now() - 1000,
        }),
      ),
    );
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await adapter.sendMarkdown('dingtalk:cid_group_1:staff_alice', 'group after expiry');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1.0/robot/groupMessages/send');
    const groupBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(JSON.parse(groupBody.msgParam).at.atUserIds).toEqual(['staff_alice']);
  });

  it('recalls 1:1 and group robot messages via processQueryKey', async () => {
    await init();
    const fetchMock = fetch as unknown as Mock;
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    await adapter.recallMessage('dingtalk:cid_dm_1', 'pqk-1');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1.0/robot/otoMessages/batchRecall');
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      processQueryKeys: ['pqk-1'],
      robotCode: 'robot_abc',
    });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await adapter.recallMessage('dingtalk:cid_group_1:staff_alice', 'pqk-g');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1.0/robot/groupMessages/recall');
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      openConversationId: 'cid_group_1',
      processQueryKeys: ['pqk-g'],
      robotCode: 'robot_abc',
    });
  });
});
