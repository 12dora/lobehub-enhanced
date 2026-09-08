import { createHash, randomUUID } from 'node:crypto';

import { and, eq, isNull, lte, or } from 'drizzle-orm';
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
  PlatformAgentUnavailableError,
} from './errors';

const AVATAR_OPERATION = 'admin.agents.uploadAvatar';
const ASSET_ID_PREFIX = 'pba_';
/**
 * `cleanup_after` is NOT NULL on `platform_branding_assets`. Agent avatars are skipped by
 * kind in the branding orphan sweep, so this sentinel is belt-and-suspenders only.
 */
const NEVER_CLEANUP_AFTER = new Date('9999-12-31T00:00:00.000Z');

/** Matches `AdminBrandingAssetService` upload-lane lease. */
export const AVATAR_UPLOAD_LEASE_MS = 5 * 60 * 1000;
export const AVATAR_REPLAY_WAIT_MS = 15 * 1000;
export const AVATAR_REPLAY_POLL_MS = 100;

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
  sleep?: (milliseconds: number) => Promise<void>;
  storage?: BrandingAssetStorage;
}

interface AvatarReservation {
  asset: PlatformBrandingAssetItem;
  owner: string;
  status: 'acquired';
}

interface AvatarReplay {
  asset: PlatformBrandingAssetItem;
  status: 'replay';
}

interface AvatarWait {
  asset: PlatformBrandingAssetItem;
  status: 'wait';
}

type AvatarReservationResult = AvatarReplay | AvatarReservation | AvatarWait;

const requestFingerprint = (params: { bytes: Buffer; fileName: string }): string =>
  createHash('sha256').update(params.bytes).update('\0').update(params.fileName).digest('hex');

const toUploadResult = (asset: PlatformBrandingAssetItem): PlatformAgentAvatarUploadResult => ({
  height: asset.height,
  mimeType: asset.mimeType as PlatformAgentAvatarUploadResult['mimeType'],
  url: `/f/${asset.id}`,
  width: asset.width,
});

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isLaneUniqueViolation = (error: unknown): boolean => {
  let current = error as { cause?: unknown; code?: unknown; message?: unknown } | undefined;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    if (current.code === '23505') return true;
    const message = typeof current.message === 'string' ? current.message : '';
    if (/unique|duplicate|already exists/i.test(message)) return true;
    current = current.cause as typeof current;
  }
  return false;
};

/**
 * Validates, stores, and returns a controlled `/f/<id>` URL for a platform Agent avatar.
 *
 * Idempotency: the existing `platform_branding_assets` unique request lane
 * `(request_actor_id, operation, request_id)` is reused. A matching ready row is replayed.
 * An in-flight row is waited on while its upload lease is live; after expiry a retry may
 * take over. Finalization and compensation are CAS-guarded on
 * `(id, status='uploading', uploadOwner=me)` so a stalled first attempt cannot delete a
 * retry's published object.
 */
export class PlatformAgentAvatarUploadService {
  private readonly appendAudit: (params: AppendPlatformAuditLogParams) => Promise<unknown>;
  private readonly db: LobeChatDatabase;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly storage: BrandingAssetStorage;

