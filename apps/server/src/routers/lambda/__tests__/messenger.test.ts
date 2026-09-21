// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { messengerRouter } from '../messenger';

const {
  mockConsumeLinkToken,
  mockFindByPlatform,
  mockFindByPlatformUser,
  mockGetEnabledMessengerPlatforms,
  mockGetMessengerDingTalkConfig,
  mockGetMessengerDiscordConfig,
  mockGetMessengerSlackConfig,
  mockGetMessengerTelegramConfig,
  mockGetServerDB,
  mockGetServerFeatureFlagsStateFromRuntimeConfig,
  mockHasAnyPermission,
  mockInitWithEnvKey,
  mockListSerializedPlatforms,
  mockListUserWorkspaces,
  mockListMessengerBindableAgents,
  mockListByInstallerUserId,
  mockMarkRevoked,
  mockNotifyTelegramLinkSuccess,
  mockPeekConsumedLinkToken,
  mockPeekLinkToken,
  mockResolveMessengerPlatformBindings,
  mockSlackAuthTest,
  mockTopicFindById,
  mockUpsertForPlatform,
  mockMirrorWebTurnToDingTalk,
} = vi.hoisted(() => ({
  mockConsumeLinkToken: vi.fn(),
  mockFindByPlatform: vi.fn(),
  mockFindByPlatformUser: vi.fn(),
  mockGetEnabledMessengerPlatforms: vi.fn().mockResolvedValue([]),
  mockGetMessengerDingTalkConfig: vi.fn().mockResolvedValue(null),
  mockGetMessengerDiscordConfig: vi.fn().mockResolvedValue(null),
  mockGetMessengerSlackConfig: vi.fn().mockResolvedValue(null),
  mockGetMessengerTelegramConfig: vi.fn().mockResolvedValue(null),
  mockGetServerDB: vi.fn(),
  mockGetServerFeatureFlagsStateFromRuntimeConfig: vi.fn(),
  mockHasAnyPermission: vi.fn(),
  mockInitWithEnvKey: vi.fn(),
  mockListSerializedPlatforms: vi.fn().mockReturnValue([]),
  mockListUserWorkspaces: vi.fn(),
  mockListMessengerBindableAgents: vi.fn(),
  mockListByInstallerUserId: vi.fn(),
  mockMarkRevoked: vi.fn(),
  mockMirrorWebTurnToDingTalk: vi.fn(),
  mockNotifyTelegramLinkSuccess: vi.fn(),
  mockPeekConsumedLinkToken: vi.fn(),
  mockPeekLinkToken: vi.fn(),
  mockResolveMessengerPlatformBindings: vi.fn().mockResolvedValue({}),
  mockSlackAuthTest: vi.fn(),
  mockTopicFindById: vi.fn(),
  mockUpsertForPlatform: vi.fn(),
}));

vi.mock('@/config/messenger', () => ({
  getEnabledMessengerPlatforms: mockGetEnabledMessengerPlatforms,
  getMessengerDingTalkConfig: mockGetMessengerDingTalkConfig,
  getMessengerDiscordConfig: mockGetMessengerDiscordConfig,
  getMessengerSlackConfig: mockGetMessengerSlackConfig,
  getMessengerTelegramConfig: mockGetMessengerTelegramConfig,
  isMessengerPlatformEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = (...args: unknown[]) => mockTopicFindById(...args);
  },
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/mirrorWebTurn', () => ({
  mirrorWebTurnToDingTalk: (...args: unknown[]) => mockMirrorWebTurnToDingTalk(...args),
}));

vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: class {
    listUserWorkspaces = (...args: any[]) => mockListUserWorkspaces(...args);
  },
}));

vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = (...args: any[]) => mockHasAnyPermission(...args);
  },
}));

vi.mock('@/database/models/messengerInstallation', () => ({
  MessengerInstallationModel: {
    findById: vi.fn(),
    listByInstallerUserId: mockListByInstallerUserId,
    markRevoked: mockMarkRevoked,
  },
}));

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkConflictError: class MessengerAccountLinkConflictError extends Error {},
  MessengerAccountLinkModel: class MessengerAccountLinkModel {
    static findByPlatformUser = mockFindByPlatformUser;

    findByPlatform = mockFindByPlatform;
    upsertForPlatform = mockUpsertForPlatform;
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
}));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mockGetServerFeatureFlagsStateFromRuntimeConfig,
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: class AgentService {
    listMessengerBindableAgents = (...args: any[]) => mockListMessengerBindableAgents(...args);
  },
}));

