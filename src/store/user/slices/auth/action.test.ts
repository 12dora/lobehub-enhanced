import type * as LobeConst from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { userKeys } from '@/libs/swr/keys';
import { useUserStore } from '@/store/user';

vi.mock('zustand/traditional');

// Mock @/libs/swr mutate
vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

const mockBetterAuthClient = vi.hoisted(() => ({
  listAccounts: vi.fn().mockResolvedValue({ data: [] }),
  accountInfo: vi.fn().mockResolvedValue({ data: { user: {} } }),
  signOut: vi.fn().mockResolvedValue({}),
}));

const mockDesktop = vi.hoisted(() => ({ value: false }));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobeConst>();
  return {
    ...actual,
    get isDesktop() {
      return mockDesktop.value;
    },
  };
});

vi.mock('@/libs/better-auth/auth-client', () => mockBetterAuthClient);

const endSessionPayload = {
  fields: {
    id_token_hint: 'raw-id-token',
    post_logout_redirect_uri: 'https://chat.example.test/signin',
  },
  method: 'POST',
  url: 'https://auth.example.test/application/o/aihub/end-session/',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const stubLocationHref = () => {
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, href: '' },
    writable: true,
  });
  return () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
      writable: true,
    });
  };
};

const mockSignOutOnSuccess = () => {
  mockBetterAuthClient.signOut.mockImplementation(
    async (options?: { fetchOptions?: { onSuccess?: () => void } }) => {
      options?.fetchOptions?.onSuccess?.();
    },
  );
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mockDesktop.value = false;
  document.querySelectorAll('form').forEach((form) => form.remove());

  // Reset store state
  useUserStore.setState({
    isLoadedAuthProviders: false,
    authProviders: [],
    hasPasswordAccount: false,
  });
});

