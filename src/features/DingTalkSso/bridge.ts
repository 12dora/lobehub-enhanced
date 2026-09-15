/**
 * DingTalk 免登 (SSO) bridge — the transport half.
 *
 * Kept free of React so the whole state machine can be driven in a test: every side effect
 * (script loading, the `dd` global, `fetch`, the diagnostic beacon) is injected. The page
 * component owns only the overall timeout and the final `location.replace`.
 */

export const DINGTALK_JSAPI_SRC =
  'https://g.alicdn.com/dingding/dingtalk-jsapi/3.0.34/dingtalk.open.js';

/** Past this the bridge stops waiting on DingTalk and hands the user to the normal login. */
export const DINGTALK_SSO_TIMEOUT_MS = 8000;

/**
 * How long `dd.ready` may take. Deliberately inside the 8 s overall budget so a JSAPI that never
 * initialises is reported as `ready_timeout` (actionable) rather than as the page-level `timeout`.
 */
export const DINGTALK_SSO_READY_TIMEOUT_MS = 5000;

export const DINGTALK_SSO_CONFIG_ENDPOINT = '/api/auth/dingtalk/sso/config';
export const DINGTALK_SSO_EXCHANGE_ENDPOINT = '/api/auth/dingtalk/sso';
export const DINGTALK_SSO_DIAG_ENDPOINT = '/api/auth/dingtalk/sso/diag';

/** Longest field the diag route keeps; trimmed here too so the beacon stays small. */
const DIAG_FIELD_MAX = 200;

export interface DingTalkAuthCodeResult {
  code?: string;
}

/** Which JSAPI produced (or failed to produce) the auth code. */
export type DingTalkSsoJsApiName = 'getAuthCode' | 'requestAuthCode';

/**
 * Every point the flow can stop at. Sent to the server as a plain string so a build of the page
 * that is newer than the server still logs something useful.
 *
 * `timeout` and `page_error` are raised by the page component, the rest by this module.
 */
export type DingTalkSsoStage =
  | 'authcode_failed'
  | 'config_disabled'
  | 'config_failed'
  | 'exchange_failed'
  | 'not_in_dingtalk'
  | 'page_error'
  | 'ready_timeout'
  | 'script_load_failed'
  | 'success'
  | 'timeout';

export interface DingTalkSsoDiag {
  jsapi?: DingTalkSsoJsApiName;
  message?: string;
  platform?: string;
  stage: DingTalkSsoStage;
}

export type DingTalkSsoDiagSender = (diag: DingTalkSsoDiag) => void;

/** The slice of the DingTalk JSAPI this bridge uses. */
export interface DingTalkJsApi {
  env?: { platform?: string };
  /** Unified JSAPI (3.x): resolves with `{ code }`, or answers through the callbacks. */
  getAuthCode?: (options: {
    corpId: string;
    onFail?: (error: unknown) => void;
    onSuccess?: (result: DingTalkAuthCodeResult | string) => void;
  }) => PromiseLike<DingTalkAuthCodeResult | string> | undefined | void;
  /** Fires once the container has finished handing the JSAPI its bridge. */
  ready?: (callback: () => void) => void;
  runtime?: {
    permission?: {
      requestAuthCode?: (options: {
        corpId: string;
        onFail?: (error: unknown) => void;
        onSuccess?: (result: DingTalkAuthCodeResult | string) => void;
      }) => void;
    };
  };
}

export interface DingTalkSsoOutcome {
  /** Always a same-origin path; safe to hand to `location.replace`. */
  redirect: string;
  /** `success` on a signed-in outcome, otherwise the step that gave up. */
  stage: DingTalkSsoStage;
  status: 'signed-in' | 'fallback';
}