vi.mock('@/server/services/messenger', () => ({
  consumeLinkToken: mockConsumeLinkToken,
  MessengerDingTalkBinder: vi.fn(),
  MessengerDiscordBinder: vi.fn(),
  messengerPlatformRegistry: {
    listSerializedPlatforms: mockListSerializedPlatforms,
  },
  MessengerSlackBinder: vi.fn(),
  MessengerTelegramBinder: vi.fn().mockImplementation(() => ({
    notifyLinkSuccess: mockNotifyTelegramLinkSuccess,
  })),
  peekConsumedLinkToken: mockPeekConsumedLinkToken,
  peekLinkToken: mockPeekLinkToken,
  resolveMessengerPlatformBindings: mockResolveMessengerPlatformBindings,
}));

vi.mock('@/server/services/bot/platforms/slack/api', () => ({
  SLACK_API_BASE: 'https://slack.com/api',
  SlackApi: vi.fn().mockImplementation(() => ({
    authTest: mockSlackAuthTest,
  })),
}));

const createCaller = createCallerFactory(messengerRouter);

const buildSlackInstall = () => ({
  accountId: null,
  applicationId: 'A_LOBE',
  createdAt: new Date('2026-05-06T00:00:00.000Z'),
  credentials: { botToken: 'xoxb-valid' },
  id: 'install-1',
  installedByPlatformUserId: 'U_INSTALLER',
  installedByUserId: 'user-1',
  metadata: { scope: 'chat:write', tenantName: 'LobeHub' },
  platform: 'slack',
  revokedAt: null,
  tenantId: 'T_LOBE',
  tokenExpiresAt: null,
  updatedAt: new Date('2026-05-06T00:00:00.000Z'),
});

const createSelectBuilder = <T>(result: T) => {
  const builder = {
    from: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue(result),
    where: vi.fn(() => builder),
  };

  return builder;
};

const createAgentListBuilder = <T>(result: T) => {
  const builder = {
    from: vi.fn(() => builder),
    orderBy: vi.fn().mockResolvedValue(result),
    where: vi.fn(() => builder),
  };

  return builder;
};

describe('messengerRouter.listMyInstallations', () => {
  const serverDB = { kind: 'server-db' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue(serverDB);
    mockInitWithEnvKey.mockResolvedValue(undefined);
  });

  it('keeps active Slack installations visible', async () => {
    mockListByInstallerUserId.mockResolvedValue([buildSlackInstall()]);
    mockSlackAuthTest.mockResolvedValue({ ok: true });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.listMyInstallations();

    expect(result).toEqual([
      expect.objectContaining({
        applicationId: 'A_LOBE',
        id: 'install-1',
        platform: 'slack',
        scope: 'chat:write',
        tenantId: 'T_LOBE',
        tenantName: 'LobeHub',
      }),
    ]);
    expect(mockMarkRevoked).not.toHaveBeenCalled();
  });

  it('revokes and hides Slack installs when auth.test reports token revocation', async () => {
    mockListByInstallerUserId.mockResolvedValue([buildSlackInstall()]);
    mockSlackAuthTest.mockRejectedValue(new Error('Slack API auth.test failed: invalid_auth'));

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.listMyInstallations();

    expect(result).toEqual([]);
    expect(mockMarkRevoked).toHaveBeenCalledWith(serverDB, 'install-1');
  });

  it('does not revoke installs on transient Slack verification failures', async () => {
    mockListByInstallerUserId.mockResolvedValue([buildSlackInstall()]);
    mockSlackAuthTest.mockRejectedValue(new Error('network timeout'));

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.listMyInstallations();

    expect(result).toHaveLength(1);
    expect(mockMarkRevoked).not.toHaveBeenCalled();
  });
});

