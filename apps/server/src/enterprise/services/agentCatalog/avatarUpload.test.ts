// @vitest-environment node
import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { platformAuditLogs, platformBrandingAssets, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { deletePlatformAuditLogsForTest } from '../../testing/deletePlatformAuditLogs';
import { AVATAR_UPLOAD_LEASE_MS, PlatformAgentAvatarUploadService } from './avatarUpload';
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

  it('keeps a retry’s published object when the stalled first attempt later fails', async () => {
    let clock = new Date('2026-09-08T00:00:00.000Z');
    let failStalled!: (error: Error) => void;
    const stalled = new Promise<void>((_resolve, reject) => {
      failStalled = reject;
    });
    const storage = {
      delete: vi.fn(async () => {}),
      isConfigured: () => true,
      upload: vi.fn(async () => stalled),
    };
    const service = new PlatformAgentAvatarUploadService(db, { now: () => clock, storage });
    const bytes = await png();
    const request = {
      bytesBase64: bytes.toString('base64'),
      fileName: 'avatar.png',
      requestId: crypto.randomUUID(),
    };

    const stalledUpload = service.upload(actorUserId, request);
    await vi.waitFor(() => expect(storage.upload).toHaveBeenCalledOnce());

    clock = new Date(clock.getTime() + AVATAR_UPLOAD_LEASE_MS + 1);
    storage.upload.mockImplementation(async () => {});
    const retry = new PlatformAgentAvatarUploadService(db, { now: () => clock, storage });
    const published = await retry.upload(actorUserId, request);

    failStalled(new Error('stalled first attempt'));
    await expect(stalledUpload).rejects.toThrow('stalled first attempt');

    expect(storage.delete).not.toHaveBeenCalled();
    const [row] = await db.select().from(platformBrandingAssets);
    expect(row).toMatchObject({ id: published.url.slice('/f/'.length), status: 'ready' });
    expect(row.objectDeletedAt).toBeNull();
  });

  it('treats a concurrent first insert unique violation as wait/replay', async () => {
    const storage = {
      delete: vi.fn(async () => {}),
      isConfigured: () => true,
      upload: vi.fn(async () => {}),
    };
    const service = new PlatformAgentAvatarUploadService(db, { storage });
    const bytes = await png();
    const request = {
      bytesBase64: bytes.toString('base64'),
      fileName: 'avatar.png',
      requestId: crypto.randomUUID(),
    };

    const [first, second] = await Promise.all([
      service.upload(actorUserId, request),
      service.upload(actorUserId, request),
    ]);

    expect(second).toEqual(first);
    expect(await db.select().from(platformBrandingAssets)).toEqual([
      expect.objectContaining({ id: first.url.slice('/f/'.length), status: 'ready' }),
    ]);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('lets a retry take over the lane after the upload lease expires', async () => {
    const bytes = await png(16, 16);
    const requestId = crypto.randomUUID();
    const objectUuid = crypto.randomUUID();
    const fingerprint = createHash('sha256')
      .update(bytes)
      .update('\0')
      .update('avatar.png')
      .digest('hex');
    await db.insert(platformBrandingAssets).values({
      cleanupAfter: new Date('9999-12-31T00:00:00.000Z'),
      createdBy: actorUserId,
      height: 16,
      id: `pba_${objectUuid}`,
      kind: 'agentAvatar',
      mimeType: 'image/png',
      objectKey: `platform-agents/avatars/${objectUuid}.png`,
      operation: 'admin.agents.uploadAvatar',
      requestActorId: actorUserId,
      requestFingerprint: fingerprint,
      requestId,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      status: 'uploading',
      uploadLeaseUntil: new Date('2020-01-01T00:00:00.000Z'),
      uploadOwner: crypto.randomUUID(),
      width: 16,
    });

    const storage = {
      delete: vi.fn(async () => {}),
      isConfigured: () => true,
      upload: vi.fn(async () => {}),
    };
    const service = new PlatformAgentAvatarUploadService(db, {
      now: () => new Date('2026-09-08T00:00:00.000Z'),
      storage,
    });
    const result = await service.upload(actorUserId, {
      bytesBase64: bytes.toString('base64'),
      fileName: 'avatar.png',
      requestId,
    });

    expect(result.url).toBe(`/f/pba_${objectUuid}`);
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: `platform-agents/avatars/${objectUuid}.png` }),
    );
    const [row] = await db.select().from(platformBrandingAssets);
    expect(row).toMatchObject({
      id: `pba_${objectUuid}`,
      status: 'ready',
      uploadOwner: null,
    });
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