export interface DingTalkSsoDeps {
  fetchImpl?: typeof fetch;
  getDd?: () => DingTalkJsApi | undefined;
  loadScript?: (src: string) => Promise<void>;
  readyTimeoutMs?: number;
  /** Already-sanitised fallback target. */
  redirect: string;
  sendDiag?: DingTalkSsoDiagSender;
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

/** `dd.env.platform` when the JSAPI is already on the page — for beacons raised outside the run. */
export const readDingTalkPlatform = (): string | undefined => {
  try {
    return defaultGetDd()?.env?.platform;
  } catch {
    return undefined;
  }
};

const truncate = (value: string): string =>
  value.length > DIAG_FIELD_MAX ? value.slice(0, DIAG_FIELD_MAX) : value;

/**
 * Turns whatever the JSAPI rejected with into one short line. DingTalk answers `onFail` with
 * `{ errorCode, errorMessage }`, which is the single most useful thing to get into the server log.
 */
const describeError = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error instanceof Error) return error.message || fallback;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const code = record.errorCode ?? record.errcode ?? record.code;
    const message = record.errorMessage ?? record.errorMsg ?? record.errmsg ?? record.message;
    const parts = [code, message]
      .filter((part) => typeof part === 'string' || typeof part === 'number')
      .map((part) => String(part));
    if (parts.length > 0) return parts.join(': ');
    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }
  return fallback;
};

/**
 * Fire-and-forget diagnostic beacon. Never throws, never awaited, never carries the auth code:
 * the page must keep navigating even when this request cannot be made at all.
 */
export const sendDingTalkSsoDiag = (diag: DingTalkSsoDiag, fetchImpl?: typeof fetch): void => {
  try {
    const doFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (!doFetch) return;
    const body = JSON.stringify({
      jsapi: diag.jsapi,
      message: diag.message === undefined ? undefined : truncate(diag.message),
      platform: diag.platform === undefined ? undefined : truncate(diag.platform),
      stage: truncate(diag.stage),
    });
    const sent = doFetch(DINGTALK_SSO_DIAG_ENDPOINT, {
      body,
      headers: { 'content-type': 'application/json' },
      // The page is about to `location.replace`; without this the request dies with the document.
      keepalive: true,
      method: 'POST',
    }) as Promise<unknown> | undefined;
    void Promise.resolve(sent).catch(() => {});
  } catch {
    /* diagnostics must never break the login flow */
  }
};

const extractCode = (result: DingTalkAuthCodeResult | string | undefined): string => {
  if (typeof result === 'string') return result;
  return typeof result?.code === 'string' ? result.code : '';
};

/** Shared settle logic for both JSAPI shapes. */
const deferredAuthCode = () => {
  let settled = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const promise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  return {
    onFail: (error: unknown) => {
      if (settled) return;
      settled = true;
      rejectCode(new Error(describeError(error, 'request_auth_code_failed')));
    },
    onSuccess: (result: DingTalkAuthCodeResult | string | undefined) => {
      if (settled) return;
      settled = true;
      const code = extractCode(result);
      if (code.length === 0) rejectCode(new Error('empty_auth_code'));
      else resolveCode(code);
    },
    promise,
  };
};

/**
 * The unified 3.x entry point. Returns `undefined` when this container has no `getAuthCode` (or
 * when calling it throws synchronously), which is the caller's signal to try the legacy JSAPI.
 */
const callGetAuthCode = (dd: DingTalkJsApi, corpId: string): Promise<string> | undefined => {
  const getAuthCode = dd.getAuthCode;
  if (typeof getAuthCode !== 'function') return undefined;

  const { onFail, onSuccess, promise } = deferredAuthCode();

  let returned: PromiseLike<DingTalkAuthCodeResult | string> | undefined | void;
  try {
    returned = getAuthCode.call(dd, { corpId, onFail, onSuccess });
  } catch {
    // A container that only pretends to expose `getAuthCode` — fall back rather than give up.
    return undefined;
  }

  if (returned && typeof (returned as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(returned).then(onSuccess, onFail);
  }

  return promise;
};

/** The legacy `dd.runtime.permission.requestAuthCode`, callbacks only. */
const callRequestAuthCode = (dd: DingTalkJsApi, corpId: string): Promise<string> => {
  const request = dd.runtime?.permission?.requestAuthCode;
  if (typeof request !== 'function') return Promise.reject(new Error('jsapi_unavailable'));

  const { onFail, onSuccess, promise } = deferredAuthCode();
  try {
    request({ corpId, onFail, onSuccess });
  } catch (error) {
    onFail(error);
  }
  return promise;
};

/**
 * `dd.ready` is what actually gates the JSAPI inside the work-platform container: calling
 * `getAuthCode` before it fires silently answers nothing. An older build without `dd.ready`
 * is treated as already ready.
 */
const waitForReady = (dd: DingTalkJsApi, timeoutMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const ready = dd.ready;
    if (typeof ready !== 'function') {
      resolve();
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('ready_not_fired'));
    }, timeoutMs);

    try {
      ready.call(dd, () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(describeError(error, 'ready_threw')));
    }
  });