describe('messengerRouter.peekLinkToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns status:active with payload when the token is live', async () => {
    const selectBuilder = createSelectBuilder([]);
    const serverDB = { select: vi.fn(() => selectBuilder) };
    mockGetServerDB.mockResolvedValue(serverDB);
    mockPeekLinkToken.mockResolvedValue({
      platform: 'slack',
      platformUserId: 'U_ALICE',
      platformUsername: 'alice',
      tenantId: 'T_LOBE',
      tenantName: 'LobeHub',
    });
    mockFindByPlatformUser.mockResolvedValue(undefined);

    const caller = createCaller(await createContextInner({}));
    const result = await caller.peekLinkToken({ randomId: 'rand-1234' });

    expect(result).toMatchObject({
      linkedToEmail: null,
      platform: 'slack',
      platformUserId: 'U_ALICE',
      status: 'active',
      tenantId: 'T_LOBE',
      tenantName: 'LobeHub',
    });
    expect(mockPeekConsumedLinkToken).not.toHaveBeenCalled();
  });

  it('returns status:consumed when the token was already burned by confirmLink', async () => {
    mockGetServerDB.mockResolvedValue({ kind: 'server-db' });
    mockPeekLinkToken.mockResolvedValue(null);
    mockPeekConsumedLinkToken.mockResolvedValue({
      consumedAt: 1_700_000_000_000,
      platform: 'slack',
      tenantId: 'T_LOBE',
    });

    const caller = createCaller(await createContextInner({}));
    const result = await caller.peekLinkToken({ randomId: 'rand-1234' });

    expect(result).toEqual({
      platform: 'slack',
      status: 'consumed',
      tenantId: 'T_LOBE',
    });
  });

  it('returns status:expired without throwing when neither token nor consumed marker exists', async () => {
    mockGetServerDB.mockResolvedValue({ kind: 'server-db' });
    mockPeekLinkToken.mockResolvedValue(null);
    mockPeekConsumedLinkToken.mockResolvedValue(null);

    const caller = createCaller(await createContextInner({}));
    const result = await caller.peekLinkToken({ randomId: 'rand-1234' });

    expect(result).toEqual({ status: 'expired' });
  });
});

describe('messengerRouter.confirmLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: true });
    mockInitWithEnvKey.mockResolvedValue(undefined);
  });

  it('blocks linking a different Telegram account when the user already has one', async () => {
    const selectBuilder = createSelectBuilder([{ id: 'agent-1', title: 'Agent 1' }]);
    const serverDB = { select: vi.fn(() => selectBuilder) };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockPeekLinkToken.mockResolvedValue({
      platform: 'telegram',
      platformUserId: 'tg-new',
      tenantId: '',
    });
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue({
      platform: 'telegram',
      platformUserId: 'tg-old',
      tenantId: '',
    });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.confirmLink({ initialAgentId: 'agent-1', randomId: 'rand-1234' }),
    ).rejects.toMatchObject({
      message: 'verify.error.unlinkBeforeRelink',
    });

    expect(mockConsumeLinkToken).not.toHaveBeenCalled();
    expect(mockUpsertForPlatform).not.toHaveBeenCalled();
    expect(serverDB.select).not.toHaveBeenCalled();
  });

  it('blocks linking a different Discord account when the user already has one', async () => {
    const selectBuilder = createSelectBuilder([{ id: 'agent-1', title: 'Agent 1' }]);
    const serverDB = { select: vi.fn(() => selectBuilder) };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockPeekLinkToken.mockResolvedValue({
      platform: 'discord',
      platformUserId: 'dc-new',
      tenantId: '',
    });
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue({
      platform: 'discord',
      platformUserId: 'dc-old',
      tenantId: '',
    });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.confirmLink({ initialAgentId: 'agent-1', randomId: 'rand-1234' }),
    ).rejects.toMatchObject({
      message: 'verify.error.unlinkBeforeRelink',
    });

    expect(mockConsumeLinkToken).not.toHaveBeenCalled();
    expect(mockUpsertForPlatform).not.toHaveBeenCalled();
    expect(serverDB.select).not.toHaveBeenCalled();
  });

  it('blocks linking a different Slack account in the same workspace when the user already has one', async () => {
    const selectBuilder = createSelectBuilder([{ id: 'agent-1', title: 'Agent 1' }]);
    const serverDB = { select: vi.fn(() => selectBuilder) };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockPeekLinkToken.mockResolvedValue({
      platform: 'slack',
      platformUserId: 'U_NEW',
      tenantId: 'T_LOBE',
    });
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue({
      platform: 'slack',
      platformUserId: 'U_OLD',
      tenantId: 'T_LOBE',
    });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.confirmLink({ initialAgentId: 'agent-1', randomId: 'rand-1234' }),
    ).rejects.toMatchObject({
      message: 'verify.error.unlinkBeforeRelink',
    });

    expect(mockConsumeLinkToken).not.toHaveBeenCalled();
    expect(mockUpsertForPlatform).not.toHaveBeenCalled();
    expect(serverDB.select).not.toHaveBeenCalled();
  });

  it('allows re-confirming the same Telegram account', async () => {
    const selectBuilder = createSelectBuilder([
      { id: 'agent-1', title: 'Agent 1', userId: 'user-1', workspaceId: null },
    ]);
    const serverDB = { select: vi.fn(() => selectBuilder) };
    const linkPayload = {
      platform: 'telegram',
      platformUserId: 'tg-same',
      platformUsername: '@same',
      tenantId: '',
    };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockPeekLinkToken.mockResolvedValue(linkPayload);
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue({
      platform: 'telegram',
      platformUserId: 'tg-same',
      tenantId: '',
    });
    mockConsumeLinkToken.mockResolvedValue(linkPayload);
    mockUpsertForPlatform.mockResolvedValue({ id: 'link-1' });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.confirmLink({ initialAgentId: 'agent-1', randomId: 'rand-1234' });

    expect(result).toEqual({ data: { id: 'link-1' }, success: true });
    expect(mockConsumeLinkToken).toHaveBeenCalledWith('rand-1234');
    expect(mockUpsertForPlatform).toHaveBeenCalledWith({
      activeAgentId: 'agent-1',
      platform: 'telegram',
      platformUserId: 'tg-same',
      platformUsername: '@same',
      tenantId: '',
      workspaceId: null,
    });
  });

  it('blocks binding a workspace agent when workspace feature is disabled', async () => {
    const selectBuilder = createSelectBuilder([
      {
        id: 'agent-1',
        title: 'Workspace Agent',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
    ]);
    const serverDB = { select: vi.fn(() => selectBuilder) };
    const linkPayload = {
      platform: 'telegram',
      platformUserId: 'tg-same',
      platformUsername: '@same',
      tenantId: '',
    };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: false });
    mockPeekLinkToken.mockResolvedValue(linkPayload);
    mockFindByPlatformUser.mockResolvedValue(undefined);
    mockFindByPlatform.mockResolvedValue(undefined);
    mockListUserWorkspaces.mockResolvedValue([{ id: 'workspace-1', name: 'Workspace 1' }]);
    mockHasAnyPermission.mockResolvedValue(true);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.confirmLink({ initialAgentId: 'agent-1', randomId: 'rand-1234' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Workspace feature is not enabled for this user',
    });

    expect(mockConsumeLinkToken).not.toHaveBeenCalled();
    expect(mockUpsertForPlatform).not.toHaveBeenCalled();
  });
});

