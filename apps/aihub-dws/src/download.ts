import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { MAX_FILE_BYTES } from './constants.ts';
import { QueueTimeoutError } from './errors.ts';
import type { Runner } from './runner.ts';
import { toExecResult } from './runner.ts';
import type { ExecResult, RunResult } from './types.ts';

function fail(
  code: 'API_ERROR' | 'FILE_TOO_LARGE' | 'INTERNAL',
  message: string,
  exitCode?: number,
): ExecResult {
  return {
    error: { code, exitCode, message },
    ok: false,
  };
}

export async function runDownload(
  runner: Runner,
  request: { argv: string[]; profile: string; signal?: AbortSignal; timeoutMs: number },
  maxBytes = MAX_FILE_BYTES,
): Promise<{ result: ExecResult; run?: RunResult }> {
  const dir = path.join(os.tmpdir(), 'dws-dl', randomUUID());
  const started = Date.now();
  try {
    await mkdir(path.join(dir, 'files'), { recursive: true, mode: 0o700 });
    let run: RunResult;
    try {
      run = await runner.run({
        argv: request.argv,
        cwd: dir,
        profile: request.profile,
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });
    } catch (error) {
      if (error instanceof QueueTimeoutError) throw error;
      throw error;
    }
    const mapped = toExecResult(run);
    if (!mapped.ok) return { result: mapped, run };
    const data = 'data' in mapped ? mapped.data : undefined;
    const localPath =
      data && typeof data === 'object' ? (data as { localPath?: unknown }).localPath : undefined;
    if (typeof localPath !== 'string' || localPath.length === 0) {
      return { result: fail('API_ERROR', '下载结果缺少文件路径', 0), run };
    }
    const root = path.resolve(dir);
    const full = path.resolve(dir, localPath);
    const relative = path.relative(root, full);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
      return { result: fail('API_ERROR', '下载路径不合法', 0), run };
    }
    let info;
    try {
      info = await stat(full);
    } catch {
      return { result: fail('API_ERROR', '下载文件不存在', 0), run };
    }
    if (!info.isFile()) return { result: fail('API_ERROR', '下载文件不存在', 0), run };
    if (info.size > maxBytes) return { result: fail('FILE_TOO_LARGE', '文件超过 20MB', 0), run };
    const bytes = await readFile(full);
    if (bytes.length > maxBytes) return { result: fail('FILE_TOO_LARGE', '文件超过 20MB', 0), run };
    return {
      result: {
        durationMs: Date.now() - started,
        file: {
          contentBase64: bytes.toString('base64'),
          name: path.basename(full),
          sizeBytes: bytes.length,
        },
        ok: true,
      },
      run,
    };
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}
