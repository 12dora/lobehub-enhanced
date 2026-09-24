// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  agentSkills,
  files,
  globalFiles,
  platformGlobalCredentialUploads,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import {
  capUntrackedObjectKeys,
  GLOBAL_FILE_ORPHAN_GC_SCAN_FACTOR,
  GLOBAL_FILE_ORPHAN_GC_UNTRACKED_KEY_CAP,
  type GlobalFileOrphanGcConfig,
  GlobalFileOrphanGcS3OutageError,
  isDeletableGlobalFileObjectKey,
  previewGlobalFileOrphanGc,
  readGlobalFileOrphanGcConfig,
  runGlobalFileOrphanGc,
} from './run';

const mocks = vi.hoisted(() => {
  const deleteFile = vi.fn(async (_url: string): Promise<void> => undefined);
  const createFileS3 = vi.fn(async () => ({ deleteFile }));
  return { createFileS3, deleteFile };
});

vi.mock('@/server/modules/S3', () => ({
  createFileS3: mocks.createFileS3,
}));

const db: LobeChatDatabase = await getTestDB();

const userId = 'g6-orphan-gc-user';
const otherUserId = 'g6-orphan-gc-other';

const liveConfig: Partial<GlobalFileOrphanGcConfig> = {
  batch: 10,
  cap: 500,
  dryRun: false,
  enabled: true,
  graceDays: 7,
};

