export interface ActionHref {
  /** `true` for an https URL outside the app (opens in a new tab). */
  external: boolean;
  href: string;
}

const MAX_HREF_LENGTH = 2000;

/**
 * The URL parser silently drops tab / LF / CR and trims C0 controls, so `/\n/evil.example` would
 * become the protocol-relative `//evil.example`. Any control character or inner whitespace refuses
 * the whole value instead of being cleaned up.
 */
const hasControlChar = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

/** Only used to resolve app paths; a path that lands anywhere else is not an app path. */
const APP_PATH_BASE = 'https://app.invalid';

const isAppPath = (href: string): boolean => {
  if (!href.startsWith('/')) return false;
  try {
    return new URL(href, APP_PATH_BASE).origin === APP_PATH_BASE;
  } catch {
    return false;
  }
};

/**
 * Where a "do this by hand" link may point: an app-relative path (`/settings/…`, routed inside the
 * SPA) or an absolute https URL. Protocol-relative (`//host`), backslash (`/\host`), control
 * characters, `http:`, `javascript:` and anything unparsable are refused.
 */
export const resolveActionHref = (value: unknown): ActionHref | undefined => {
  if (typeof value !== 'string' || hasControlChar(value)) return undefined;

  const href = value.trim();
  if (!href || href.length > MAX_HREF_LENGTH || /\s/.test(href)) return undefined;

  if (href.startsWith('/')) return isAppPath(href) ? { external: false, href } : undefined;

  try {
    return new URL(href).protocol === 'https:' ? { external: true, href } : undefined;
  } catch {
    return undefined;
  }
};
