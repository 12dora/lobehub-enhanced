import { createHash, randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { platformBrandingAssets } from '@/database/schemas/platform';
import type { PlatformBrandingAssetItem } from '@/database/schemas/platform/branding';
import type { LobeChatDatabase } from '@/database/type';

import { adminPlatformAgentUploadAvatarInputSchema } from '../../contracts/platformAgents';
import type { BrandingAssetStorage } from '../branding/assetStorage';
import {
  BrandingAssetStorageUnavailableError,
  BrandingAssetValidationError,
  FileBrandingAssetStorage,
  validateBrandingAsset,
} from '../branding/assetStorage';
import type { AppendPlatformAuditLogParams } from '../platformAudit';
import { PlatformAuditService } from '../platformAudit';
import {
  PlatformAgentAssetStorageUnavailableError,
  PlatformAgentInvalidInputError,
} from './errors';

const AVATAR_OPERATION = 'admin.agents.uploadAvatar';
const ASSET_ID_PREFIX = 'pba_';
/**
 * `cleanup_after` is NOT NULL on `platform_branding_assets`. Agent avatars are skipped by
 * kind in the branding orphan sweep, so this sentinel is belt-and-suspenders only.
 */
const NEVER_CLEANUP_AFTER = new Date('9999-12-31T00:00:00.000Z');

type UploadAvatarInput = z.infer<typeof adminPlatformAgentUploadAvatarInputSchema>;

export interface PlatformAgentAvatarUploadResult {
  height: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  url: string;
  width: number;
}

export interface PlatformAgentAvatarUploadServiceOptions {
  appendAudit?: (params: AppendPlatformAuditLogParams) => Promise<unknown>;
  now?: () => Date;
  storage?: BrandingAssetStorage;
}

const requestFingerprint = (params: { bytes: Buffer; fileName: string }): string =>
  createHash('sha256').update(params.bytes).update('\0').update(params.fileName).digest('hex');

const toUploadResult = (asset: PlatformBrandingAssetItem): PlatformAgentAvatarUploadResult => ({
  height: asset.height,
  mimeType: asset.mimeType as PlatformAgentAvatarUploadResult['mimeType'],
  url: `/f/${asset.id}`,
  width: asset.width,
});

/**
 * Validates, stores, and returns a controlled `/f/<id>` URL for a platform Agent avatar.
 *
 * Idempotency: the existing `platform_branding_assets` unique request lane
 * `(request_actor_id, operation, request_id)` is reused. A matching ready row is replayed;
 * a matching in-flight row is retried onto the same object key. There is no separate replay
 * table and concurrent first-writes on the same lane may still conflict.
 */
export class PlatformAgentAvatarUploadService {
  private readonly appendAudit: (params: AppendPlatformAuditLogParams) => Promise<unknown>;
  private readonly db: LobeChatDatabase;
  private readonly now: () => Date;
  private readonly storage: BrandingAssetStorage;

  constructor(db: LobeChatDatabase, options: PlatformAgentAvatarUploadServiceOptions = {}) {
    this.db = db;
    this.appendAudit =
      options.appendAudit ?? ((params) => new PlatformAuditService(db).append(params));
    this.now = options.now ?? (() => new Date());
    this.storage = options.storage ?? new FileBrandingAssetStorage(db);
  }

  private async assertStorageConfigured(): Promise<void> {
    if (await this.storage.isConfigured()) return;
    throw new PlatformAgentAssetStorageUnavailableError();
  }

  private async validateAsset(input: UploadAvatarInput) {
    try {
      return await validateBrandingAsset({
        bytesBase64: input.bytesBase64,
        fileName: input.fileName,
      });
    } catch (error) {
      if (error instanceof BrandingAssetValidationError) throw new PlatformAgentInvalidInputError();
      throw error;
    }
  }

  private async findLane(actorUserId: string, requestId: string) {
    const [existing] = await this.db
      .select()
      .from(platformBrandingAssets)
      .where(
        and(
          eq(platformBrandingAssets.requestActorId, actorUserId),
          eq(platformBrandingAssets.operation, AVATAR_OPERATION),
          eq(platformBrandingAssets.requestId, requestId),
        ),
      )
      .limit(1);
    return existing;
  }

  private async compensate(objectKey: string, assetId: string): Promise<void> {
    try {
      await this.storage.delete(objectKey);
    } catch (error) {
      console.error('[admin.agents.uploadAvatar] object compensation failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    try {
      await this.db.delete(platformBrandingAssets).where(eq(platformBrandingAssets.id, assetId));
    } catch (error) {
      console.error('[admin.agents.uploadAvatar] row compensation failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private remapStorageError(error: unknown): never {
    if (error instanceof BrandingAssetStorageUnavailableError) {
      throw new PlatformAgentAssetStorageUnavailableError();
    }
    throw error;
  }

  private async persistReady(assetId: string): Promise<PlatformBrandingAssetItem> {
    const [ready] = await this.db
      .update(platformBrandingAssets)
      .set({
        objectDeletedAt: null,
        status: 'ready',
        updatedAt: this.now(),
        uploadLeaseUntil: null,
        uploadOwner: null,
      })
      .where(eq(platformBrandingAssets.id, assetId))
      .returning();
    if (!ready) throw new PlatformAgentInvalidInputError();
    return ready;
  }

  private async auditSuccess(
    actorUserId: string,
    asset: PlatformBrandingAssetItem,
    requestId: string,
  ): Promise<void> {
    try {
      await this.appendAudit({
        action: 'admin.agents.uploadAvatar',
        actorUserId,
        afterDiff: {
          assetId: asset.id,
          height: asset.height,
          mimeType: asset.mimeType,
          width: asset.width,
        },
        requestId,
        result: 'success',
        targetId: asset.id,
        targetType: 'agent',
      });
    } catch (auditError) {
      console.error('[admin.agents.uploadAvatar] success audit unavailable', {
        errorClass: auditError instanceof Error ? auditError.name : 'UnknownError',
      });
    }
  }

  upload = async (
    actorUserId: string,
    rawInput: UploadAvatarInput,
  ): Promise<PlatformAgentAvatarUploadResult> => {
    await this.assertStorageConfigured();
    const input = adminPlatformAgentUploadAvatarInputSchema.parse(rawInput);
    const asset = await this.validateAsset(input);
    const fingerprint = requestFingerprint({ bytes: asset.bytes, fileName: input.fileName });

    const existing = await this.findLane(actorUserId, input.requestId);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new PlatformAgentInvalidInputError();
      if (existing.status === 'ready' && existing.objectDeletedAt === null) {
        return toUploadResult(existing);
      }
      try {
        await this.storage.upload({ asset, objectKey: existing.objectKey });
      } catch (error) {
        this.remapStorageError(error);
      }
      const ready = await this.persistReady(existing.id);
      await this.auditSuccess(actorUserId, ready, input.requestId);
      return toUploadResult(ready);
    }

    const objectUuid = randomUUID();
    const id = `${ASSET_ID_PREFIX}${objectUuid}`;
    const objectKey = `platform-agents/avatars/${objectUuid}.${asset.extension}`;
    const now = this.now();

    await this.db.insert(platformBrandingAssets).values({
      cleanupAfter: NEVER_CLEANUP_AFTER,
      createdBy: actorUserId,
      height: asset.height,
      id,
      kind: 'agentAvatar',
      mimeType: asset.mimeType,
      objectKey,
      operation: AVATAR_OPERATION,
      requestActorId: actorUserId,
      requestFingerprint: fingerprint,
      requestId: input.requestId,
      sha256: createHash('sha256').update(asset.bytes).digest('hex'),
      size: asset.bytes.length,
      status: 'uploading',
      updatedAt: now,
      width: asset.width,
    });

    try {
      await this.storage.upload({ asset, objectKey });
      const ready = await this.persistReady(id);
      await this.auditSuccess(actorUserId, ready, input.requestId);
      return toUploadResult(ready);
    } catch (error) {
      await this.compensate(objectKey, id);
      this.remapStorageError(error);
    }
  };
}
