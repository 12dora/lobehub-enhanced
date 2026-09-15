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

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
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
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
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
      await act(async () => {
        await result.current.logout();
      });

      expect(order).toEqual(['end-session', 'clear-session', 'signOut']);
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
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, href: '' },
        writable: true,
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/api/auth/oidc/end-session')) {
          return jsonResponse({ error: 'not_found' }, 404);
        }
        return jsonResponse({ ok: true });
      });
      mockBetterAuthClient.signOut.mockImplementation(
        async (options?: { fetchOptions?: { onSuccess?: () => void } }) => {
          options?.fetchOptions?.onSuccess?.();
        },
      );

      const { result } = renderHook(() => useUserStore());
      await act(async () => {
        await result.current.logout();
      });

      expect(mockBetterAuthClient.signOut).toHaveBeenCalled();
      expect(window.location.href).toBe('/signin');
      expect(document.querySelector('form')).toBeNull();

      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
        writable: true,
      });
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