describe('createAuthSlice', () => {
  describe('refreshUserState', () => {
    it('should refresh user config', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.refreshUserState();
      });

      expect(mutate).toHaveBeenCalledWith(userKeys.initState());
    });
  });

  describe('logout', () => {
    it('should call better-auth signOut', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(mockBetterAuthClient.signOut).toHaveBeenCalled();
    });

    it('fetches end-session before local revoke, then POSTs Authentik form fields', async () => {
      const order: string[] = [];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/api/auth/oidc/end-session')) {
          order.push('end-session');
          return jsonResponse(endSessionPayload);
        }
        if (url.includes('/oidc/clear-session')) {
          order.push('clear-session');
          return jsonResponse({ ok: true });
        }
        throw new Error(`unexpected fetch ${url}`);
      });
      mockBetterAuthClient.signOut.mockImplementation(
        async (options?: { fetchOptions?: { onSuccess?: () => void } }) => {
          order.push('signOut');
          options?.fetchOptions?.onSuccess?.();
        },
      );
      const submit = vi.fn();
      const originalSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = submit;

      const { result } = renderHook(() => useUserStore());
      let redirected: boolean | undefined;
      await act(async () => {
        redirected = await result.current.logout();
      });

      expect(order).toEqual(['end-session', 'clear-session', 'signOut']);
      expect(redirected).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/auth/oidc/end-session',
        expect.objectContaining({
          cache: 'no-store',
          credentials: 'include',
          headers: { Accept: 'application/json' },
          method: 'GET',
        }),
      );
      expect(submit).toHaveBeenCalledOnce();
      const form = document.querySelector('form');
      expect(form?.getAttribute('action')).toBe(endSessionPayload.url);
      expect(form?.getAttribute('method')).toBe('POST');
      expect(
        [...(form?.querySelectorAll('input') ?? [])].map((input) => [input.name, input.value]),
      ).toEqual([
        ['id_token_hint', 'raw-id-token'],
        ['post_logout_redirect_uri', 'https://chat.example.test/signin'],
      ]);
      HTMLFormElement.prototype.submit = originalSubmit;
      form?.remove();
    });

    it('falls back to /signin when end-session is unavailable', async () => {
      const restoreLocation = stubLocationHref();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/api/auth/oidc/end-session')) {
          return jsonResponse({ error: 'not_found' }, 404);
        }
        return jsonResponse({ ok: true });
      });
      mockSignOutOnSuccess();

      const { result } = renderHook(() => useUserStore());
      let redirected: boolean | undefined;
      await act(async () => {
        redirected = await result.current.logout();
      });

      expect(mockBetterAuthClient.signOut).toHaveBeenCalled();
      expect(redirected).toBe(false);
      expect(window.location.href).toBe('/signin');
      expect(document.querySelector('form')).toBeNull();

      restoreLocation();
    });

    it.each([
      ['http', 'http://auth.example/end-session/'],
      ['javascript', 'javascript:alert(1)'],
      ['userinfo', 'https://user:pass@auth.example.test/application/o/aihub/end-session/'],
    ])('does not submit a hidden form for a %s end-session url', async (_label, url) => {
      const restoreLocation = stubLocationHref();
      const submit = vi.fn();
      const originalSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = submit;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        if (String(input).includes('/api/auth/oidc/end-session')) {
          return jsonResponse({ ...endSessionPayload, url });
        }
        return jsonResponse({ ok: true });
      });
      mockSignOutOnSuccess();

      const { result } = renderHook(() => useUserStore());
      let redirected: boolean | undefined;
      await act(async () => {
        redirected = await result.current.logout();
      });

      expect(redirected).toBe(false);
      expect(submit).not.toHaveBeenCalled();
      expect(document.querySelector('form')).toBeNull();
      expect(window.location.href).toBe('/signin');

      HTMLFormElement.prototype.submit = originalSubmit;
      restoreLocation();
    });

    it('only posts id_token_hint and post_logout_redirect_uri even when extra fields are returned', async () => {
      const submit = vi.fn();
      const originalSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = submit;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        if (String(input).includes('/api/auth/oidc/end-session')) {
          return jsonResponse({
            ...endSessionPayload,
            fields: { ...endSessionPayload.fields, foo: 'should-not-become-an-input' },
          });
        }
        return jsonResponse({ ok: true });
      });
      mockSignOutOnSuccess();

      const { result } = renderHook(() => useUserStore());
      await act(async () => {
        await result.current.logout();
      });

      const form = document.querySelector('form');
      expect([...(form?.querySelectorAll('input') ?? [])].map((input) => input.name)).toEqual([
        'id_token_hint',
        'post_logout_redirect_uri',
      ]);

      HTMLFormElement.prototype.submit = originalSubmit;
      form?.remove();
    });

    it.each([
      ['401', () => jsonResponse({ error: 'unauthorized' }, 401)],
      ['network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ])('falls back to /signin when end-session is a %s', async (_label, endSessionResponse) => {
      const restoreLocation = stubLocationHref();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        if (String(input).includes('/api/auth/oidc/end-session')) {
          return endSessionResponse();
        }
        return jsonResponse({ ok: true });
      });
      mockSignOutOnSuccess();

      const { result } = renderHook(() => useUserStore());
      let redirected: boolean | undefined;
      await act(async () => {
        redirected = await result.current.logout();
      });

      expect(redirected).toBe(false);
      expect(mockBetterAuthClient.signOut).toHaveBeenCalled();
      expect(window.location.href).toBe('/signin');
      expect(document.querySelector('form')).toBeNull();

      restoreLocation();
    });

    it('skips the Authentik RP form on desktop and leaves in-app navigation to the caller', async () => {
      mockDesktop.value = true;
      const restoreLocation = stubLocationHref();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        if (String(input).includes('/api/auth/oidc/end-session')) {
          return jsonResponse(endSessionPayload);
        }
        return jsonResponse({ ok: true });
      });
      mockSignOutOnSuccess();
      const submit = vi.fn();
      const originalSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = submit;

      const { result } = renderHook(() => useUserStore());
      let redirected: boolean | undefined;
      await act(async () => {
        redirected = await result.current.logout();
      });

      expect(redirected).toBe(false);
      expect(submit).not.toHaveBeenCalled();
      expect(document.querySelector('form')).toBeNull();
      expect(window.location.href).toBe('');
      expect(
        fetchSpy.mock.calls.some(([input]) => String(input).includes('/api/auth/oidc/end-session')),
      ).toBe(false);
      expect(mockBetterAuthClient.signOut).toHaveBeenCalled();

      HTMLFormElement.prototype.submit = originalSubmit;
      restoreLocation();
    });
  });

  describe('openLogin', () => {
    it('should redirect to signin page', async () => {
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
          ...originalLocation,
          href: '',
          pathname: '/chat',
          toString: () => 'http://localhost/chat',
        },
        writable: true,
      });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      expect(window.location.href).toContain('/signin');
      expect(window.location.href).toContain('callbackUrl');

      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
        writable: true,
      });
    });

    it('should not redirect when already on signin page', async () => {
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
          ...originalLocation,
          href: '',
          pathname: '/signin',
          toString: () => 'http://localhost/signin',
        },
        writable: true,
      });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      expect(window.location.href).toBe('');

      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
        writable: true,
      });
    });
  });

  describe('fetchAuthProviders', () => {
    it('should skip fetching if already loaded', async () => {
      useUserStore.setState({ isLoadedAuthProviders: true });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.fetchAuthProviders();
      });

      expect(mockBetterAuthClient.listAccounts).not.toHaveBeenCalled();
    });

    it('should fetch providers from BetterAuth', async () => {
      mockBetterAuthClient.listAccounts.mockResolvedValueOnce({
        data: [
          { providerId: 'github', accountId: 'gh-123' },
          { providerId: 'credential', accountId: 'cred-1' },
        ],
      });
      mockBetterAuthClient.accountInfo.mockResolvedValueOnce({
        data: { user: { email: 'test@github.com' } },
      });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.fetchAuthProviders();
      });

      expect(mockBetterAuthClient.listAccounts).toHaveBeenCalled();
      expect(result.current.isLoadedAuthProviders).toBe(true);
      expect(result.current.hasPasswordAccount).toBe(true);
    });

    it('should handle fetch error gracefully', async () => {
      mockBetterAuthClient.listAccounts.mockRejectedValueOnce(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.fetchAuthProviders();
      });

      expect(result.current.isLoadedAuthProviders).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  describe('refreshAuthProviders', () => {
    it('should refresh providers from BetterAuth', async () => {
      mockBetterAuthClient.listAccounts.mockResolvedValueOnce({
        data: [{ providerId: 'google', accountId: 'g-1' }],
      });
      mockBetterAuthClient.accountInfo.mockResolvedValueOnce({
        data: { user: { email: 'user@gmail.com' } },
      });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.refreshAuthProviders();
      });

      expect(mockBetterAuthClient.listAccounts).toHaveBeenCalled();
      expect(result.current.authProviders).toEqual([
        { provider: 'google', email: 'user@gmail.com', providerAccountId: 'g-1' },
      ]);
    });

    it('should handle refresh error gracefully', async () => {
      mockBetterAuthClient.listAccounts.mockRejectedValueOnce(new Error('Refresh failed'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.refreshAuthProviders();
      });

      // Should not throw
      consoleSpy.mockRestore();
    });
  });
});
