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
import { runDownload } from './download.ts';
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
      { argv: prepared.argv, profile: PROFILE, timeoutMs: prepared.timeoutMs },
      16,
    );
    expect(oversized.result).toMatchObject({ error: { code: 'FILE_TOO_LARGE' }, ok: false });
    const bigCalls = await readInvocations(big.dirs.configDir);
    const bigCall = bigCalls.find((item) => item.argv.includes('+messages-resource-download'));
    await expect(access(bigCall?.cwd ?? '')).rejects.toThrow();

    const escaped = await open({ download: { action: 'escape' } });
    const bad = await runDownload(escaped.runner, {
      argv: prepared.argv,
      profile: PROFILE,
      timeoutMs: prepared.timeoutMs,
    });
    expect(bad.result).toMatchObject({ error: { code: 'API_ERROR' }, ok: false });
  });
});
