// @vitest-environment node
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onTopicComplete } from '../onTopicComplete';

const { mockGetServerDB, mockOnTopicComplete, mockNotifyAfterTopicComplete } = vi.hoisted(() => ({
  mockGetServerDB: vi.fn(),
  mockNotifyAfterTopicComplete: vi.fn(),
  mockOnTopicComplete: vi.fn(),
}));

vi.mock('@/database/server', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/server/services/taskLifecycle', () => ({
  TaskLifecycleService: vi.fn().mockImplementation(() => ({
    onTopicComplete: mockOnTopicComplete,
  })),
}));

vi.mock('@/server/services/taskNotification', () => ({
  notifyAfterTopicComplete: mockNotifyAfterTopicComplete,
}));

describe('onTopicComplete handler', () => {
  const json = vi.fn();

  const makeContext = (body: Record<string, unknown>) =>
    ({
      json,
      req: { json: async () => body },
    }) as unknown as Context;

  beforeEach(() => {
    vi.clearAllMocks();
    json.mockImplementation((body: unknown, status?: number) => ({ body, status }));
    mockOnTopicComplete.mockResolvedValue(undefined);
    mockNotifyAfterTopicComplete.mockResolvedValue(undefined);
    mockGetServerDB.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => [{ workspaceId: 'ws-1' }],
          }),
        }),
      }),
    });
  });

  it('calls notifyAfterTopicComplete after lifecycle settles', async () => {
    await onTopicComplete(
      makeContext({
        lastAssistantContent: 'final output',
        operationId: 'op-1',
        reason: 'done',
        taskId: 'task-1',
        taskIdentifier: 'T-1',
        topicId: 'topic-1',
        userId: 'user-1',
      }),
    );

    expect(mockOnTopicComplete).toHaveBeenCalled();
    expect(mockNotifyAfterTopicComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        lastAssistantContent: 'final output',
        reason: 'done',
        taskId: 'task-1',
        topicId: 'topic-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
      }),
    );
    expect(json).toHaveBeenCalledWith({ success: true });
  });
});
