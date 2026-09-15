// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_PERMISSIONS } from '@/const/platform/permissions';

import { recordAuditorFileOpen, resolveFileAccess } from './fileAccess';

const mocks = vi.hoisted(() => ({
  appendAuditAccessLog: vi.fn(),
  getMember: vi.fn(),
  getOrCreate: vi.fn(),
  isModuleEnabled: vi.fn(),
  isPlatformAdminFeatureEnabled: vi.fn(),
  loadPlatformAuthContext: vi.fn(),
}));

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: class {
    getMember = mocks.getMember;
  },
}));

vi.mock('@/database/models/platform', () => ({
  PlatformAuditPolicyModel: class {
    getOrCreate = mocks.getOrCreate;
  },
}));

vi.mock('@/server/enterprise/featureFlags', () => ({
  isPlatformAdminFeatureEnabled: mocks.isPlatformAdminFeatureEnabled,
}));

vi.mock('@/server/enterprise/guards/platformPermission', () => ({
  loadPlatformAuthContext: mocks.loadPlatformAuthContext,
}));

vi.mock('@/server/enterprise/services/moduleSettings', () => ({
  isModuleEnabled: mocks.isModuleEnabled,
}));

vi.mock('@/server/enterprise/services/audit/accessLog', () => ({
  appendAuditAccessLog: mocks.appendAuditAccessLog,
}));

const createDb = (topicShareRows: unknown[] = []) => {
  const limit = vi.fn(async () => topicShareRows);
  const where = vi.fn(() => ({ limit }));
  const innerJoin2 = vi.fn(() => ({ where }));
  const innerJoin1 = vi.fn(() => ({ innerJoin: innerJoin2 }));
  const from = vi.fn(() => ({ innerJoin: innerJoin1 }));
  const select = vi.fn(() => ({ from }));

  return {
    db: { select } as unknown as LobeChatDatabase,
    from,
    innerJoin1,
    limit,
    select,
  };
};

const file = {
  id: 'file-1',
  userId: 'owner-id',
  visibility: 'public' as string | null,
  workspaceId: 'ws-1' as string | null,
};