const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const reset = async (): Promise<void> => {
  await db.delete(files);
  await db.delete(agentSkills);
  await db.delete(globalFiles);
  await db
    .delete(platformGlobalCredentialUploads)
    .where(eq(platformGlobalCredentialUploads.createdBy, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
};

beforeEach(async () => {
  mocks.deleteFile.mockReset();
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.createFileS3.mockReset();
  mocks.createFileS3.mockImplementation(async () => ({ deleteFile: mocks.deleteFile }));
  await reset();
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await reset();
});

const insertGlobal = async (params: {
  accessedAt?: Date;
  createdAt?: Date;
  creator?: string | null;
  hashId: string;
  size?: number;
  url: string;
}): Promise<void> => {
  const createdAt = params.createdAt ?? daysAgo(8);
  await db.insert(globalFiles).values({
    accessedAt: params.accessedAt ?? createdAt,
    createdAt,
    creator: params.creator === undefined ? null : params.creator,
    fileType: 'application/octet-stream',
    hashId: params.hashId,
    size: params.size ?? 40,
    url: params.url,
  });
};

const findGlobal = (hashId: string) =>
  db.query.globalFiles.findFirst({ where: eq(globalFiles.hashId, hashId) });

describe('readGlobalFileOrphanGcConfig', () => {
  it('defaults to enabled, 7 days, batch 100, cap 500', () => {
    expect(readGlobalFileOrphanGcConfig({})).toEqual({
      batch: 100,
      cap: 500,
      dryRun: false,
      enabled: true,
      graceDays: 7,
    });
    expect(
      readGlobalFileOrphanGcConfig({
        GLOBAL_FILE_ORPHAN_GC: '0',
        GLOBAL_FILE_ORPHAN_GC_BATCH: '25',
        GLOBAL_FILE_ORPHAN_GC_CAP: '40',
        GLOBAL_FILE_ORPHAN_GC_DRY_RUN: '1',
        GLOBAL_FILE_ORPHAN_GC_GRACE_DAYS: '14',
      }),
    ).toEqual({
      batch: 25,
      cap: 40,
      dryRun: true,
      enabled: false,
      graceDays: 14,
    });
    expect(
      readGlobalFileOrphanGcConfig({
        GLOBAL_FILE_ORPHAN_GC_BATCH: '0',
        GLOBAL_FILE_ORPHAN_GC_GRACE_DAYS: 'nope',
      }),
    ).toMatchObject({ batch: 100, graceDays: 7 });
    expect(readGlobalFileOrphanGcConfig({ GLOBAL_FILE_ORPHAN_GC_DRY_RUN: 'yes' }).dryRun).toBe(
      true,
    );
    expect(readGlobalFileOrphanGcConfig({ GLOBAL_FILE_ORPHAN_GC_DRY_RUN: 'TRUE' }).dryRun).toBe(
      true,
    );
    expect(readGlobalFileOrphanGcConfig({ GLOBAL_FILE_ORPHAN_GC_DRY_RUN: ' no ' }).dryRun).toBe(
      false,
    );
    for (const value of ['0', 'false', 'FALSE', ' no ', 'off']) {
      expect(readGlobalFileOrphanGcConfig({ GLOBAL_FILE_ORPHAN_GC: value }).enabled).toBe(false);
    }
    expect(readGlobalFileOrphanGcConfig({ GLOBAL_FILE_ORPHAN_GC: '1' }).enabled).toBe(true);
    const sixty = Array.from({ length: 60 }, (_, index) => `k${index}`);
    expect(capUntrackedObjectKeys(sixty)).toHaveLength(GLOBAL_FILE_ORPHAN_GC_UNTRACKED_KEY_CAP);
    expect(capUntrackedObjectKeys(sixty)[0]).toBe('k0');
    expect(capUntrackedObjectKeys(sixty)[49]).toBe('k49');
  });
});

describe('isDeletableGlobalFileObjectKey', () => {
  it('refuses empty, absolute, traversal, and backslash keys', () => {
    expect(isDeletableGlobalFileObjectKey('')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('   ')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('../secret')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('/files/a')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('https://example.com/a')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('C:/windows')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('a\\b')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('skills/zip/abc.zip')).toBe(true);
    expect(isDeletableGlobalFileObjectKey('files/generations/a.png')).toBe(true);
    expect(isDeletableGlobalFileObjectKey('files/a..b.md')).toBe(true);
    expect(isDeletableGlobalFileObjectKey('skills/a..b.md')).toBe(true);
    expect(isDeletableGlobalFileObjectKey('generations/a.png')).toBe(true);
    expect(isDeletableGlobalFileObjectKey('import_config/a.json')).toBe(true);
    expect(isDeletableGlobalFileObjectKey('ragEval/a.json')).toBe(true);
    expect(isDeletableGlobalFileObjectKey('eval-datasets/a.json')).toBe(true);
    expect(isDeletableGlobalFileObjectKey('files/../secret')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('files/./a')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('branding/logo.png')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('user/avatar/a.png')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('agent-traces/a')).toBe(false);
    expect(isDeletableGlobalFileObjectKey('team-uploads/a.bin', ['team-uploads'])).toBe(true);
  });
});

describe('runGlobalFileOrphanGc', () => {
  it('deletes an old unreferenced blob whose creator is still set, then the object', async () => {
    const hashId = 'g6oc-creator-alive';
    const url = `skills/zip/${hashId}.zip`;
    await insertGlobal({ creator: userId, hashId, size: 40, url });

    const summary = await runGlobalFileOrphanGc(db, {
      config: liveConfig,
      deleteObject: mocks.deleteFile,
    });

    expect(await findGlobal(hashId)).toBeUndefined();
    expect(mocks.deleteFile).toHaveBeenCalledWith(url);
    expect(mocks.createFileS3).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      bytes: 40,
      deletedObjects: 1,
      deletedRows: 1,
      dryRun: false,
      failedObjects: 0,
      scanned: 1,
      skippedRaced: 0,
    });
  });

  it('keeps a shared hash when another user still has a files row', async () => {
    const hashId = 'g6oc-shared';
    const url = `files/${hashId}.txt`;
    await insertGlobal({ creator: null, hashId, url });
    await db.insert(files).values({
      fileHash: hashId,
      fileType: 'text/plain',
      name: 'shared.txt',
      size: 40,
      url,
      userId: otherUserId,
    });

    await runGlobalFileOrphanGc(db, { config: liveConfig, deleteObject: mocks.deleteFile });

    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('keeps a blob younger than the grace window', async () => {
    const hashId = 'g6oc-young';
    await insertGlobal({ createdAt: daysAgo(1), hashId, url: `files/${hashId}.txt` });
    const preview = await previewGlobalFileOrphanGc(db, { graceDays: 7 });

    await runGlobalFileOrphanGc(db, { config: liveConfig, deleteObject: mocks.deleteFile });

    expect(preview).toEqual({ bytes: 0, count: 0 });
    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('keeps a blob whose accessed_at was refreshed inside the grace window', async () => {
    const hashId = 'g6oc-accessed';
    await insertGlobal({
      accessedAt: daysAgo(1),
      createdAt: daysAgo(8),
      hashId,
      url: `files/${hashId}.txt`,
    });

    expect(await previewGlobalFileOrphanGc(db, { graceDays: 7 })).toEqual({ bytes: 0, count: 0 });
    expect(await findGlobal(hashId)).toBeDefined();
  });

  it('keeps a blob referenced only by agent_skills.zip_file_hash', async () => {
    const hashId = 'g6oc-zip';
    const url = `skills/zip/${hashId}.zip`;
    await insertGlobal({ hashId, url });
    await db.insert(agentSkills).values({
      description: 'zip',
      identifier: 'g6.zip',
      manifest: { description: 'zip', name: 'Zip' },
      name: 'Zip',
      source: 'user',
      userId,
      zipFileHash: hashId,
    });

    await runGlobalFileOrphanGc(db, { config: liveConfig, deleteObject: mocks.deleteFile });

    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(await previewGlobalFileOrphanGc(db, { graceDays: 7 })).toEqual({ bytes: 0, count: 0 });
  });

  it('keeps a blob referenced only by a skill resource fileHash', async () => {
    const hashId = 'g6oc-resource';
    const url = `skills/source_files/${hashId}/notes.txt`;
    await insertGlobal({ hashId, url });
    await db.insert(agentSkills).values({
      description: 'resource',
      identifier: 'g6.resource',
      manifest: { description: 'resource', name: 'Notes' },
      name: 'Notes',
      resources: { 'notes.txt': { fileHash: hashId, size: 40 } },
      source: 'user',
      userId,
    });

    await runGlobalFileOrphanGc(db, { config: liveConfig, deleteObject: mocks.deleteFile });

    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('does not treat a credential upload file_hash_id as a reference', async () => {
    const hashId = 'ab'.repeat(32);
    const url = `files/${hashId}.bin`;
    await insertGlobal({ hashId, size: 40, url });
    await db.insert(platformGlobalCredentialUploads).values({
      ciphertext: 'cipher',
      createdBy: userId,
      expiresAt: new Date(Date.now() + 60_000),
      fileHashId: hashId,
      fileName: 'secret.pem',
      fileSize: 40,
      fileType: 'application/x-pem-file',
      fingerprint: 'cd'.repeat(32),
      keyId: 'key-1',
      ref: 'kms://platform-global-credentials/upload/g6',
    });

    await runGlobalFileOrphanGc(db, { config: liveConfig, deleteObject: mocks.deleteFile });

    expect(await findGlobal(hashId)).toBeUndefined();
    expect(mocks.deleteFile).toHaveBeenCalledWith(url);
    const [upload] = await db
      .select({ id: platformGlobalCredentialUploads.id })
      .from(platformGlobalCredentialUploads)
      .where(eq(platformGlobalCredentialUploads.fileHashId, hashId));
    expect(upload).toBeDefined();
  });

  it('dry-run reports candidate bytes and deletes nothing', async () => {
    const hashId = 'g6oc-dry';
    await insertGlobal({ hashId, size: 80, url: `files/${hashId}.txt` });

    const summary = await runGlobalFileOrphanGc(db, {
      config: { ...liveConfig, dryRun: true },
      deleteObject: mocks.deleteFile,
    });

    expect(summary).toMatchObject({
      bytes: 80,
      deletedObjects: 0,
      deletedRows: 0,
      dryRun: true,
      failedObjects: 0,
      scanned: 1,
      skippedRaced: 0,
    });
    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.createFileS3).not.toHaveBeenCalled();
  });

  it('keeps going when DeleteObject rejects and leaves that row deleted', async () => {
    const failHash = 'g6oc-s3-fail';
    const okHash = 'g6oc-s3-ok';
    await insertGlobal({
      createdAt: new Date(0),
      hashId: failHash,
      size: 10,
      url: `files/${failHash}.txt`,
    });
    await insertGlobal({
      createdAt: new Date(1000),
      hashId: okHash,
      size: 20,
      url: `files/${okHash}.txt`,
    });
    mocks.deleteFile.mockImplementation(async (url: string) => {
      if (url === `files/${failHash}.txt`) throw new Error('Delete failed');
    });

    const summary = await runGlobalFileOrphanGc(db, {
      config: liveConfig,
      deleteObject: mocks.deleteFile,
    });

    expect(await findGlobal(failHash)).toBeUndefined();
    expect(await findGlobal(okHash)).toBeUndefined();
    expect(mocks.deleteFile).toHaveBeenCalledWith(`files/${okHash}.txt`);
    expect(summary).toMatchObject({
      bytes: 20,
      deletedObjects: 1,
      deletedRows: 2,
      failedObjects: 1,
      skippedRaced: 0,
    });
  });

  it('skips S3 when the hash is reinserted before DeleteObject', async () => {
    const hashId = 'g6oc-race';
    const url = `skills/zip/${hashId}.zip`;
    await insertGlobal({ hashId, size: 15, url });

    const summary = await runGlobalFileOrphanGc(db, {
      beforeObjectDelete: async (row) => {
        await insertGlobal({ hashId: row.hashId, size: row.size, url: row.url });
      },
      config: liveConfig,
      deleteObject: mocks.deleteFile,
    });

    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      deletedObjects: 0,
      deletedRows: 1,
      skippedRaced: 1,
    });
  });

  it('does not delete the row or call S3 for an unsafe key, and still deletes the next blob', async () => {
    const badHash = 'g6oc-bad-key';
    const goodHash = 'g6oc-good-key';
    await insertGlobal({ createdAt: new Date(0), hashId: badHash, url: '../secret' });
    await insertGlobal({
      createdAt: new Date(1000),
      hashId: goodHash,
      url: `files/${goodHash}.txt`,
    });

    const summary = await runGlobalFileOrphanGc(db, {
      config: { ...liveConfig, batch: 1 },
      deleteObject: mocks.deleteFile,
    });

    expect(await findGlobal(badHash)).toBeDefined();
    expect(await findGlobal(goodHash)).toBeUndefined();
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFile).toHaveBeenCalledWith(`files/${goodHash}.txt`);
    expect(summary).toMatchObject({
      deletedObjects: 1,
      deletedRows: 1,
      failedObjects: 1,
    });
  });

  it('does not delete the row when url is empty', async () => {
    const hashId = 'g6oc-empty-url';
    await insertGlobal({ hashId, url: '' });

    const summary = await runGlobalFileOrphanGc(db, {
      config: liveConfig,
      deleteObject: mocks.deleteFile,
    });

    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(summary.failedObjects).toBe(1);
    expect(summary.deletedRows).toBe(0);
  });

  it('stops at the per-run cap and leaves the rest', async () => {
    await insertGlobal({
      createdAt: new Date(0),
      hashId: 'g6oc-cap-a',
      url: 'files/g6oc-cap-a.txt',
    });
    await insertGlobal({
      createdAt: new Date(1000),
      hashId: 'g6oc-cap-b',
      url: 'files/g6oc-cap-b.txt',
    });
    await insertGlobal({
      createdAt: new Date(2000),
      hashId: 'g6oc-cap-c',
      url: 'files/g6oc-cap-c.txt',
    });

    const summary = await runGlobalFileOrphanGc(db, {
      config: { ...liveConfig, batch: 1, cap: 2 },
      deleteObject: mocks.deleteFile,
    });

    expect(await findGlobal('g6oc-cap-a')).toBeUndefined();
    expect(await findGlobal('g6oc-cap-b')).toBeUndefined();
    expect(await findGlobal('g6oc-cap-c')).toBeDefined();
    expect(summary.deletedRows).toBe(2);
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2);
  });

  it('uses createFileS3().deleteFile when no deleter is injected', async () => {
    const hashId = 'g6oc-s3-client';
    const url = `files/${hashId}.txt`;
    await insertGlobal({ hashId, url });

    await runGlobalFileOrphanGc(db, { config: liveConfig });

    expect(mocks.createFileS3).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFile).toHaveBeenCalledWith(url);
    expect(await findGlobal(hashId)).toBeUndefined();
  });

  it('deletes nothing when object storage cannot be constructed', async () => {
    const hashId = 'g6oc-no-s3';
    await insertGlobal({ hashId, url: `files/${hashId}.txt` });
    mocks.createFileS3.mockRejectedValue(new Error('S3 environment variables are not set'));

    await expect(runGlobalFileOrphanGc(db, { config: liveConfig })).rejects.toThrow(
      'S3 environment variables are not set',
    );
    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('deletes nothing when the sweep is disabled', async () => {
    const hashId = 'g6oc-disabled';
    await insertGlobal({ hashId, url: `files/${hashId}.txt` });

    const summary = await runGlobalFileOrphanGc(db, {
      config: { ...liveConfig, enabled: false },
      deleteObject: mocks.deleteFile,
    });

    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.createFileS3).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ deletedObjects: 0, deletedRows: 0, scanned: 0 });
  });

  it('treats DRY_RUN=yes as a dry run', async () => {
    const hashId = 'g6oc-dry-yes';
    await insertGlobal({ hashId, size: 4, url: `files/${hashId}.txt` });

    const summary = await runGlobalFileOrphanGc(db, {
      deleteObject: mocks.deleteFile,
      env: { GLOBAL_FILE_ORPHAN_GC_DRY_RUN: 'yes' },
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.deletedRows).toBe(0);
    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('deletes a doubled-dot file name and leaves traversal and foreign prefixes', async () => {
    await insertGlobal({ createdAt: new Date(0), hashId: 'g6oc-dots', url: 'files/a..b.md' });
    await insertGlobal({ createdAt: new Date(1000), hashId: 'g6oc-trav', url: 'files/../secret' });
    await insertGlobal({
      createdAt: new Date(2000),
      hashId: 'g6oc-brand',
      url: 'branding/logo.png',
    });

    const summary = await runGlobalFileOrphanGc(db, {
      config: liveConfig,
      deleteObject: mocks.deleteFile,
    });

    expect(await findGlobal('g6oc-dots')).toBeUndefined();
    expect(await findGlobal('g6oc-trav')).toBeDefined();
    expect(await findGlobal('g6oc-brand')).toBeDefined();
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1);
    expect(mocks.deleteFile).toHaveBeenCalledWith('files/a..b.md');
    expect(summary).toMatchObject({ deletedObjects: 1, deletedRows: 1, failedObjects: 2 });
  });

  it('deletes a key under the configured S3 file prefix', async () => {
    const hashId = 'g6oc-prefix';
    const url = 'team-uploads/a.bin';
    await insertGlobal({ hashId, url });

    await runGlobalFileOrphanGc(db, {
      config: liveConfig,
      deleteObject: mocks.deleteFile,
      env: { NEXT_PUBLIC_S3_FILE_PATH: 'team-uploads' },
    });

    expect(await findGlobal(hashId)).toBeUndefined();
    expect(mocks.deleteFile).toHaveBeenCalledWith(url);
  });

  it('counts a lock timeout as skipped and still deletes the next row', async () => {
    await insertGlobal({ createdAt: new Date(0), hashId: 'g6oc-lock', url: 'files/g6oc-lock.txt' });
    await insertGlobal({
      createdAt: new Date(1000),
      hashId: 'g6oc-after-lock',
      url: 'files/g6oc-after-lock.txt',
    });

    const summary = await runGlobalFileOrphanGc(db, {
      beforeRow: async (row) => {
        if (row.hashId !== 'g6oc-lock') return;
        const error = new Error('canceling statement due to lock timeout');
        (error as { code?: string }).code = '55P03';
        throw error;
      },
      config: liveConfig,
      deleteObject: mocks.deleteFile,
    });

    expect(await findGlobal('g6oc-lock')).toBeDefined();
    expect(await findGlobal('g6oc-after-lock')).toBeUndefined();
    expect(mocks.deleteFile).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ deletedRows: 1, failedObjects: 0, skippedRaced: 1 });
  });

  it('counts an unexpected row error and continues', async () => {
    await insertGlobal({ createdAt: new Date(0), hashId: 'g6oc-boom', url: 'files/g6oc-boom.txt' });
    await insertGlobal({
      createdAt: new Date(1000),
      hashId: 'g6oc-after-boom',
      url: 'files/g6oc-after-boom.txt',
    });

    const summary = await runGlobalFileOrphanGc(db, {
      beforeRow: async (row) => {
        if (row.hashId === 'g6oc-boom') throw new Error('boom');
      },
      config: liveConfig,
      deleteObject: mocks.deleteFile,
    });

    expect(await findGlobal('g6oc-boom')).toBeDefined();
    expect(await findGlobal('g6oc-after-boom')).toBeUndefined();
    expect(summary).toMatchObject({ deletedRows: 1, failedObjects: 1, skippedRaced: 0 });
  });

  it('stops after examining five times the delete cap', async () => {
    for (let index = 0; index < GLOBAL_FILE_ORPHAN_GC_SCAN_FACTOR + 1; index += 1) {
      await insertGlobal({
        createdAt: new Date(index * 1000),
        hashId: `g6oc-scan-${index}`,
        url: `branding/g6oc-scan-${index}.png`,
      });
    }
    await insertGlobal({
      createdAt: new Date(10_000),
      hashId: 'g6oc-scan-ok',
      url: 'files/g6oc-scan-ok.txt',
    });

    const summary = await runGlobalFileOrphanGc(db, {
      config: { ...liveConfig, batch: 2, cap: 1 },
      deleteObject: mocks.deleteFile,
    });

    expect(summary.scanned).toBe(GLOBAL_FILE_ORPHAN_GC_SCAN_FACTOR);
    expect(summary.failedObjects).toBe(GLOBAL_FILE_ORPHAN_GC_SCAN_FACTOR);
    expect(summary.deletedRows).toBe(0);
    expect(await findGlobal('g6oc-scan-ok')).toBeDefined();
    expect(await findGlobal(`g6oc-scan-${GLOBAL_FILE_ORPHAN_GC_SCAN_FACTOR}`)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('counts a hung DeleteObject as an S3 failure and keeps the key', async () => {
    const hung = 'g6oc-timeout';
    const ok = 'g6oc-after-timeout';
    await insertGlobal({ createdAt: new Date(0), hashId: hung, url: `files/${hung}.txt` });
    await insertGlobal({ createdAt: new Date(1000), hashId: ok, size: 4, url: `files/${ok}.txt` });
    mocks.deleteFile.mockImplementation(async (url: string) => {
      if (url === `files/${hung}.txt`) await new Promise(() => undefined);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const summary = await runGlobalFileOrphanGc(db, {
      config: liveConfig,
      deleteObject: mocks.deleteFile,
      deleteTimeoutMs: 20,
    });

    expect(await findGlobal(hung)).toBeUndefined();
    expect(await findGlobal(ok)).toBeUndefined();
    expect(summary).toMatchObject({
      deletedObjects: 1,
      deletedRows: 2,
      failedObjects: 1,
      untrackedObjectKeys: [`files/${hung}.txt`],
    });
    expect(warn).toHaveBeenCalledWith('[global-file-orphan-gc] objects left after row delete', {
      keys: [`files/${hung}.txt`],
    });
    warn.mockRestore();
  });

  it('deletes nothing when GLOBAL_FILE_ORPHAN_GC=off', async () => {
    const hashId = 'g6oc-off';
    await insertGlobal({ hashId, url: `files/${hashId}.txt` });

    const summary = await runGlobalFileOrphanGc(db, {
      deleteObject: mocks.deleteFile,
      env: { GLOBAL_FILE_ORPHAN_GC: 'off' },
    });

    expect(summary.deletedRows).toBe(0);
    expect(await findGlobal(hashId)).toBeDefined();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('fails the job after five consecutive S3 failures and keeps later rows', async () => {
    const hashes = Array.from({ length: 6 }, (_, index) => `g6oc-outage-${index}`);
    for (const [index, hashId] of hashes.entries()) {
      await insertGlobal({
        createdAt: new Date(index * 1000),
        hashId,
        url: `files/${hashId}.txt`,
      });
    }
    mocks.deleteFile.mockRejectedValue(new Error('s3 down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runGlobalFileOrphanGc(db, { config: liveConfig, deleteObject: mocks.deleteFile }),
    ).rejects.toBeInstanceOf(GlobalFileOrphanGcS3OutageError);

    for (const hashId of hashes.slice(0, 5)) {
      expect(await findGlobal(hashId)).toBeUndefined();
    }
    expect(await findGlobal(hashes[5]!)).toBeDefined();
    expect(mocks.deleteFile).toHaveBeenCalledTimes(5);
    expect(errorSpy).toHaveBeenCalledWith(
      '[global-file-orphan-gc] stopped after consecutive S3 failures',
      { keys: hashes.slice(0, 5).map((hashId) => `files/${hashId}.txt`) },
    );
    errorSpy.mockRestore();
  });
});
