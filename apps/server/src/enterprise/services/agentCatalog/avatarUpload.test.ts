// @vitest-environment node
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { platformAuditLogs, platformBrandingAssets, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { deletePlatformAuditLogsForTest } from '../../testing/deletePlatformAuditLogs';
import { PlatformAgentAvatarUploadService } from './avatarUpload';
import {
  PlatformAgentAssetStorageUnavailableError,
  PlatformAgentInvalidInputError,
} from './errors';

const db: LobeChatDatabase = await getTestDB();
const actorUserId = 'agent-avatar-admin';

const png = async (width = 16, height = 16) =>
  sharp({ create: { background: '#3366ff', channels: 4, height, width } })
    .png()
    .toBuffer();

const cleanup = async () => {
  await deletePlatformAuditLogsForTest(db, { actorUserIds: [actorUserId] });
  await db.delete(platformBrandingAssets);
  await db.delete(users).where(eq(users.id, actorUserId));
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values({ id: actorUserId });
});

afterEach(cleanup);

describe('PlatformAgentAvatarUploadService', () => {
  it('rejects a non-image payload before storage', async () => {
    const storage = {
      delete: vi.fn(async () => {}),
      isConfigured: () => true,
      upload: vi.fn(async () => {}),
    };
    const service = new PlatformAgentAvatarUploadService(db, { storage });

    await expect(
      service.upload(actorUserId, {
        bytesBase64: Buffer.from('not an image').toString('base64'),
        fileName: 'avatar.png',
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(PlatformAgentInvalidInputError);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(await db.select().from(platformBrandingAssets)).toEqual([]);
  });

  it('throws a stable code when object storage is not configured', async () => {
    const storage = {
      delete: vi.fn(async () => {}),
      isConfigured: () => false,
      upload: vi.fn(async () => {}),
    };
    const service = new PlatformAgentAvatarUploadService(db, { storage });

    await expect(
      service.upload(actorUserId, {
        bytesBase64: (await png()).toString('base64'),
        fileName: 'avatar.png',
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(PlatformAgentAssetStorageUnavailableError);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('stores the object and returns a controlled /f/<id> URL', async () => {
    const storage = {
      delete: vi.fn(async () => {}),
      isConfigured: () => true,
      upload: vi.fn(async () => {}),
    };
    const service = new PlatformAgentAvatarUploadService(db, { storage });
    const bytes = await png(32, 24);
    const requestId = crypto.randomUUID();

    const result = await service.upload(actorUserId, {
      bytesBase64: bytes.toString('base64'),
      fileName: 'avatar.png',
      requestId,
    });

    expect(result).toMatchObject({ height: 24, mimeType: 'image/png', width: 32 });
    expect(result.url).toMatch(/^\/f\/pba_[\da-f-]{36}$/);
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: expect.stringMatching(/^platform-agents\/avatars\/[\da-f-]{36}\.png$/),
      }),
    );

    const [row] = await db.select().from(platformBrandingAssets);
    expect(row).toMatchObject({
      id: result.url.slice('/f/'.length),
      kind: 'agentAvatar',
      mimeType: 'image/png',
      operation: 'admin.agents.uploadAvatar',
      status: 'ready',
    });
    expect(
      (await db.select().from(platformAuditLogs)).filter(
        (audit) => audit.action === 'admin.agents.uploadAvatar' && audit.result === 'success',
      ),
    ).toHaveLength(1);

    const replayed = await service.upload(actorUserId, {
      bytesBase64: bytes.toString('base64'),
      fileName: 'avatar.png',
      requestId,
    });
    expect(replayed).toEqual(result);
    expect(storage.upload).toHaveBeenCalledOnce();
  });
});
