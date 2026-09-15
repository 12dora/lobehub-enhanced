import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedis = {
  del: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => mockRedis),
}));

vi.mock('./cards', () => ({
  sendDingTalkChoiceList: vi.fn(),
  sendDingTalkMarkdown: vi.fn(),
}));

const {
  clearDingTalkPendingQuestion,
  extractDingTalkQuestion,
  forwardDingTalkWaitingQuestion,
  loadDingTalkPendingQuestion,
  resolveQuestionAnswer,
  storeDingTalkPendingQuestion,
} = await import('./questions');

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.del.mockResolvedValue(1);
});

describe('extractDingTalkQuestion', () => {
  it('reads askUserQuestion tool args and toolResult anchors', () => {
    const pending = extractDingTalkQuestion({
      finalState: {
        pendingHumanToolMessages: [
          {
            kind: 'toolResult',
            messageId: 'msg_tool_1',
            toolCallId: 'call_1',
          },
        ],
        pendingToolsCalling: [
          {
            apiName: 'askUserQuestion',
            arguments: JSON.stringify({
              questions: [
                {
                  options: [
                    { label: '同意', value: 'yes' },
                    { label: '拒绝', value: 'no' },
                  ],
                  question: '是否继续？',
                },
              ],
            }),
            id: 'call_1',
            identifier: 'lobe-user-interaction',
          },
        ],
      },
      lastAssistantContent: 'ignored',
      operationId: 'op_1',
    });
    expect(pending).toMatchObject({
      operationId: 'op_1',
      parentMessageId: 'msg_tool_1',
      prompt: '是否继续？',
      questionId: 'msg_tool_1',
      toolCallId: 'call_1',
    });
    expect(pending?.options).toEqual([
      { label: '同意', value: 'yes' },
      { label: '拒绝', value: 'no' },
    ]);
  });
});

describe('pending question store', () => {
  it('stores and loads { operationId, questionId }', async () => {
    const pending = {
      operationId: 'op_1',
      parentMessageId: 'msg_1',
      prompt: '确认？',
      questionId: 'msg_1',
      toolCallId: 'call_1',
    };
    await storeDingTalkPendingQuestion('dingtalk:cid', pending);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'messenger:dingtalk:pending-question:dingtalk:cid',
      JSON.stringify(pending),
      'EX',
      24 * 60 * 60,
    );

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(pending));
    await expect(loadDingTalkPendingQuestion('dingtalk:cid')).resolves.toEqual(pending);
    await clearDingTalkPendingQuestion('dingtalk:cid');
    expect(mockRedis.del).toHaveBeenCalledWith('messenger:dingtalk:pending-question:dingtalk:cid');
  });

  it('maps numbered replies to option values', () => {
    const pending = {
      operationId: 'op_1',
      options: [
        { label: '同意', value: 'yes' },
        { label: '拒绝', value: 'no' },
      ],
      prompt: '确认？',
      questionId: 'q1',
    };
    expect(resolveQuestionAnswer('2', pending)).toBe('no');
    expect(resolveQuestionAnswer('同意', pending)).toBe('yes');
    expect(resolveQuestionAnswer('custom', pending)).toBe('custom');
  });
});

describe('forwardDingTalkWaitingQuestion', () => {
  it('paginates options beyond 5 via pageCommandPrefix', async () => {
    const { sendDingTalkChoiceList } = await import('./cards');
    await forwardDingTalkWaitingQuestion('dingtalk:cid', {
      finalState: {
        pendingHumanToolMessages: [
          { kind: 'toolResult', messageId: 'msg_1', toolCallId: 'call_1' },
        ],
        pendingToolsCalling: [
          {
            apiName: 'askUserQuestion',
            arguments: JSON.stringify({
              questions: [
                {
                  options: [
                    { label: 'A', value: 'a' },
                    { label: 'B', value: 'b' },
                    { label: 'C', value: 'c' },
                    { label: 'D', value: 'd' },
                    { label: 'E', value: 'e' },
                    { label: 'F', value: 'f' },
                  ],
                  question: '选一个',
                },
              ],
            }),
            id: 'call_1',
            identifier: 'lobe-user-interaction',
          },
        ],
      },
      operationId: 'op_1',
    });
    expect(sendDingTalkChoiceList).toHaveBeenCalledWith(
      expect.objectContaining({
        pageCommandPrefix: 'messenger:question:page:',
        text: '选一个',
      }),
    );
  });
});
