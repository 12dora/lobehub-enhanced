import { access, rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyChildEnv,
  FAKE_DWS,
  makeDirs,
  PROFILE,
  readInvocations,
  writeControl,
} from '../test/harness.ts';
import { ONLINE_NODE_MESSAGE, runDownload } from './download.ts';
import { prepareExec } from './ops.ts';
import { createRunner } from './runner.ts';

describe('download', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  async function open(control: unknown) {
    const dirs = await makeDirs();
    await writeControl(dirs.configDir, control);
    const restore = applyChildEnv(dirs);
    const runner = createRunner({ bin: FAKE_DWS, queueTimeoutMs: 2_000 });
    cleanups.push(async () => {
      runner.close();
      restore();
      await rm(dirs.root, { force: true, recursive: true });
    });
    return { dirs, runner };
  }

  it('returns the file and always removes the temp dir', async () => {
    const { dirs, runner } = await open({ download: { name: '报表.xlsx' }, profiles: [PROFILE] });
    const prepared = prepareExec('chat.downloadFile', PROFILE, {
      resourceId: 'res1',
      resourceType: 'fileId',
    });
    const downloaded = await runDownload(runner, {
      argv: prepared.argv,
      op: 'chat.downloadFile',
      profile: PROFILE,
      timeoutMs: prepared.timeoutMs,
    });
    expect(downloaded.result.ok).toBe(true);
    if (!downloaded.result.ok || !('file' in downloaded.result)) throw new Error('expected file');
    expect(downloaded.result.file.name).toBe('报表.xlsx');
    expect(Buffer.from(downloaded.result.file.contentBase64, 'base64').toString('utf8')).toBe(
      'hello-dws',
    );
    const calls = await readInvocations(dirs.configDir);
    const call = calls.find((item) => item.argv.includes('+messages-resource-download'));
    expect(call?.cwd).toBeTruthy();
    await expect(access(call?.cwd ?? '')).rejects.toThrow();
  });

  it('rejects files over the cap and path escape', async () => {
    const big = await open({ download: { bytes: 64 } });
    const prepared = prepareExec('chat.downloadFile', PROFILE, {
      resourceId: 'res1',
      resourceType: 'mediaId',
    });
    const oversized = await runDownload(
      big.runner,
      {
        argv: prepared.argv,
        op: 'chat.downloadFile',
        profile: PROFILE,
        timeoutMs: prepared.timeoutMs,
      },
      16,
    );
    expect(oversized.result).toMatchObject({ error: { code: 'FILE_TOO_LARGE' }, ok: false });
    const bigCalls = await readInvocations(big.dirs.configDir);
    const bigCall = bigCalls.find((item) => item.argv.includes('+messages-resource-download'));
    await expect(access(bigCall?.cwd ?? '')).rejects.toThrow();

    const escaped = await open({ download: { action: 'escape' } });
    const bad = await runDownload(escaped.runner, {
      argv: prepared.argv,
      op: 'chat.downloadFile',
      profile: PROFILE,
      timeoutMs: prepared.timeoutMs,
    });
    expect(bad.result).toMatchObject({ error: { code: 'API_ERROR' }, ok: false });
  });

  it('reads drive savedPath inside the temp dir and caps the file', async () => {
    const { dirs, runner } = await open({ download: { name: '库存.xlsx' }, profiles: [PROFILE] });
    const prepared = prepareExec('drive.download', PROFILE, { nodeId: 'node-1' });
    const downloaded = await runDownload(runner, {
      argv: prepared.argv,
      op: 'drive.download',
      profile: PROFILE,
      timeoutMs: prepared.timeoutMs,
    });
    expect(downloaded.result.ok).toBe(true);
    if (!downloaded.result.ok || !('file' in downloaded.result)) throw new Error('expected file');
    expect(downloaded.result.file.name).toBe('库存.xlsx');
    expect(Buffer.from(downloaded.result.file.contentBase64, 'base64').toString('utf8')).toBe(
      'hello-dws',
    );
    const calls = await readInvocations(dirs.configDir);
    const call = calls.find((item) => item.argv.includes('+download'));
    expect(call?.argv).toContain('--output=./files/');
    expect(call?.cwd).toBeTruthy();
    await expect(access(call?.cwd ?? '')).rejects.toThrow();

    const oversized = await open({ download: { bytes: 64 } });
    const tooBig = await runDownload(
      oversized.runner,
      {
        argv: prepared.argv,
        op: 'drive.download',
        profile: PROFILE,
        timeoutMs: prepared.timeoutMs,
      },
      16,
    );
    expect(tooBig.result).toMatchObject({ error: { code: 'FILE_TOO_LARGE' }, ok: false });
  });

  it('rejects a savedPath outside the temp dir and a missing path', async () => {
    const prepared = prepareExec('drive.download', PROFILE, { nodeId: 'node-1' });
    const escaped = await open({ download: { action: 'escape' } });
    const bad = await runDownload(escaped.runner, {
      argv: prepared.argv,
      op: 'drive.download',
      profile: PROFILE,
      timeoutMs: prepared.timeoutMs,
    });
    expect(bad.result).toMatchObject({
      error: { code: 'API_ERROR', message: '下载路径不合法' },
      ok: false,
    });

    const absolute = await open({ download: { action: 'absolute' } });
    const outside = await runDownload(absolute.runner, {
      argv: prepared.argv,
      op: 'drive.download',
      profile: PROFILE,
      timeoutMs: prepared.timeoutMs,
    });
    expect(outside.result).toMatchObject({ error: { code: 'API_ERROR' }, ok: false });

    const missing = await open({ download: { action: 'nopath' } });
    const none = await runDownload(missing.runner, {
      argv: prepared.argv,
      op: 'drive.download',
      profile: PROFILE,
      timeoutMs: prepared.timeoutMs,
    });
    expect(none.result).toMatchObject({
      error: { code: 'API_ERROR', message: '下载结果缺少文件路径' },
      ok: false,
    });
  });

  it('maps an online sheet or doc node to a validation error only for drive.download', async () => {
    const prepared = prepareExec('drive.download', PROFILE, { nodeId: 'node-1' });
    const sheet = await open({ download: { action: 'axls' } });
    const axls = await runDownload(sheet.runner, {
      argv: prepared.argv,
      op: 'drive.download',
      profile: PROFILE,
      timeoutMs: prepared.timeoutMs,
    });
    expect(axls.result).toMatchObject({
      error: { code: 'VALIDATION', exitCode: 1, message: ONLINE_NODE_MESSAGE },
      ok: false,
    });

    const doc = await open({ download: { action: 'alidoc' } });
    const alidoc = await runDownload(doc.runner, {
      argv: prepared.argv,
      op: 'drive.download',
      profile: PROFILE,
      timeoutMs: prepared.timeoutMs,
    });
    expect(alidoc.result).toMatchObject({
      error: { code: 'VALIDATION', message: ONLINE_NODE_MESSAGE },
      ok: false,
    });

    const chat = prepareExec('chat.downloadFile', PROFILE, {
      resourceId: 'res1',
      resourceType: 'fileId',
    });
    const chatSheet = await open({ download: { action: 'axls' } });
    const chatAxls = await runDownload(chatSheet.runner, {
      argv: chat.argv,
      op: 'chat.downloadFile',
      profile: PROFILE,
      timeoutMs: chat.timeoutMs,
    });
    expect(chatAxls.result).toMatchObject({ error: { code: 'API_ERROR', exitCode: 1 }, ok: false });
    if (chatAxls.result.ok) throw new Error('expected error');
    expect(chatAxls.result.error.message).toContain('axls');
    expect(chatAxls.result.error.message).not.toBe(ONLINE_NODE_MESSAGE);

    const chatDoc = await open({ download: { action: 'alidoc' } });
    const chatAlidoc = await runDownload(chatDoc.runner, {
      argv: chat.argv,
      op: 'chat.downloadFile',
      profile: PROFILE,
      timeoutMs: chat.timeoutMs,
    });
    expect(chatAlidoc.result).toMatchObject({ error: { code: 'API_ERROR' }, ok: false });
    if (chatAlidoc.result.ok) throw new Error('expected error');
    expect(chatAlidoc.result.error.message).toContain('alidoc');
    expect(chatAlidoc.result.error.message).not.toBe(ONLINE_NODE_MESSAGE);

    const other = await open({ download: { action: 'fail' } });
    const failed = await runDownload(other.runner, {
      argv: prepared.argv,
      op: 'drive.download',
      profile: PROFILE,
      timeoutMs: prepared.timeoutMs,
    });
    expect(failed.result).toMatchObject({ error: { code: 'API_ERROR' }, ok: false });
    if (failed.result.ok) throw new Error('expected error');
    expect(failed.result.error.message).not.toBe(ONLINE_NODE_MESSAGE);
  });
});