describe('resolveFileAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMember.mockResolvedValue(undefined);
    mocks.isPlatformAdminFeatureEnabled.mockReturnValue(true);
    mocks.isModuleEnabled.mockResolvedValue(true);
    mocks.loadPlatformAuthContext.mockResolvedValue({ permissions: [] });
    mocks.getOrCreate.mockResolvedValue({ contentAccessMode: 'metadata_only' });
  });

  it('allows the file owner without membership or share lookups', async () => {
    const { db, select } = createDb();

    await expect(resolveFileAccess({ db, file, viewerUserId: 'owner-id' })).resolves.toEqual({
      allowed: true,
      reason: 'owner',
    });

    expect(mocks.getMember).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(mocks.loadPlatformAuthContext).not.toHaveBeenCalled();
  });

  it('allows a workspace member when visibility is public', async () => {
    const { db, select } = createDb();
    mocks.getMember.mockResolvedValue({ userId: 'member-id', workspaceId: 'ws-1' });

    await expect(resolveFileAccess({ db, file, viewerUserId: 'member-id' })).resolves.toEqual({
      allowed: true,
      reason: 'workspace',
    });

    expect(mocks.getMember).toHaveBeenCalledWith('ws-1', 'member-id');
    expect(select).not.toHaveBeenCalled();
    expect(mocks.loadPlatformAuthContext).not.toHaveBeenCalled();
  });

  it('allows a workspace member when visibility is NULL', async () => {
    const { db } = createDb();
    mocks.getMember.mockResolvedValue({ userId: 'member-id', workspaceId: 'ws-1' });

    await expect(
      resolveFileAccess({
        db,
        file: { ...file, visibility: null },
        viewerUserId: 'member-id',
      }),
    ).resolves.toEqual({ allowed: true, reason: 'workspace' });

    expect(mocks.getMember).toHaveBeenCalledWith('ws-1', 'member-id');
  });

  it('does not grant workspace access for private files', async () => {
    const { db, select } = createDb();

    await expect(
      resolveFileAccess({
        db,
        file: { ...file, visibility: 'private' },
        viewerUserId: 'member-id',
      }),
    ).resolves.toEqual({ allowed: false });

    expect(mocks.getMember).not.toHaveBeenCalled();
  });

  it('skips workspace lookup when the file has no workspaceId', async () => {
    const { db } = createDb();

    await expect(
      resolveFileAccess({
        db,
        file: { ...file, workspaceId: null },
        viewerUserId: 'member-id',
      }),
    ).resolves.toEqual({ allowed: false });

    expect(mocks.getMember).not.toHaveBeenCalled();
  });

  it('allows an auditor with conversation body access', async () => {
    const { db } = createDb();
    mocks.loadPlatformAuthContext.mockResolvedValue({
      permissions: [PLATFORM_PERMISSIONS.AUDIT_CONVERSATION_READ],
    });
    mocks.getOrCreate.mockResolvedValue({ contentAccessMode: 'content_allowed' });

    await expect(
      resolveFileAccess({
        db,
        file: { ...file, workspaceId: null },
        viewerUserId: 'auditor-id',
      }),
    ).resolves.toEqual({ allowed: true, reason: 'auditor' });

    expect(mocks.loadPlatformAuthContext).toHaveBeenCalledWith({
      db,
      userId: 'auditor-id',
    });
    expect(mocks.getOrCreate).toHaveBeenCalled();
  });

  it('denies an auditor when policy is metadata_only', async () => {
    const { db } = createDb();
    mocks.loadPlatformAuthContext.mockResolvedValue({
      permissions: [PLATFORM_PERMISSIONS.AUDIT_CONVERSATION_READ],
    });
    mocks.getOrCreate.mockResolvedValue({ contentAccessMode: 'metadata_only' });

    await expect(
      resolveFileAccess({
        db,
        file: { ...file, workspaceId: null },
        viewerUserId: 'auditor-id',
      }),
    ).resolves.toEqual({ allowed: false });
  });

  it('denies an auditor when policy disables content access', async () => {
    const { db } = createDb();
    mocks.loadPlatformAuthContext.mockResolvedValue({
      permissions: [PLATFORM_PERMISSIONS.AUDIT_CONVERSATION_READ],
    });
    mocks.getOrCreate.mockResolvedValue({ contentAccessMode: 'disabled' });

    await expect(
      resolveFileAccess({
        db,
        file: { ...file, workspaceId: null },
        viewerUserId: 'auditor-id',
      }),
    ).resolves.toEqual({ allowed: false });
  });

  it('denies a viewer with other platform permissions but not conversation read', async () => {
    const { db } = createDb();
    mocks.loadPlatformAuthContext.mockResolvedValue({
      permissions: [PLATFORM_PERMISSIONS.AUDIT_READ],
    });
    mocks.getOrCreate.mockResolvedValue({ contentAccessMode: 'content_allowed' });

    await expect(
      resolveFileAccess({
        db,
        file: { ...file, workspaceId: null },
        viewerUserId: 'auditor-id',
      }),
    ).resolves.toEqual({ allowed: false });

    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });

  it('treats loadPlatformAuthContext failure as not-auditor', async () => {
    const { db } = createDb();
    mocks.loadPlatformAuthContext.mockRejectedValue(new Error('rbac lookup failed'));

    await expect(
      resolveFileAccess({
        db,
        file: { ...file, workspaceId: null },
        viewerUserId: 'auditor-id',
      }),
    ).resolves.toEqual({ allowed: false });

    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });

  it('denies auditor access when the platform admin feature is disabled', async () => {
    const { db } = createDb();
    mocks.isPlatformAdminFeatureEnabled.mockReturnValue(false);
    mocks.loadPlatformAuthContext.mockResolvedValue({
      permissions: [PLATFORM_PERMISSIONS.AUDIT_CONVERSATION_READ],
    });
    mocks.getOrCreate.mockResolvedValue({ contentAccessMode: 'content_allowed' });

    await expect(
      resolveFileAccess({
        db,
        file: { ...file, workspaceId: null },
        viewerUserId: 'auditor-id',
      }),
    ).resolves.toEqual({ allowed: false });

    expect(mocks.isModuleEnabled).not.toHaveBeenCalled();
    expect(mocks.loadPlatformAuthContext).not.toHaveBeenCalled();
    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });

  it('denies auditor access when the audit module is disabled', async () => {
    const { db } = createDb();
    mocks.isModuleEnabled.mockResolvedValue(false);
    mocks.loadPlatformAuthContext.mockResolvedValue({
      permissions: [PLATFORM_PERMISSIONS.AUDIT_CONVERSATION_READ],
    });
    mocks.getOrCreate.mockResolvedValue({ contentAccessMode: 'content_allowed' });

    await expect(
      resolveFileAccess({
        db,
        file: { ...file, workspaceId: null },
        viewerUserId: 'auditor-id',
      }),
    ).resolves.toEqual({ allowed: false });

    expect(mocks.isModuleEnabled).toHaveBeenCalledWith('audit');
    expect(mocks.loadPlatformAuthContext).not.toHaveBeenCalled();
    expect(mocks.getOrCreate).not.toHaveBeenCalled();
  });

  it('denies a foreign user with no share, membership, or auditor grant', async () => {
    const { db } = createDb();

    await expect(resolveFileAccess({ db, file, viewerUserId: 'stranger' })).resolves.toEqual({
      allowed: false,
    });
  });
});

describe('recordAuditorFileOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendAuditAccessLog.mockResolvedValue(undefined);
  });

  it('appends a required audit access log for file open', async () => {
    const db = {} as LobeChatDatabase;

    await recordAuditorFileOpen(db, { actorUserId: 'auditor-id', fileId: 'file-1' });

    expect(mocks.appendAuditAccessLog).toHaveBeenCalledWith(db, {
      action: 'admin.audit.files.open',
      actorUserId: 'auditor-id',
      required: true,
      result: 'success',
      targetId: 'file-1',
      targetType: 'file',
    });
  });

  it('propagates append failures (fail closed)', async () => {
    mocks.appendAuditAccessLog.mockRejectedValue(new Error('db down'));
    const db = {} as LobeChatDatabase;

    await expect(
      recordAuditorFileOpen(db, { actorUserId: 'auditor-id', fileId: 'file-1' }),
    ).rejects.toThrow('db down');
  });
});
