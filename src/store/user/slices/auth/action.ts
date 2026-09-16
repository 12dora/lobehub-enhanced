import { isDesktop } from '@lobechat/const';
import { type SSOProvider } from '@lobechat/types';
import { isNonEmptyString, isRecord } from '@lobechat/utils/object';

import { clearActiveScopeKey } from '@/libs/swr/useCacheScope';
import { type StoreSetter } from '@/store/types';

import { type UserStore } from '../../store';

interface AuthProvidersData {
  hasPasswordAccount: boolean;
  providers: SSOProvider[];
}

const fetchAuthProvidersData = async (): Promise<AuthProvidersData> => {
  const { accountInfo, listAccounts } = await import('@/libs/better-auth/auth-client');
  const result = await listAccounts();
  const accounts = result.data || [];
  const hasPasswordAccount = accounts.some((account) => account.providerId === 'credential');
  const providers = await Promise.all(
    accounts
      .filter((account) => account.providerId !== 'credential')
      .map(async (account) => {
        const info = await accountInfo({
          query: { accountId: account.accountId },
        });
        return {
          email: info.data?.user?.email ?? undefined,
          provider: account.providerId,
          providerAccountId: account.accountId,
        };
      }),
  );
  return { hasPasswordAccount, providers };
};

interface OidcEndSessionForm {
  fields: Record<string, string>;
  url: string;
}

const isSafeHttpsUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

const parseOidcEndSessionForm = (value: unknown): OidcEndSessionForm | null => {
  if (!isRecord(value) || value.method !== 'POST' || !isNonEmptyString(value.url)) return null;
  if (!isSafeHttpsUrl(value.url)) return null;
  if (!isRecord(value.fields) || !isNonEmptyString(value.fields.id_token_hint)) return null;

  const fields: Record<string, string> = { id_token_hint: value.fields.id_token_hint };
  if (isNonEmptyString(value.fields.post_logout_redirect_uri)) {
    fields.post_logout_redirect_uri = value.fields.post_logout_redirect_uri;
  }
  return { fields, url: value.url };
};

const fetchOidcEndSessionForm = async (): Promise<OidcEndSessionForm | null> => {
  try {
    const response = await fetch('/api/auth/oidc/end-session', {
      cache: 'no-store',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      method: 'GET',
    });
    if (!response.ok) return null;
    return parseOidcEndSessionForm(await response.json());
  } catch {
    return null;
  }
};

const navigateToEndSession = (url: string, fields: Record<string, string>): void => {
  // GET, not a hidden form POST: Authentik's end-session view is CSRF-protected, so a
  // cross-site POST from this origin lands on Django's 403 page. OIDC allows GET here.
  const separator = url.includes('?') ? '&' : '?';
  window.location.href = `${url}${separator}${new URLSearchParams(fields).toString()}`;
};

type Setter = StoreSetter<UserStore>;
export const createAuthSlice = (set: Setter, get: () => UserStore, _api?: unknown) =>
  new UserAuthActionImpl(set, get, _api);

export class UserAuthActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  fetchAuthProviders = async (): Promise<void> => {
    // Skip if already loaded
    if (this.#get().isLoadedAuthProviders) return;

    try {
      const { hasPasswordAccount, providers } = await fetchAuthProvidersData();
      this.#set({ authProviders: providers, hasPasswordAccount, isLoadedAuthProviders: true });
    } catch (error) {
      console.error('Failed to fetch auth providers:', error);
      this.#set({ isLoadedAuthProviders: true });
    }
  };

  logout = async (): Promise<boolean> => {
    // Electron keeps the old in-app destination (desktop onboarding). Skip the
    // Authentik RP form so sign-out cannot yank the window to the issuer.
    const endSession = isDesktop ? null : await fetchOidcEndSessionForm();

    // Clear the OIDC Provider session for the current browser *before*
    // destroying the better-auth session. This prevents a stale OIDC session
    // from silently issuing tokens for the old account after the user signs
    // in as someone else.
    try {
      await fetch('/oidc/clear-session', { method: 'POST' });
    } catch {
      // Best-effort: don't block sign-out if the cleanup request fails
    }

    let redirected = false;
    const { signOut } = await import('@/libs/better-auth/auth-client');
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          // Drop the persisted active scope so the next boot doesn't hydrate the
          // signed-out user's cache (localStorage survives the reload below).
          clearActiveScopeKey();
          if (endSession) {
            navigateToEndSession(endSession.url, endSession.fields);
            redirected = true;
            return;
          }
          if (isDesktop) return;
          // Use window.location.href to trigger a full page reload
          // This ensures all client-side state (React, Zustand, cache) is cleared
          window.location.href = '/signin';
        },
      },
    });
    return redirected;
  };

  openLogin = async (): Promise<void> => {
    // Skip if already on a login page (/signin, /signup)
    const pathname = location.pathname;
    if (pathname.startsWith('/signin') || pathname.startsWith('/signup')) {
      return;
    }

    const currentUrl = location.toString();
    window.location.href = `/signin?callbackUrl=${encodeURIComponent(currentUrl)}`;
  };

  refreshAuthProviders = async (): Promise<void> => {
    try {
      const { hasPasswordAccount, providers } = await fetchAuthProvidersData();
      this.#set({ authProviders: providers, hasPasswordAccount });
    } catch (error) {
      console.error('Failed to refresh auth providers:', error);
    }
  };
}

export type UserAuthAction = Pick<UserAuthActionImpl, keyof UserAuthActionImpl>;
