// @vitest-environment node
import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { PlatformDefaultInboxService } from '@/server/enterprise/services/agentCatalog/defaultInbox';

import { TaskService } from './index';

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(),
}));

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: { findByIds: vi.fn().mockResolvedValue([]) },
}));

// AiAgentService pulls in ~14 sub-dependencies in its constructor; mock it so
// the running-status branch in updateStatus doesn't drag them in.
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    interruptTask: vi.fn(),
  })),
}));

// Attachment resolver hits FileModel + DocumentService + FileService — stub it
// out so getTaskDetail tests don't need a real file pipeline.
vi.mock('@/server/services/file/resolveAttachments', () => ({
  resolveAttachmentMetadata: vi.fn().mockResolvedValue([]),
}));

const { mockNotify } = vi.hoisted(() => ({
  mockNotify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/server/services/taskNotification', () => ({
  TASK_NOTIFY_HEARTBEAT_TIMEOUT_ZH: '心跳超时',
  TaskNotificationService: vi.fn().mockImplementation(() => ({
    notify: mockNotify,
  })),
}));

vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn().mockImplementation(() => ({
    cascadeOnCompletion: vi.fn().mockResolvedValue({ failed: [], paused: [], started: [] }),
    runTask: vi.fn(),
  })),
}));

describe('TaskService', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';

  const mockAgentModel = {
    existsById: vi.fn().mockResolvedValue(true),
    getAgentAvatarsByIds: vi.fn().mockResolvedValue([]),
    getAgentModelConfig: vi.fn().mockResolvedValue(null),
    getAgentSnapshotForTaskCreate: vi
      .fn()
      .mockResolvedValue({ snapshot: null, visibility: 'public' }),
    getAgentVisibility: vi.fn().mockResolvedValue('public'),
  };

  const mockTaskModel = {
    create: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    findAllDescendants: vi.fn(),
    getCheckpointConfig: vi.fn(),
    getComments: vi.fn(),
    getCommentFileIdsMap: vi.fn().mockResolvedValue({}),
    getDependencies: vi.fn(),
    getDependenciesByTaskIds: vi.fn().mockResolvedValue([]),
    getReviewConfig: vi.fn(),
    getVerifyConfig: vi.fn(),
    getTaskFileIds: vi.fn().mockResolvedValue([]),
    getTreeAgentIdsForTaskIds: vi.fn().mockResolvedValue({}),
    getTreePinnedDocuments: vi.fn(),
    resolve: vi.fn(),
    update: vi.fn(),
    updateContext: vi.fn(),
    updateStatus: vi.fn(),
  };

  const mockTaskTopicModel = {
    cancelIfRunning: vi.fn(),
    findByTaskId: vi.fn(),
    findRunningByTaskIds: vi.fn().mockResolvedValue([]),
    findWithHandoff: vi.fn(),
    findWithHandoffByTaskIds: vi.fn().mockResolvedValue([]),
    timeoutRunning: vi.fn(),
  };

  const mockBriefModel = {
    findByTaskId: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNotify.mockResolvedValue(undefined);
    mockTaskTopicModel.findByTaskId.mockResolvedValue([]);
    mockTaskTopicModel.findRunningByTaskIds.mockResolvedValue([]);
    (AgentModel as any).mockImplementation(() => mockAgentModel);
    (TaskModel as any).mockImplementation(() => mockTaskModel);
    (TaskTopicModel as any).mockImplementation(() => mockTaskTopicModel);
    (BriefModel as any).mockImplementation(() => mockBriefModel);
  });

  describe('getTaskDetail', () => {
    it('should return null when task is not found', async () => {
      mockTaskModel.resolve.mockResolvedValue(null);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result).toBeNull();
      expect(mockTaskModel.resolve).toHaveBeenCalledWith('TASK-1');
    });

    it('should return task detail for a simple task with no subtasks or dependencies', async () => {
      const task = {
        assigneeAgentId: 'agent-1',
        assigneeUserId: 'user-1',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        description: 'A simple task',
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: 'Do something',
        lastHeartbeatAt: null,
        name: 'Task One',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result).not.toBeNull();
      expect(result?.identifier).toBe('TASK-1');
      expect(result?.name).toBe('Task One');
      expect(result?.description).toBe('A simple task');
      expect(result?.status).toBe('todo');
      expect(result?.priority).toBe('normal');
      expect(result?.agentId).toBe('agent-1');
      expect(result?.userId).toBe('user-1');
      expect(result?.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(result?.createdByAgentId).toBeNull();
      expect(result?.subtasks).toEqual([]);
      expect(result?.dependencies).toEqual([]);
      expect(result?.activities).toBeUndefined();
      expect(result?.workspace).toBeUndefined();
      expect(result?.parent).toBeNull();
    });

    it('should resolve parent task info when parentTaskId is set', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_002',
        identifier: 'TASK-2',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Child Task',
        parentTaskId: 'task_001',
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const parentTask = {
        assigneeAgentId: 'agt_parent',
        id: 'task_001',
        identifier: 'TASK-1',
        name: 'Parent Task',
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.findById.mockResolvedValue(parentTask);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-2');

      expect(result?.parent).toEqual({
        agentId: 'agt_parent',
        identifier: 'TASK-1',
        name: 'Parent Task',
      });
      expect(mockTaskModel.findById).toHaveBeenCalledWith('task_001');
    });

    it('should return null parent when parentTaskId not found in db', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_002',
        identifier: 'TASK-2',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Child Task',
        parentTaskId: 'task_missing',
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.findById.mockResolvedValue(null);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-2');

      expect(result?.parent).toBeNull();
    });

    it('should include subtasks with blockedBy info', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Parent Task',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const subtasks = [
        {
          id: 'task_002',
          identifier: 'TASK-2',
          name: 'Sub 1',
          parentTaskId: 'task_001',
          priority: 'normal',
          status: 'todo',
        },
        {
          id: 'task_003',
          identifier: 'TASK-3',
          name: 'Sub 2',
          parentTaskId: 'task_001',
          priority: 'high',
          status: 'in_progress',
        },
      ];

      // task_003 depends on task_002
      const subtaskDeps = [{ dependsOnId: 'task_002', taskId: 'task_003' }];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue(subtasks);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.getDependenciesByTaskIds.mockResolvedValue(subtaskDeps);
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.subtasks).toHaveLength(2);
      expect(result?.subtasks?.[0]).toEqual({
        blockedBy: undefined,
        children: undefined,
        identifier: 'TASK-2',
        name: 'Sub 1',
        priority: 'normal',
        status: 'todo',
      });
      expect(result?.subtasks?.[1]).toEqual({
        blockedBy: 'TASK-2',
        children: undefined,
        identifier: 'TASK-3',
        name: 'Sub 2',
        priority: 'high',
        status: 'in_progress',
      });
    });

    it('should include running topic info for subtasks with an active topic run', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Parent Task',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const subtasks = [
        {
          currentTopicId: 'topic-running',
          id: 'task_002',
          identifier: 'TASK-2',
          name: 'Sub 1',
          parentTaskId: 'task_001',
          priority: 'normal',
          status: 'running',
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue(subtasks);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockTaskTopicModel.findRunningByTaskIds.mockResolvedValue([
        {
          operationId: 'op-running',
          seq: 2,
          status: 'running',
          taskId: 'task_002',
          topicId: 'topic-running',
        },
      ]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.getDependenciesByTaskIds.mockResolvedValue([]);
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(mockTaskTopicModel.findRunningByTaskIds).toHaveBeenCalledWith(['task_002']);
      expect(result?.subtasks?.[0].runningTopic).toEqual({
        id: 'topic-running',
        operationId: 'op-running',
      });
    });

    it('should build nested subtask tree with grandchildren', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Root Task',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      // 3-level tree: TASK-1 → TASK-2 → TASK-4, TASK-1 → TASK-3
      const allDescendants = [
        {
          id: 'task_002',
          identifier: 'TASK-2',
          name: 'Child 1',
          parentTaskId: 'task_001',
          priority: 'normal',
          status: 'todo',
        },
        {
          id: 'task_003',
          identifier: 'TASK-3',
          name: 'Child 2',
          parentTaskId: 'task_001',
          priority: 'high',
          status: 'completed',
        },
        {
          id: 'task_004',
          identifier: 'TASK-4',
          name: 'Grandchild 1',
          parentTaskId: 'task_002',
          priority: 'normal',
          status: 'running',
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue(allDescendants);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.getDependenciesByTaskIds.mockResolvedValue([]);
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      // Root has 2 direct children
      expect(result?.subtasks).toHaveLength(2);

      // Child 1 has 1 grandchild
      const child1 = result?.subtasks?.[0];
      expect(child1?.identifier).toBe('TASK-2');
      expect(child1?.children).toHaveLength(1);
      expect(child1?.children?.[0]).toEqual({
        blockedBy: undefined,
        children: undefined,
        identifier: 'TASK-4',
        name: 'Grandchild 1',
        priority: 'normal',
        status: 'running',
      });

      // Child 2 has no children
      const child2 = result?.subtasks?.[1];
      expect(child2?.identifier).toBe('TASK-3');
      expect(child2?.children).toBeUndefined();
    });

    it('should include dependencies with identifier and name', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_003',
        identifier: 'TASK-3',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 3',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const dependencies = [{ dependsOnId: 'task_002', taskId: 'task_003', type: 'blocks' }];
      const depTasks = [{ id: 'task_002', identifier: 'TASK-2', name: 'Task 2' }];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue(dependencies);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue(depTasks);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-3');

      expect(result?.dependencies).toEqual([
        { dependsOn: 'TASK-2', name: 'Task 2', type: 'blocks' },
      ]);
    });

    it('should fall back to raw dependsOnId when dep task is not found', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_003',
        identifier: 'TASK-3',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 3',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const dependencies = [{ dependsOnId: 'task_missing', taskId: 'task_003', type: 'blocks' }];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue(dependencies);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-3');

      expect(result?.dependencies).toEqual([
        { dependsOn: 'task_missing', name: undefined, type: 'blocks' },
      ]);
    });

    it('should build activities sorted by time ascending and exclude briefs', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const topics = [
        {
          createdAt: new Date('2024-01-03T00:00:00Z'),
          handoff: { title: 'Topic A' },
          seq: 1,
          status: 'completed',
          topicId: 'topic-1',
        },
      ];

      const briefs = [
        {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          id: 'brief-1',
          priority: 'normal',
          resolvedAction: null,
          resolvedComment: null,
          summary: 'Brief summary',
          title: 'Brief A',
          type: 'insight',
        },
      ];

      const comments = [
        {
          authorAgentId: 'agent-1',
          content: 'A comment',
          createdAt: new Date('2024-01-02T00:00:00Z'),
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(topics);
      mockBriefModel.findByTaskId.mockResolvedValue(briefs);
      mockTaskModel.getComments.mockResolvedValue(comments);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      // Brief (Jan 1) is intentionally excluded from the feed, even
      // though one exists for the task; only comment (Jan 2) + topic (Jan 3) remain.
      expect(result?.activities).toHaveLength(2);
      expect(result?.activities?.some((a) => a.type === 'brief')).toBe(false);
      expect(result?.activities?.[0].type).toBe('comment');
      expect(result?.activities?.[1].type).toBe('topic');
    });

    it('exposes the run last message (handoff.content) alongside the summary', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const topics = [
        {
          createdAt: new Date('2024-01-03T00:00:00Z'),
          handoff: {
            content: 'The raw last assistant message shown as the run result.',
            summary: 'A short synthesized summary.',
            title: 'Topic A',
          },
          seq: 1,
          status: 'completed',
          topicId: 'topic-1',
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(topics);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      const topicActivity = result?.activities?.find((a) => a.type === 'topic');
      expect(topicActivity?.summary).toBe('A short synthesized summary.');
      expect(topicActivity?.content).toBe(
        'The raw last assistant message shown as the run result.',
      );
    });

    it('should resolve author info for activities', async () => {
      const task = {
        assigneeAgentId: 'agt_assignee',
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'running',
        totalTopics: 0,
      };

      const topics = [
        {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          handoff: { title: 'Run 1' },
          seq: 1,
          status: 'completed',
          topicId: 'topic-1',
        },
      ];

      const comments = [
        {
          authorAgentId: null,
          authorUserId: 'user_bob',
          content: 'User comment',
          createdAt: new Date('2024-01-02T00:00:00Z'),
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(topics);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue(comments);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      // Mock model methods to return agent and user data
      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        { avatar: 'https://example.com/agent.png', id: 'agt_assignee', title: 'My Agent' },
      ]);
      vi.mocked(UserModel.findByIds).mockResolvedValue([
        { avatar: 'https://example.com/bob.png', fullName: 'Bob', id: 'user_bob' } as any,
      ]);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      // Topic should have agent author
      const topicActivity = result?.activities?.find((a) => a.type === 'topic');
      expect(topicActivity?.author).toEqual({
        avatar: 'https://example.com/agent.png',
        id: 'agt_assignee',
        name: 'My Agent',
        type: 'agent',
      });

      // Comment should have user author
      const commentActivity = result?.activities?.find((a) => a.type === 'comment');
      expect(commentActivity?.author).toEqual({
        avatar: 'https://example.com/bob.png',
        id: 'user_bob',
        name: 'Bob',
        type: 'user',
      });
    });

    it('should include topic count when topics exist', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const topics = [
        { createdAt: new Date(), handoff: null, seq: 1, status: 'completed', topicId: 'topic-1' },
        { createdAt: new Date(), handoff: null, seq: 2, status: 'completed', topicId: 'topic-2' },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(topics);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.topicCount).toBe(2);
    });

    it('should include descendant task topics in parent activities with source task context', async () => {
      const task = {
        assigneeAgentId: 'agt_parent',
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_parent',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Parent task',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const descendants = [
        {
          assigneeAgentId: 'agt_child',
          automationMode: null,
          heartbeatInterval: null,
          id: 'task_child',
          identifier: 'TASK-2',
          name: 'Child task',
          parentTaskId: 'task_parent',
          priority: 'normal',
          schedulePattern: null,
          scheduleTimezone: null,
          seq: 2,
          sortOrder: 0,
          status: 'running',
        },
      ];

      const directTopics = [
        {
          agentId: null,
          completedAt: null,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          handoff: { title: 'Parent run' },
          metadata: null,
          operationId: 'op-parent',
          seq: 1,
          status: 'completed',
          title: null,
          topicId: 'topic-parent',
        },
      ];

      const descendantTopics = [
        {
          agentId: null,
          completedAt: null,
          createdAt: new Date('2024-01-02T00:00:00Z'),
          handoff: { title: 'Child run' },
          metadata: null,
          operationId: 'op-child',
          seq: 1,
          sourceTaskAssigneeAgentId: null,
          sourceTaskId: 'task_child',
          sourceTaskIdentifier: null,
          sourceTaskName: null,
          status: 'running',
          title: null,
          topicId: 'topic-child',
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue(descendants);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(directTopics);
      mockTaskTopicModel.findWithHandoffByTaskIds.mockResolvedValue(descendantTopics);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);
      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        { avatar: null, id: 'agt_parent', title: 'Parent Agent' },
        { avatar: null, id: 'agt_child', title: 'Child Agent' },
      ]);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(mockTaskTopicModel.findWithHandoffByTaskIds).toHaveBeenCalledWith(['task_child'], 300);

      const topicActivities = result?.activities?.filter((a) => a.type === 'topic') ?? [];
      expect(topicActivities).toHaveLength(2);

      const childTopic = topicActivities.find((a) => a.id === 'topic-child');
      expect(childTopic).toMatchObject({
        author: {
          id: 'agt_child',
          name: 'Child Agent',
          type: 'agent',
        },
        operationId: 'op-child',
        sourceTaskId: 'task_child',
        sourceTaskIdentifier: 'TASK-2',
        sourceTaskName: 'Child task',
        status: 'running',
        title: 'Child run',
      });
    });

    it('should propagate topic completedAt to the topic activity', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const topics = [
        {
          completedAt: new Date('2024-01-03T00:01:30Z'),
          createdAt: new Date('2024-01-03T00:00:00Z'),
          handoff: null,
          seq: 1,
          status: 'completed',
          topicId: 'topic-done',
        },
        {
          completedAt: null,
          createdAt: new Date('2024-01-03T00:05:00Z'),
          handoff: null,
          seq: 2,
          status: 'running',
          topicId: 'topic-running',
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(topics);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      const topicActivities = result?.activities?.filter((a) => a.type === 'topic') ?? [];
      const done = topicActivities.find((a) => a.id === 'topic-done');
      const running = topicActivities.find((a) => a.id === 'topic-running');
      expect(done?.completedAt).toBe('2024-01-03T00:01:30.000Z');
      expect(running?.completedAt).toBeUndefined();
    });

    it('should not include topicCount when no topics exist', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.topicCount).toBeUndefined();
    });

    it('should build workspace tree nodes from pinned documents', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const workspace = {
        nodeMap: {
          'doc-1': {
            charCount: 500,
            createdAt: '2024-01-01T00:00:00Z',
            fileType: 'markdown',
            sourceTaskId: 'task-2-id',
            sourceTaskIdentifier: 'TASK-2',
            title: 'Document One',
          },
          'doc-2': {
            charCount: 200,
            createdAt: '2024-01-02T00:00:00Z',
            fileType: 'text',
            sourceTaskId: 'task-1-id',
            sourceTaskIdentifier: null,
            title: 'Document Two',
          },
        },
        tree: [
          {
            children: [{ children: [], id: 'doc-2' }],
            id: 'doc-1',
          },
        ],
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue(workspace);
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.workspace).toHaveLength(1);
      const rootNode = result?.workspace?.[0];
      expect(rootNode?.documentId).toBe('doc-1');
      expect(rootNode?.title).toBe('Document One');
      expect(rootNode?.fileType).toBe('markdown');
      expect(rootNode?.size).toBe(500);
      expect(rootNode?.sourceTaskIdentifier).toBe('TASK-2');
      expect(rootNode?.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(rootNode?.children).toHaveLength(1);
      expect(rootNode?.children?.[0]?.documentId).toBe('doc-2');
      expect(rootNode?.children?.[0]?.title).toBe('Document Two');
    });

    it('should include heartbeat info when heartbeatTimeout or lastHeartbeatAt is set', async () => {
      const lastHeartbeatAt = new Date(Date.now() - 1000);
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        createdByUserId: 'user-1',
        description: null,
        error: null,
        heartbeatInterval: 30,
        heartbeatTimeout: 60,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'running',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.heartbeat).toEqual({
        interval: 30,
        lastAt: lastHeartbeatAt.toISOString(),
        timeout: 60,
      });
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it('should not include heartbeat when neither heartbeatTimeout nor lastHeartbeatAt is set', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.heartbeat).toBeUndefined();
    });

    it('auto-pause on heartbeat timeout notifies the task owner with 心跳超时', async () => {
      const ownerId = 'owner-1';
      const running = {
        assigneeAgentId: 'agt-1',
        createdByUserId: ownerId,
        currentTopicId: 'topic-stuck',
        heartbeatTimeout: 60,
        id: 'task_stuck',
        identifier: 'TASK-STUCK',
        lastHeartbeatAt: new Date('2024-01-01T12:00:00Z'),
        name: 'Stuck task',
        status: 'running',
      };
      const paused = { ...running, error: 'Heartbeat timeout', status: 'paused' };

      mockTaskModel.resolve.mockResolvedValueOnce(running).mockResolvedValueOnce(paused);
      mockTaskModel.updateStatus.mockResolvedValue(paused);
      mockTaskTopicModel.timeoutRunning.mockResolvedValue(undefined);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, 'member-2', 'ws-1');
      await service.getTaskDetail('TASK-STUCK');

      expect(mockTaskModel.updateStatus).toHaveBeenCalledWith('task_stuck', 'paused', {
        error: 'Heartbeat timeout',
      });
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '心跳超时',
          taskId: 'task_stuck',
          type: 'task_run_failed',
          userId: ownerId,
        }),
      );
    });

    it('should gracefully handle failing optional calls via catch', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      // Simulate optional calls failing
      mockTaskTopicModel.findWithHandoff.mockRejectedValue(new Error('DB error'));
      mockBriefModel.findByTaskId.mockRejectedValue(new Error('DB error'));
      mockTaskModel.getComments.mockRejectedValue(new Error('DB error'));
      mockTaskModel.getTreePinnedDocuments.mockRejectedValue(new Error('DB error'));
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      // Should not throw and return partial result
      expect(result).not.toBeNull();
      expect(result?.identifier).toBe('TASK-1');
      expect(result?.activities).toBeUndefined();
      expect(result?.workspace).toBeUndefined();
    });

    it('should use topic handoff title with fallback to Untitled', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      const topics = [
        {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          handoff: null,
          seq: 1,
          status: 'completed',
          topicId: 'topic-1',
        },
        {
          createdAt: new Date('2024-01-02T00:00:00Z'),
          handoff: { title: 'Named Topic' },
          seq: 2,
          status: 'completed',
          topicId: 'topic-2',
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(topics);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      const topicActivities = result?.activities?.filter((a) => a.type === 'topic');
      expect(topicActivities?.[0].title).toBe('Untitled');
      expect(topicActivities?.[1].title).toBe('Named Topic');
    });

    it('should place activities without time at the end of sorted list', async () => {
      const task = {
        assigneeAgentId: null,
        assigneeUserId: null,
        createdAt: null,
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Task 1',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      // A topic without a createdAt should sort to the end (time-less items last).
      const topics = [
        {
          createdAt: null,
          handoff: { title: 'No Time' },
          seq: 1,
          status: 'completed',
          topicId: 'topic-1',
        },
      ];

      const comments = [
        {
          authorAgentId: null,
          content: 'With time',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        },
      ];

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue(topics);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue(comments);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.activities).toHaveLength(2);
      // comment with time should come first, topic without time at end
      expect(result?.activities?.[0].type).toBe('comment');
      expect(result?.activities?.[1].type).toBe('topic');
    });

    it('exposes createdByAgentId and overlays inbox authors via catalog identity', async () => {
      const task = {
        assigneeAgentId: 'agt_local',
        assigneeUserId: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        createdByAgentId: 'agt_inbox',
        createdByUserId: 'user-1',
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Inbox created',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);
      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        {
          avatar: DEFAULT_INBOX_AVATAR,
          backgroundColor: null,
          id: 'agt_inbox',
          isInbox: true,
          slug: INBOX_SESSION_ID,
          title: DEFAULT_INBOX_TITLE,
        },
        {
          avatar: '🤖',
          backgroundColor: '#000',
          id: 'agt_local',
          isInbox: false,
          slug: 'researcher',
          title: 'Local assistant',
        },
      ]);
      vi.spyOn(PlatformDefaultInboxService.prototype, 'getPublishedIdentity').mockResolvedValue({
        avatar: '/f/pba_published',
        backgroundColor: '#123456',
        title: 'Published assistant',
      });

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(result?.createdByAgentId).toBe('agt_inbox');
      expect(result?.createdByUserId).toBe('user-1');

      const created = result?.activities?.find((a) => a.type === 'created');
      expect(created?.author).toEqual({
        avatar: '/f/pba_published',
        id: 'agt_inbox',
        isInbox: true,
        name: 'Published assistant',
        type: 'agent',
      });
    });

    it('keeps a non-inbox agent author title and avatar unchanged', async () => {
      const task = {
        assigneeAgentId: 'agt_local',
        assigneeUserId: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        createdByAgentId: 'agt_local',
        createdByUserId: 'user-1',
        description: null,
        error: null,
        heartbeatInterval: null,
        heartbeatTimeout: null,
        id: 'task_001',
        identifier: 'TASK-1',
        instruction: null,
        lastHeartbeatAt: null,
        name: 'Local created',
        parentTaskId: null,
        priority: 'normal',
        status: 'todo',
        totalTopics: 0,
      };

      mockTaskModel.resolve.mockResolvedValue(task);
      mockTaskModel.findAllDescendants.mockResolvedValue([]);
      mockTaskModel.getDependencies.mockResolvedValue([]);
      mockTaskTopicModel.findWithHandoff.mockResolvedValue([]);
      mockBriefModel.findByTaskId.mockResolvedValue([]);
      mockTaskModel.getComments.mockResolvedValue([]);
      mockTaskModel.getTreePinnedDocuments.mockResolvedValue({ nodeMap: {}, tree: [] });
      mockTaskModel.findByIds.mockResolvedValue([]);
      mockTaskModel.getCheckpointConfig.mockReturnValue({});
      mockTaskModel.getVerifyConfig.mockReturnValue(undefined);
      mockAgentModel.getAgentAvatarsByIds.mockResolvedValue([
        {
          avatar: '🤖',
          backgroundColor: '#000',
          id: 'agt_local',
          isInbox: false,
          slug: 'researcher',
          title: 'Local assistant',
        },
      ]);
      const getPublishedIdentity = vi.spyOn(
        PlatformDefaultInboxService.prototype,
        'getPublishedIdentity',
      );

      const service = new TaskService(db, userId);
      const result = await service.getTaskDetail('TASK-1');

      expect(getPublishedIdentity).not.toHaveBeenCalled();
      expect(result?.activities?.find((a) => a.type === 'created')?.author).toEqual({
        avatar: '🤖',
        id: 'agt_local',
        name: 'Local assistant',
        type: 'agent',
      });
    });
  });

  describe('updateStatus / scheduleStartedAt', () => {
    const baseTask = (overrides: Partial<Record<string, unknown>> = {}) => ({
      automationMode: 'schedule',
      context: {},
      id: 'task-1',
      identifier: 'T-1',
      parentTaskId: null,
      status: 'backlog',
      ...overrides,
    });

    it('stamps scheduleStartedAt when a user starts a schedule (backlog → scheduled)', async () => {
      const prev = baseTask({ status: 'backlog', automationMode: 'schedule' });
      const next = baseTask({ status: 'scheduled', automationMode: 'schedule' });
      mockTaskModel.resolve.mockResolvedValue(prev);
      mockTaskModel.updateStatus.mockResolvedValue(next);

      const service = new TaskService(db, userId);
      await service.updateStatus({ id: 'T-1', status: 'scheduled' as any });

      expect(mockTaskModel.updateContext).toHaveBeenCalledTimes(1);
      expect(mockTaskModel.updateContext).toHaveBeenCalledWith('task-1', {
        scheduler: { scheduleStartedAt: expect.any(String) },
      });
      const stamped = (mockTaskModel.updateContext.mock.calls[0]![1] as any).scheduler
        .scheduleStartedAt as string;
      expect(() => new Date(stamped).toISOString()).not.toThrow();
    });

    it('does NOT stamp on the cron loop natural cycle (running → scheduled)', async () => {
      // taskLifecycle parks finished ticks at 'scheduled' via taskModel.updateStatus,
      // bypassing the service layer; the only way it reaches the service is when a
      // user explicitly transitions. Either way, prev='running' must NOT reset the
      // counter window — otherwise every successful tick would zero out the cap.
      const prev = baseTask({ status: 'running', automationMode: 'schedule' });
      const next = baseTask({ status: 'scheduled', automationMode: 'schedule' });
      mockTaskModel.resolve.mockResolvedValue(prev);
      mockTaskModel.updateStatus.mockResolvedValue(next);
      mockTaskTopicModel.findByTaskId.mockResolvedValue([]);

      const service = new TaskService(db, userId);
      await service.updateStatus({ id: 'T-1', status: 'scheduled' as any });

      expect(mockTaskModel.updateContext).not.toHaveBeenCalled();
    });

    it('does NOT stamp for heartbeat-mode tasks', async () => {
      const prev = baseTask({ status: 'backlog', automationMode: 'heartbeat' });
      const next = baseTask({ status: 'scheduled', automationMode: 'heartbeat' });
      mockTaskModel.resolve.mockResolvedValue(prev);
      mockTaskModel.updateStatus.mockResolvedValue(next);

      const service = new TaskService(db, userId);
      await service.updateStatus({ id: 'T-1', status: 'scheduled' as any });

      expect(mockTaskModel.updateContext).not.toHaveBeenCalled();
    });

    it('does NOT stamp when the new status is not scheduled', async () => {
      const prev = baseTask({ status: 'backlog' });
      const next = baseTask({ status: 'paused' });
      mockTaskModel.resolve.mockResolvedValue(prev);
      mockTaskModel.updateStatus.mockResolvedValue(next);

      const service = new TaskService(db, userId);
      await service.updateStatus({ id: 'T-1', status: 'paused' as any });

      expect(mockTaskModel.updateContext).not.toHaveBeenCalled();
    });

    it('stamps on user-initiated restart (paused → scheduled)', async () => {
      const prev = baseTask({ status: 'paused', automationMode: 'schedule' });
      const next = baseTask({ status: 'scheduled', automationMode: 'schedule' });
      mockTaskModel.resolve.mockResolvedValue(prev);
      mockTaskModel.updateStatus.mockResolvedValue(next);

      const service = new TaskService(db, userId);
      await service.updateStatus({ id: 'T-1', status: 'scheduled' as any });

      expect(mockTaskModel.updateContext).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateStatus / task_completed notify', () => {
    const completedTask = (overrides: Record<string, unknown> = {}) => ({
      assigneeAgentId: 'agt-1',
      createdByAgentId: null,
      createdByUserId: 'owner-1',
      currentTopicId: 'topic-1',
      id: 'task-1',
      identifier: 'T-1',
      instruction: 'write the digest',
      name: 'Daily report',
      parentTaskId: null,
      status: 'paused',
      ...overrides,
    });

    it('notifies the owner when the owner completes an assigned task', async () => {
      const prev = completedTask({ assigneeAgentId: 'agt-1' });
      mockTaskModel.resolve.mockResolvedValue(prev);
      mockTaskModel.updateStatus.mockResolvedValue({ ...prev, status: 'completed' });

      const service = new TaskService(db, 'owner-1');
      await service.updateStatus({ id: 'task-1', status: 'completed' as any });

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task_completed',
          userId: 'owner-1',
        }),
      );
    });

    it('notifies createdByUserId when a workspace member completes a public assigned task', async () => {
      const prev = completedTask({
        assigneeAgentId: 'agt-1',
        createdByUserId: 'owner-1',
      });
      mockTaskModel.resolve.mockResolvedValue(prev);
      mockTaskModel.updateStatus.mockResolvedValue({ ...prev, status: 'completed' });

      const service = new TaskService(db, 'member-2', 'ws-1');
      await service.updateStatus({ id: 'task-1', status: 'completed' as any });

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task_completed',
          userId: 'owner-1',
        }),
      );
      expect(mockNotify.mock.calls[0][0].userId).not.toBe('member-2');
    });

    it('does not notify on unassigned UI complete', async () => {
      const prev = completedTask({
        assigneeAgentId: null,
        createdByAgentId: null,
      });
      mockTaskModel.resolve.mockResolvedValue(prev);
      mockTaskModel.updateStatus.mockResolvedValue({ ...prev, status: 'completed' });

      const service = new TaskService(db, 'owner-1');
      await service.updateStatus({ id: 'task-1', status: 'completed' as any });

      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  describe('agent ↔ task visibility compat', () => {
    beforeEach(() => {
      mockTaskModel.create.mockImplementation(async (data: any) => ({
        ...data,
        id: 'task_test',
        identifier: 'T-1',
        seq: 1,
      }));
    });

    it('rejects creating a public task with a private agent', async () => {
      mockAgentModel.existsById.mockResolvedValue(true);
      mockAgentModel.getAgentSnapshotForTaskCreate.mockResolvedValue({
        snapshot: null,
        visibility: 'private',
      });

      const service = new TaskService(db, userId, 'ws-1');
      await expect(
        service.createTask({
          assigneeAgentId: 'agent-private',
          instruction: 'do something',
          visibility: 'public',
        }),
      ).rejects.toThrow(/public task cannot be assigned to a private agent/i);
      expect(mockTaskModel.create).not.toHaveBeenCalled();
    });

    it('allows creating a private task with a public agent', async () => {
      mockAgentModel.existsById.mockResolvedValue(true);
      mockAgentModel.getAgentSnapshotForTaskCreate.mockResolvedValue({
        snapshot: null,
        visibility: 'public',
      });

      const service = new TaskService(db, userId, 'ws-1');
      await service.createTask({
        assigneeAgentId: 'agent-public',
        instruction: 'do something private',
        visibility: 'private',
      });
      expect(mockTaskModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private' }),
      );
    });

    it('infers private visibility from a private agent when caller omits it', async () => {
      mockAgentModel.existsById.mockResolvedValue(true);
      mockAgentModel.getAgentSnapshotForTaskCreate.mockResolvedValue({
        snapshot: null,
        visibility: 'private',
      });

      const service = new TaskService(db, userId, 'ws-1');
      await service.createTask({
        assigneeAgentId: 'agent-private',
        instruction: 'do something',
      });
      expect(mockTaskModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private' }),
      );
    });

    it('assertAgentVisibilityCompat allows null agent (no assignee)', () => {
      const service = new TaskService(db, userId, 'ws-1');
      expect(() => service.assertAgentVisibilityCompat('public', null)).not.toThrow();
    });

    it('assertAgentVisibilityCompat allows private task + private agent', () => {
      const service = new TaskService(db, userId, 'ws-1');
      expect(() => service.assertAgentVisibilityCompat('private', 'private')).not.toThrow();
    });
  });

  describe('parent ↔ child visibility compat', () => {
    beforeEach(() => {
      mockTaskModel.create.mockImplementation(async (data: any) => ({
        ...data,
        id: 'task_test',
        identifier: 'T-2',
        seq: 2,
      }));
    });

    it('rejects creating a public subtask under a private parent', async () => {
      mockTaskModel.resolve.mockResolvedValue({
        id: 'parent_id',
        identifier: 'T-1',
        visibility: 'private',
      });

      const service = new TaskService(db, userId, 'ws-1');
      await expect(
        service.createTask({
          instruction: 'leak attempt',
          parentTaskId: 'T-1',
          visibility: 'public',
        }),
      ).rejects.toThrow(/subtask cannot be more public than its parent/i);
      expect(mockTaskModel.create).not.toHaveBeenCalled();
    });

    it('allows a private subtask under a public parent', async () => {
      mockTaskModel.resolve.mockResolvedValue({
        id: 'parent_id',
        identifier: 'T-1',
        visibility: 'public',
      });

      const service = new TaskService(db, userId, 'ws-1');
      await service.createTask({
        instruction: 'narrower scope',
        parentTaskId: 'T-1',
        visibility: 'private',
      });
      expect(mockTaskModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private' }),
      );
    });

    it('assertParentVisibilityCompat allows no parent', () => {
      const service = new TaskService(db, userId, 'ws-1');
      expect(() => service.assertParentVisibilityCompat('public', undefined)).not.toThrow();
    });

    it('assertParentVisibilityCompat allows public child under public parent', () => {
      const service = new TaskService(db, userId, 'ws-1');
      expect(() => service.assertParentVisibilityCompat('public', 'public')).not.toThrow();
    });
  });
});