/**
 * Runs the bridge once. Never throws: every failure mode (not inside DingTalk, connector off,
 * JSAPI refusal, exchange rejected) ends as a `fallback` outcome pointing at the original target,
 * where the normal login flow takes over. Every one of those, and the success, also sends one
 * diagnostic beacon — the only way to see from the server why a real device gave up.
 */
export const runDingTalkSso = async ({
  fetchImpl,
  getDd = defaultGetDd,
  loadScript = defaultLoadScript,
  readyTimeoutMs = DINGTALK_SSO_READY_TIMEOUT_MS,
  redirect,
  sendDiag = sendDingTalkSsoDiag,
}: DingTalkSsoDeps): Promise<DingTalkSsoOutcome> => {
  const doFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);

  // Mutable because both are only known part-way through the run, and every beacon wants them.
  const seen: { jsapi?: DingTalkSsoJsApiName; platform?: string } = {};

  const diag = (stage: DingTalkSsoStage, message?: string) => {
    sendDiag({ jsapi: seen.jsapi, message, platform: seen.platform, stage });
  };

  const giveUp = (stage: DingTalkSsoStage, message?: string): DingTalkSsoOutcome => {
    diag(stage, message);
    return { redirect, stage, status: 'fallback' };
  };

  try {
    await loadScript(DINGTALK_JSAPI_SRC);
  } catch (error) {
    return giveUp('script_load_failed', describeError(error, 'script_error'));
  }

  const dd = getDd();
  seen.platform = dd?.env?.platform;
  // Outside the DingTalk client there is no identity to borrow — go straight to the login page.
  if (!dd || seen.platform === 'notInDingTalk') {
    return giveUp('not_in_dingtalk', dd ? undefined : 'no_dd_global');
  }

  if (!doFetch) return giveUp('config_failed', 'fetch_unavailable');

  let corpId: string;
  try {
    const response = await doFetch(DINGTALK_SSO_CONFIG_ENDPOINT, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return giveUp('config_failed', `http_${response.status}`);
    const config = (await response.json()) as { corpId?: string | null; enabled?: boolean };
    if (!config?.enabled) return giveUp('config_disabled', 'disabled');
    if (!config.corpId) return giveUp('config_disabled', 'no_corp_id');
    corpId = config.corpId;
  } catch (error) {
    return giveUp('config_failed', describeError(error, 'config_error'));
  }

  try {
    await waitForReady(dd, readyTimeoutMs);
  } catch (error) {
    return giveUp('ready_timeout', describeError(error, 'ready_not_fired'));
  }

  let code: string;
  try {
    const unified = callGetAuthCode(dd, corpId);
    seen.jsapi = unified ? 'getAuthCode' : 'requestAuthCode';
    code = await (unified ?? callRequestAuthCode(dd, corpId));
  } catch (error) {
    return giveUp('authcode_failed', describeError(error, 'request_auth_code_failed'));
  }

  try {
    const response = await doFetch(DINGTALK_SSO_EXCHANGE_ENDPOINT, {
      body: JSON.stringify({ code, redirect }),
      headers: { 'accept': 'application/json', 'content-type': 'application/json' },
      method: 'POST',
    });
    const result = (await response.json().catch(() => null)) as {
      detail?: string;
      ok?: boolean;
      reason?: string;
      redirect?: string | null;
    } | null;
    // Server rejected the redirect itself — do not `location.replace` the original query value.
    if (response.status === 400 && result?.reason === 'bad_redirect') {
      diag('exchange_failed', 'bad_redirect');
      return { redirect: '/', stage: 'exchange_failed', status: 'fallback' };
    }
    if (!response.ok || !result?.ok) {
      const reason = result?.reason ?? `http_${response.status}`;
      return giveUp('exchange_failed', result?.detail ? `${reason}: ${result.detail}` : reason);
    }
    diag('success');
    // The server echoes the target back; it is still re-checked here because this value is what
    // the browser is about to navigate to.
    return {
      redirect: sanitizeRedirect(result.redirect ?? redirect),
      stage: 'success',
      status: 'signed-in',
    };
  } catch (error) {
    return giveUp('exchange_failed', describeError(error, 'exchange_error'));
  }
};
