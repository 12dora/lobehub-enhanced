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
import { clearDingTalkSessions } from './threadId';
import type { DingTalkRobotMessage } from './types';
import { MARKDOWN_MAX_BYTES } from './types';

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

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/webhook', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
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
    adapter = createDingTalkAdapter({
      clientId: 'app_key',
      clientSecret: 'app_secret',
      robotCode: 'robot_abc',
    });
    processMessage.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearDingTalkSessions();
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
});
