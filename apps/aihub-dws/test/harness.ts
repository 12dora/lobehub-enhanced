import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type RunningServer, type StartOptions, startServer } from '../src/server.ts';

export const TOKEN = 'b'.repeat(40);
export const PROFILE = 'dingcorp0123456789:012345678901234567';
export const FAKE_DWS = fileURLToPath(new URL('./fake-dws.mjs', import.meta.url));

export interface Invocation {
  argv: string[];
  cwd: string;
  env: Record<string, string | null>;
  envKeys: string[];
  hasBrokerToken: boolean;
  pid?: number;
  stdin: string;
  t: number;
}

export async function makeDirs(): Promise<{
  configDir: string;
  home: string;
  keychainDir: string;
  root: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aihub-dws-'));
  const configDir = path.join(root, 'config');
  const keychainDir = path.join(root, 'keychain');
  const home = path.join(root, 'home');
  return { configDir, home, keychainDir, root };
}

export async function writeControl(configDir: string, control: unknown): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'fake-control.json'), JSON.stringify(control));
}

export async function readInvocations(configDir: string): Promise<Invocation[]> {
  try {
    const text = await readFile(path.join(configDir, 'invocations.jsonl'), 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Invocation);
  } catch {
    return [];
  }
}

export function applyChildEnv(dirs: {
  configDir: string;
  home: string;
  keychainDir: string;
}): () => void {
  const keys = [
    'DWS_CONFIG_DIR',
    'DWS_KEYCHAIN_DIR',
    'HOME',
    'DWS_BROKER_TOKEN',
    'NOT_FOR_CHILD',
    'HTTP_PROXY',
    'DINGTALK_DWS_AGENTCODE',
    'TZ',
  ] as const;
  const previous = new Map<string, string | undefined>();
  for (const key of keys) previous.set(key, process.env[key]);
  process.env.DWS_CONFIG_DIR = dirs.configDir;
  process.env.DWS_KEYCHAIN_DIR = dirs.keychainDir;
  process.env.HOME = dirs.home;
  process.env.DWS_BROKER_TOKEN = TOKEN;
  process.env.NOT_FOR_CHILD = 'leak';
  process.env.TZ = 'Asia/Shanghai';
  process.env.HTTP_PROXY = 'http://127.0.0.1:9';
  process.env.DINGTALK_DWS_AGENTCODE = 'aihub';
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export async function boot(
  control: unknown = { profiles: [PROFILE] },
  overrides: Partial<StartOptions> = {},
): Promise<{ close: () => Promise<void>; configDir: string; server: RunningServer }> {
  const dirs = await makeDirs();
  await writeControl(dirs.configDir, control);
  const restore = applyChildEnv(dirs);
  const server = await startServer({
    bin: FAKE_DWS,
    cacheMs: 0,
    configDir: dirs.configDir,
    home: dirs.home,
    keychainDir: dirs.keychainDir,
    loginChildTimeoutMs: 4_000,
    port: 0,
    queueTimeoutMs: 1_000,
    readyTimeoutMs: 800,
    token: TOKEN,
    versionTimeoutMs: 3_000,
    ...overrides,
  });
  return {
    configDir: dirs.configDir,
    server,
    async close() {
      await server.close();
      restore();
      await rm(dirs.root, { force: true, recursive: true });
    },
  };
}

export async function api(
  server: RunningServer,
  method: string,
  pathname: string,
  body?: unknown,
  token: string | null = TOKEN,
): Promise<{ json: unknown; status: number }> {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  let payload: string | undefined;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${server.url}${pathname}`, { body: payload, headers, method });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { json, status: response.status };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
