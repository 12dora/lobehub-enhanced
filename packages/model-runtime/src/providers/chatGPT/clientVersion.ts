import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';
import { gt, valid } from 'semver';

/**
 * Codex gates both its model list and protocol flags by client_version. Track
 * the real latest CLI release, not a fake huge version that opts into unknown protocols.
 */
export const CODEX_CLIENT_VERSION = '0.153.4';
const CACHE_TTL = 6 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT = 5000;
const log = debug('lobe-model-runtime:chatgpt:client-version');
type Source = 'env' | 'npm' | 'github' | 'floor';
interface Resolution {
  source: Source;
  version: string;
}
let cached: (Resolution & { expiresAt: number }) | undefined;
let inFlight: Promise<Resolution> | undefined;
const loggedFailures = new Set<string>();

const logFailureOnce = (source: string) => {
  if (loggedFailures.has(source)) return;
  loggedFailures.add(source);
  log('%s version lookup failed or returned invalid semver; trying fallback', source);
};

const parseVersion = (value: unknown): string | undefined =>
  typeof value === 'string' ? (valid(value, { loose: false }) ?? undefined) : undefined;

const withFloor = (version: string, source: Source): Resolution =>
  gt(CODEX_CLIENT_VERSION, version)
    ? { source: 'floor', version: CODEX_CLIENT_VERSION }
    : { source, version };

const lookup = async (source: 'npm' | 'github'): Promise<string | undefined> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Race the whole lookup (including JSON decoding), even if a fetch shim ignores abort.
    return await Promise.race([
      (async () => {
        const response = await fetch(
          source === 'npm'
            ? 'https://registry.npmjs.org/@openai/codex/latest'
            : 'https://api.github.com/repos/openai/codex/releases/latest',
          {
            headers: { 'Accept': 'application/json', 'User-Agent': 'LobeHub-Codex-Catalog' },
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error('Version lookup HTTP failure');
        const payload: unknown = await response.json();
        const raw = isRecord(payload)
          ? source === 'npm'
            ? payload.version
            : typeof payload.tag_name === 'string' && payload.tag_name.startsWith('rust-v')
              ? payload.tag_name.slice(6)
              : undefined
          : undefined;
        const version = parseVersion(raw);
        if (!version) throw new Error('Invalid CLI version');
        return version;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Version lookup timed out'));
        }, LOOKUP_TIMEOUT);
      }),
    ]);
  } catch {
    logFailureOnce(source);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

const resolveRemote = async (): Promise<Resolution> => {
  for (const source of ['npm', 'github'] as const) {
    const version = await lookup(source);
    if (version) return withFloor(version, source);
  }
  return { source: 'floor', version: CODEX_CLIENT_VERSION };
};

/** Never throws; remote discovery costs at most two five-second lookups. */
export const resolveCodexClientVersion = async (): Promise<string> => {
  let resolved: Resolution;
  const override = process.env.CHATGPT_CODEX_CLIENT_VERSION;
  const envVersion = parseVersion(override);
  if (envVersion) {
    resolved = withFloor(envVersion, 'env');
  } else {
    if (override) logFailureOnce('env');
    if (cached && cached.expiresAt > Date.now()) {
      resolved = cached;
    } else {
      inFlight ??= (async () => {
        try {
          const result = await resolveRemote();
          cached = { ...result, expiresAt: Date.now() + CACHE_TTL };
          return result;
        } finally {
          inFlight = undefined;
        }
      })();
      resolved = await inFlight;
    }
  }
  log('Codex client_version=%s source=%s', resolved.version, resolved.source);
  return resolved.version;
};
