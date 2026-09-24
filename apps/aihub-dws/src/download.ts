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
  code: 'API_ERROR' | 'FILE_TOO_LARGE' | 'INTERNAL' | 'VALIDATION',
  message: string,
  exitCode?: number,
): ExecResult {
  return {
    error: { code, exitCode, message },
    ok: false,
  };
}

/** Model-facing copy when dws refuses an axls / alidoc node. */
export const ONLINE_NODE_MESSAGE =
  '该节点是在线表格或在线文档，不能直接下载。在线表格请用 readSheet，在线文档请用 readDoc。';

const ONLINE_NODE = /axls|alidoc|钉钉表格|在线表格|钉钉文档|在线文档/i;

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pathFrom(record: Record<string, unknown>): string | undefined {
  return stringField(record, 'localPath') ?? stringField(record, 'savedPath');
}

/** Chat downloads use top-level localPath. Drive downloads use data.savedPath. */
function resolveDownloadPath(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  const direct = pathFrom(record);
  if (direct) return direct;
  const nested = record.data;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return undefined;
  return pathFrom(nested as Record<string, unknown>);
}

function remapOnlineNode(result: ExecResult): ExecResult {
  if (result.ok) return result;
  if (result.error.code !== 'API_ERROR' || result.error.exitCode !== 1) return result;
  if (!ONLINE_NODE.test(result.error.message)) return result;
  return fail('VALIDATION', ONLINE_NODE_MESSAGE, 1);
}

export async function runDownload(
  runner: Runner,
  request: {
    argv: string[];
    op: string;
    profile: string;
    signal?: AbortSignal;
    timeoutMs: number;
  },
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
    // axls / alidoc is a drive node. chat.downloadFile keeps the upstream error.
    if (!mapped.ok) {
      return {
        result: request.op === 'drive.download' ? remapOnlineNode(mapped) : mapped,
        run,
      };
    }
    const data = 'data' in mapped ? mapped.data : undefined;
    const localPath = resolveDownloadPath(data);
    if (!localPath) {
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
