import { describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { MessageService } from './index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    message: {
      cancelPendingApproval: { mutate: vi.fn() },
      createMessage: { mutate: vi.fn() },
      getMessages: { query: vi.fn() },
      removeMessagesByAssistant: { mutate: vi.fn() },
    },
  },
}));

describe('MessageService', () => {
  describe('createMessage', () => {
    const service = new MessageService();

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should pass params directly to lambdaClient', async () => {
      vi.mocked(lambdaClient.message.createMessage.mutate).mockResolvedValue({
        id: 'msg-1',
        messages: [],
      });

      await service.createMessage({
        content: 'test',
        role: 'user',
        agentId: 'agent-123',
      });

      expect(lambdaClient.message.createMessage.mutate).toHaveBeenCalledWith({
        content: 'test',
        role: 'user',
        agentId: 'agent-123',
      });
    });
  });

  describe('removeMessagesByAssistant', () => {
    const service = new MessageService();

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should pass sessionId to lambdaClient', async () => {
      vi.mocked(lambdaClient.message.removeMessagesByAssistant.mutate).mockResolvedValue(
        undefined as any,
      );

      await service.removeMessagesByAssistant('session-123');

      expect(lambdaClient.message.removeMessagesByAssistant.mutate).toHaveBeenCalledWith({
        sessionId: 'session-123',
        topicId: undefined,
      });
    });

    it('should pass sessionId and topicId to lambdaClient', async () => {
      vi.mocked(lambdaClient.message.removeMessagesByAssistant.mutate).mockResolvedValue(
        undefined as any,
      );

      await service.removeMessagesByAssistant('session-123', 'topic-1');

      expect(lambdaClient.message.removeMessagesByAssistant.mutate).toHaveBeenCalledWith({
        sessionId: 'session-123',
        topicId: 'topic-1',
      });
    });
  });

  describe('cancelPendingApproval', () => {
    const service = new MessageService();

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should pass the id and the model-facing reason to lambdaClient', async () => {
      vi.mocked(lambdaClient.message.cancelPendingApproval.mutate).mockResolvedValue({
        success: true,
      });

      await expect(
        service.cancelPendingApproval('msg-1', 'The user cancelled this action.'),
      ).resolves.toEqual({ success: true });

      expect(lambdaClient.message.cancelPendingApproval.mutate).toHaveBeenCalledWith({
        id: 'msg-1',
        reason: 'The user cancelled this action.',
      });
    });

    it('should resolve success=false instead of throwing when the race is lost', async () => {
      vi.mocked(lambdaClient.message.cancelPendingApproval.mutate).mockResolvedValue({
        success: false,
      });

      await expect(service.cancelPendingApproval('msg-1', 'reason')).resolves.toEqual({
        success: false,
      });
    });
  });
});