  constructor(db: LobeChatDatabase, options: PlatformAgentAvatarUploadServiceOptions = {}) {
    this.db = db;
    this.appendAudit =
      options.appendAudit ?? ((params) => new PlatformAuditService(db).append(params));
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
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

  private leaseHolds = (asset: PlatformBrandingAssetItem, now: Date): boolean =>
    asset.status === 'uploading' && Boolean(asset.uploadLeaseUntil && asset.uploadLeaseUntil > now);

  /**
   * Compensation may delete the object only after winning CAS on the uploading row we own.
   * A `ready` row (or a different owner) is left untouched — a stalled first attempt must
   * never remove a retry's published object.
   */
  private async compensate(reservation: AvatarReservation): Promise<void> {
    const [claimed] = await this.db
      .delete(platformBrandingAssets)
      .where(
        and(
          eq(platformBrandingAssets.id, reservation.asset.id),
          eq(platformBrandingAssets.status, 'uploading'),
          eq(platformBrandingAssets.uploadOwner, reservation.owner),
        ),
      )
      .returning({ id: platformBrandingAssets.id, objectKey: platformBrandingAssets.objectKey });
    if (!claimed) return;
    try {
      await this.storage.delete(claimed.objectKey);
    } catch (error) {
      console.error('[admin.agents.uploadAvatar] object compensation failed', {
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

  private async persistReady(reservation: AvatarReservation): Promise<PlatformBrandingAssetItem> {
    const [ready] = await this.db
      .update(platformBrandingAssets)
      .set({
        objectDeletedAt: null,
        status: 'ready',
        updatedAt: this.now(),
        uploadLeaseUntil: null,
        uploadOwner: null,
      })
      .where(
        and(
          eq(platformBrandingAssets.id, reservation.asset.id),
          eq(platformBrandingAssets.status, 'uploading'),
          eq(platformBrandingAssets.uploadOwner, reservation.owner),
        ),
      )
      .returning();
    if (ready) return ready;

    const replay = await this.waitForReplay(reservation.asset.id);
    if (replay) return replay;
    throw new PlatformAgentUnavailableError();
  }

  private waitForReplay = async (assetId: string): Promise<PlatformBrandingAssetItem | null> => {
    const deadline = Date.now() + AVATAR_REPLAY_WAIT_MS;
    while (Date.now() < deadline) {
      await this.sleep(AVATAR_REPLAY_POLL_MS);
      const [asset] = await this.db
        .select()
        .from(platformBrandingAssets)
        .where(eq(platformBrandingAssets.id, assetId))
        .limit(1);
      if (!asset) return null;
      if (asset.status === 'ready') return asset;
      if (asset.status !== 'uploading') return null;
    }
    const [asset] = await this.db
      .select()
      .from(platformBrandingAssets)
      .where(eq(platformBrandingAssets.id, assetId))
      .limit(1);
    if (asset?.status === 'ready') return asset;
    return null;
  };

  private async acquireExisting(existing: PlatformBrandingAssetItem): Promise<AvatarReservation> {
    const now = this.now();
    const owner = randomUUID();
    const leaseUntil = new Date(now.getTime() + AVATAR_UPLOAD_LEASE_MS);
    const [claimed] = await this.db
      .update(platformBrandingAssets)
      .set({
        objectDeletedAt: null,
        status: 'uploading',
        updatedAt: now,
        uploadLeaseUntil: leaseUntil,
        uploadOwner: owner,
      })
      .where(
        and(
          eq(platformBrandingAssets.id, existing.id),
          eq(platformBrandingAssets.status, 'uploading'),
          or(
            isNull(platformBrandingAssets.uploadLeaseUntil),
            lte(platformBrandingAssets.uploadLeaseUntil, now),
          ),
        ),
      )
      .returning();
    if (!claimed) throw new PlatformAgentUnavailableError();
    return { asset: claimed, owner, status: 'acquired' };
  }

  private async insertLane(params: {
    actorUserId: string;
    asset: Awaited<ReturnType<PlatformAgentAvatarUploadService['validateAsset']>>;
    fingerprint: string;
    requestId: string;
  }): Promise<AvatarReservationResult> {
    const now = this.now();
    const objectUuid = randomUUID();
    const id = `${ASSET_ID_PREFIX}${objectUuid}`;
    const objectKey = `platform-agents/avatars/${objectUuid}.${params.asset.extension}`;
    const owner = randomUUID();
    const leaseUntil = new Date(now.getTime() + AVATAR_UPLOAD_LEASE_MS);

    try {
      const [created] = await this.db
        .insert(platformBrandingAssets)
        .values({
          cleanupAfter: NEVER_CLEANUP_AFTER,
          createdBy: params.actorUserId,
          height: params.asset.height,
          id,
          kind: 'agentAvatar',
          mimeType: params.asset.mimeType,
          objectKey,
          operation: AVATAR_OPERATION,
          requestActorId: params.actorUserId,
          requestFingerprint: params.fingerprint,
          requestId: params.requestId,
          sha256: createHash('sha256').update(params.asset.bytes).digest('hex'),
          size: params.asset.bytes.length,
          status: 'uploading',
          updatedAt: now,
          uploadLeaseUntil: leaseUntil,
          uploadOwner: owner,
          width: params.asset.width,
        })
        .returning();
      return { asset: created, owner, status: 'acquired' };
    } catch (error) {
      if (!isLaneUniqueViolation(error)) throw error;
      const existing = await this.findLane(params.actorUserId, params.requestId);
      if (!existing) throw error;
      if (existing.requestFingerprint !== params.fingerprint) {
        throw new PlatformAgentInvalidInputError();
      }
      if (existing.status === 'ready' && existing.objectDeletedAt === null) {
        return { asset: existing, status: 'replay' };
      }
      if (this.leaseHolds(existing, this.now())) {
        return { asset: existing, status: 'wait' };
      }
      return this.acquireExisting(existing);
    }
  }

  private async reserve(params: {
    actorUserId: string;
    asset: Awaited<ReturnType<PlatformAgentAvatarUploadService['validateAsset']>>;
    fingerprint: string;
    requestId: string;
  }): Promise<AvatarReservationResult> {
    const existing = await this.findLane(params.actorUserId, params.requestId);
    if (!existing) return this.insertLane(params);

    if (existing.requestFingerprint !== params.fingerprint) {
      throw new PlatformAgentInvalidInputError();
    }
    if (existing.status === 'ready' && existing.objectDeletedAt === null) {
      return { asset: existing, status: 'replay' };
    }
    if (this.leaseHolds(existing, this.now())) {
      return { asset: existing, status: 'wait' };
    }
    return this.acquireExisting(existing);
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

    let reservation = await this.reserve({
      actorUserId,
      asset,
      fingerprint,
      requestId: input.requestId,
    });
    if (reservation.status === 'replay') return toUploadResult(reservation.asset);
    if (reservation.status === 'wait') {
      const replay = await this.waitForReplay(reservation.asset.id);
      if (replay) return toUploadResult(replay);
      reservation = await this.reserve({
        actorUserId,
        asset,
        fingerprint,
        requestId: input.requestId,
      });
      if (reservation.status === 'replay') return toUploadResult(reservation.asset);
      if (reservation.status === 'wait') throw new PlatformAgentUnavailableError();
    }
    if (reservation.status !== 'acquired') throw new PlatformAgentUnavailableError();

    try {
      try {
        await this.storage.upload({ asset, objectKey: reservation.asset.objectKey });
      } catch (error) {
        this.remapStorageError(error);
      }
      const ready = await this.persistReady(reservation);
      await this.auditSuccess(actorUserId, ready, input.requestId);
      return toUploadResult(ready);
    } catch (error) {
      await this.compensate(reservation);
      this.remapStorageError(error);
    }
  };
}