describe('messengerRouter.listBindingScopes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue({});
    mockListMessengerBindableAgents.mockResolvedValue([]);
  });

  it('returns no workspace scopes when workspace feature is disabled', async () => {
    mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: false });
    mockListUserWorkspaces.mockResolvedValue([{ id: 'workspace-1', name: 'Workspace 1' }]);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.listBindingScopes();

    expect(result).toEqual([]);
    expect(mockListUserWorkspaces).not.toHaveBeenCalled();
  });
});

describe('messengerRouter.listAgentsForBinding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue({});
  });

  it('rejects workspace-scoped agent listing when workspace feature is disabled', async () => {
    const selectBuilder = createAgentListBuilder([]);
    const serverDB = { select: vi.fn(() => selectBuilder) };

    mockGetServerDB.mockResolvedValue(serverDB);
    mockGetServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({ enableWorkspace: false });
    mockListUserWorkspaces.mockResolvedValue([{ id: 'workspace-1', name: 'Workspace 1' }]);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(caller.listAgentsForBinding({ workspaceId: 'workspace-1' })).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
        message: 'Workspace feature is not enabled for this user',
      },
    );

    expect(mockListUserWorkspaces).not.toHaveBeenCalled();
  });

  it('uses the branding-aware AgentService projection for the web picker', async () => {
    mockListMessengerBindableAgents.mockResolvedValue([
      { id: 'inbox-agent', isInbox: true, title: 'AIHub AI' },
    ]);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.listAgentsForBinding();

    expect(result).toEqual([{ id: 'inbox-agent', isInbox: true, title: 'AIHub AI' }]);
    expect(mockListMessengerBindableAgents).toHaveBeenCalledOnce();
  });
});

