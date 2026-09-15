/**
 * DingTalk 免登 (SSO) bridge — the transport half.
 *
 * Kept free of React so the whole state machine can be driven in a test: every side effect
 * (script loading, the `dd` global, `fetch`) is injected. The page component owns only the
 * timeout and the final `location.replace`.
 */

export const DINGTALK_JSAPI_SRC =
  'https://g.alicdn.com/dingding/dingtalk-jsapi/3.0.34/dingtalk.open.js';

/** Past this the bridge stops waiting on DingTalk and hands the user to the normal login. */
export const DINGTALK_SSO_TIMEOUT_MS = 8000;

export const DINGTALK_SSO_CONFIG_ENDPOINT = '/api/auth/dingtalk/sso/config';
export const DINGTALK_SSO_EXCHANGE_ENDPOINT = '/api/auth/dingtalk/sso';

export interface DingTalkAuthCodeResult {
  code: string;
}

/** The slice of the DingTalk JSAPI this bridge uses. */
export interface DingTalkJsApi {
  env?: { platform?: string };
  runtime?: {
    permission?: {
      requestAuthCode?: (options: {
        corpId: string;
        onFail?: (error: unknown) => void;
        onSuccess?: (result: DingTalkAuthCodeResult) => void;
      }) => void;
    };
  };
}

export interface DingTalkSsoOutcome {
  /** Always a same-origin path; safe to hand to `location.replace`. */
  redirect: string;
  status: 'signed-in' | 'fallback';
}

export interface DingTalkSsoDeps {
  fetchImpl?: typeof fetch;
  getDd?: () => DingTalkJsApi | undefined;
  loadScript?: (src: string) => Promise<void>;
  /** Already-sanitised fallback target. */
  redirect: string;
}

/**
 * Only a same-origin *path* may be handed back to the browser: the value arrives from a query
 * string (and, after the exchange, from the server), so a `//evil.example` or `https://…` would
 * otherwise turn this bridge into an open redirect.
 *
 * Keep this in lock-step with server `isSafeDingTalkSsoRedirect`: decode first, reject `//`,
 * backslash, CR/LF, and a scheme that only appears after decode (`/%2f%2fevil`).
 */
export const sanitizeRedirect = (raw: string | null | undefined): string => {
  if (typeof raw !== 'string') return '/';
  const value = raw.trim();
  if (value.length === 0 || value.length > 2048) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (/[\0\r\n]/.test(value)) return '/';
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || decoded.includes('\\')) return '/';
    if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return '/';
  } catch {
    return '/';
  }
  return value;
};

/** Reads `?redirect=` off a full URL or search string. */
export const readRedirectParam = (search: string): string => {
  try {
    return sanitizeRedirect(new URLSearchParams(search).get('redirect'));
  } catch {
    return '/';
  }
};

const defaultLoadScript = (src: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('script_error')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.src = src;
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true';
        resolve();
      },
      { once: true },
    );
    script.addEventListener('error', () => reject(new Error('script_error')), { once: true });
    document.head.append(script);
  });

const defaultGetDd = (): DingTalkJsApi | undefined =>
  (globalThis as { dd?: DingTalkJsApi }).dd ?? undefined;

const requestAuthCode = (dd: DingTalkJsApi, corpId: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const request = dd.runtime?.permission?.requestAuthCode;
    if (typeof request !== 'function') {
      reject(new Error('jsapi_unavailable'));
      return;
    }

    let settled = false;
    request({
      corpId,
      onFail: (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error('request_auth_code_failed'));
      },
      onSuccess: (result) => {
        if (settled) return;
        settled = true;
        const code = typeof result?.code === 'string' ? result.code : '';
        if (code.length === 0) reject(new Error('empty_auth_code'));
        else resolve(code);
      },
    });
  });

/**
 * Runs the bridge once. Never throws: every failure mode (not inside DingTalk, connector off,
 * JSAPI refusal, exchange rejected) ends as a `fallback` outcome pointing at the original target,
 * where the normal login flow takes over.
 */
export const runDingTalkSso = async ({
  fetchImpl,
  getDd = defaultGetDd,
  loadScript = defaultLoadScript,
  redirect,
}: DingTalkSsoDeps): Promise<DingTalkSsoOutcome> => {
  const doFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const fallback: DingTalkSsoOutcome = { redirect, status: 'fallback' };

  try {
    await loadScript(DINGTALK_JSAPI_SRC);
  } catch {
    return fallback;
  }

  const dd = getDd();
  // Outside the DingTalk client there is no identity to borrow — go straight to the login page.
  if (!dd || dd.env?.platform === 'notInDingTalk') return fallback;

  if (!doFetch) return fallback;

  let corpId: string;
  try {
    const response = await doFetch(DINGTALK_SSO_CONFIG_ENDPOINT, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return fallback;
    const config = (await response.json()) as { corpId?: string | null; enabled?: boolean };
    if (!config?.enabled || !config.corpId) return fallback;
    corpId = config.corpId;
  } catch {
    return fallback;
  }

  let code: string;
  try {
    code = await requestAuthCode(dd, corpId);
  } catch {
    return fallback;
  }

  try {
    const response = await doFetch(DINGTALK_SSO_EXCHANGE_ENDPOINT, {
      body: JSON.stringify({ code, redirect }),
      headers: { 'accept': 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });
    const result = (await response.json().catch(() => null)) as {
      ok?: boolean;
      reason?: string;
      redirect?: string | null;
    } | null;
    // Server rejected the redirect itself — do not `location.replace` the original query value.
    if (response.status === 400 && result?.reason === 'bad_redirect') {
      return { redirect: '/', status: 'fallback' };
    }
    if (!response.ok) return fallback;
    if (!result?.ok) return fallback;
    // The server echoes the target back; it is still re-checked here because this value is what
    // the browser is about to navigate to.
    return { redirect: sanitizeRedirect(result.redirect ?? redirect), status: 'signed-in' };
  } catch {
    return fallback;
  }
};