describe('messengerRouter.availablePlatforms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue({ kind: 'server-db' });
    mockGetEnabledMessengerPlatforms.mockResolvedValue(['dingtalk']);
    mockListSerializedPlatforms.mockReturnValue([
      { connectionMode: 'websocket', id: 'dingtalk', name: '钉钉' },
    ]);
    mockGetMessengerDingTalkConfig.mockResolvedValue({
      chatEnabled: true,
      clientId: 'app_key',
      pushEnabled: false,
      robotCode: 'robot_1',
    });
    mockResolveMessengerPlatformBindings.mockResolvedValue({
      dingtalk: { linked: false, platformUsername: null },
    });
  });

  it('returns capabilities and the robot display name as botUsername for dingtalk', async () => {
    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.availablePlatforms();

    expect(result).toEqual([
      expect.objectContaining({
        appId: 'app_key',
        binding: { linked: false, platformUsername: null },
        botUsername: 'AI 助手',
        capabilities: { chat: true, push: false },
        connectionMode: 'websocket',
        enabled: true,
        id: 'dingtalk',
        name: '钉钉',
        platform: 'dingtalk',
      }),
    ]);
    expect(mockResolveMessengerPlatformBindings).toHaveBeenCalledWith(
      { kind: 'server-db' },
      'user-1',
      ['dingtalk'],
    );
  });

  it('prefers connector robotDisplayName for dingtalk botUsername', async () => {
    mockGetMessengerDingTalkConfig.mockResolvedValue({
      chatEnabled: true,
      clientId: 'app_key',
      pushEnabled: false,
      robotCode: 'robot_1',
      robotDisplayName: '审批助手',
    });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.availablePlatforms();

    expect(result[0]).toEqual(expect.objectContaining({ botUsername: '审批助手' }));
  });

  it('forwards the caller binding when the user is mapped', async () => {
    mockResolveMessengerPlatformBindings.mockResolvedValue({
      dingtalk: { linked: true, platformUsername: 'staff_1' },
    });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.availablePlatforms();

    expect(result[0].binding).toEqual({ linked: true, platformUsername: 'staff_1' });
  });
});

describe('messengerRouter.mirrorWebTurn', () => {
  const createTopicSelectDb = (rows: Array<{ id: string; workspaceId: string | null }>) => {
    const selectBuilder = createSelectBuilder(rows);
    return { select: vi.fn(() => selectBuilder), selectBuilder };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMirrorWebTurnToDingTalk.mockResolvedValue(undefined);
  });

  it('rejects with NOT_FOUND when the topic belongs to another user', async () => {
    mockGetServerDB.mockResolvedValue(createTopicSelectDb([]));

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.mirrorWebTurn({
        assistantMessageId: 'a1',
        topicId: 'tpc-other',
        userMessageId: 'u1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockMirrorWebTurnToDingTalk).not.toHaveBeenCalled();
    expect(mockTopicFindById).not.toHaveBeenCalled();
  });

  it('calls the service when the topic belongs to the caller', async () => {
    mockGetServerDB.mockResolvedValue(createTopicSelectDb([{ id: 'tpc-1', workspaceId: null }]));

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.mirrorWebTurn({
      assistantMessage: 'asst text',
      assistantMessageId: 'a1',
      topicId: 'tpc-1',
      userMessage: 'user text',
      userMessageId: 'u1',
    });

    expect(result).toEqual({ success: true });
    expect(mockMirrorWebTurnToDingTalk).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessage: 'asst text',
        assistantMessageId: 'a1',
        topicId: 'tpc-1',
        userId: 'user-1',
        userMessage: 'user text',
        userMessageId: 'u1',
        workspaceId: undefined,
      }),
    );
    expect(mockTopicFindById).not.toHaveBeenCalled();
  });

  it('mirrors a workspace topic owned by the caller and forwards workspaceId', async () => {
    mockGetServerDB.mockResolvedValue(createTopicSelectDb([{ id: 'tpc-ws', workspaceId: 'ws-1' }]));

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.mirrorWebTurn({
      assistantMessageId: 'a1',
      topicId: 'tpc-ws',
      userMessageId: 'u1',
    });

    expect(result).toEqual({ success: true });
    expect(mockMirrorWebTurnToDingTalk).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageId: 'a1',
        topicId: 'tpc-ws',
        userId: 'user-1',
        userMessageId: 'u1',
        workspaceId: 'ws-1',
      }),
    );
    expect(mockTopicFindById).not.toHaveBeenCalled();
  });
});
