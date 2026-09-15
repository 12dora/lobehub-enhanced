// @vitest-environment happy-dom
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DingTalkSsoPage from '.';
import type * as BridgeModule from './bridge';
import { DINGTALK_SSO_TIMEOUT_MS } from './bridge';

const mocks = vi.hoisted(() => ({ runDingTalkSso: vi.fn() }));

vi.mock('./bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof BridgeModule>()),
  runDingTalkSso: mocks.runDingTalkSso,
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/enterprise/client/providers/RuntimeBrandingProvider', () => ({
  useBranding: () => ({ name: 'AI 平台' }),
}));

const replace = vi.fn();

const stubLocation = (search: string) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: `https://app.example.com/dingtalk/sso${search}`, replace, search },
    writable: true,
  });
};

beforeEach(() => {
  replace.mockReset();
  mocks.runDingTalkSso.mockReset();
  stubLocation('?redirect=%2Ftasks%2F42');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DingTalkSsoPage', () => {
  it('shows the branded status while the exchange runs', () => {
    mocks.runDingTalkSso.mockReturnValue(new Promise(() => {}));
    render(<DingTalkSsoPage />);

    expect(screen.getByText('正在通过钉钉登录 AI 平台…')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('continues to the redirect the server answered with', async () => {
    mocks.runDingTalkSso.mockResolvedValue({ redirect: '/tasks/42', status: 'signed-in' });
    render(<DingTalkSsoPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tasks/42'));
    expect(mocks.runDingTalkSso).toHaveBeenCalledWith({ redirect: '/tasks/42' });
    expect(screen.queryByText('钉钉免登不可用，正在转到登录页')).toBeNull();
  });

  it('hands an off-origin redirect param back as the root', async () => {
    stubLocation('?redirect=https%3A%2F%2Fevil.example');
    mocks.runDingTalkSso.mockResolvedValue({ redirect: '/', status: 'fallback' });
    render(<DingTalkSsoPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(mocks.runDingTalkSso).toHaveBeenCalledWith({ redirect: '/' });
  });

  it('says so and leaves for the login page when the bridge gives up', async () => {
    mocks.runDingTalkSso.mockResolvedValue({ redirect: '/tasks/42', status: 'fallback' });
    render(<DingTalkSsoPage />);

    await waitFor(() => expect(screen.getByText('钉钉免登不可用，正在转到登录页')).toBeTruthy());
    expect(replace).toHaveBeenCalledWith('/tasks/42');
  });

  it('treats a thrown bridge the same as a refusal', async () => {
    mocks.runDingTalkSso.mockRejectedValue(new Error('boom'));
    render(<DingTalkSsoPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tasks/42'));
    expect(screen.getByText('钉钉免登不可用，正在转到登录页')).toBeTruthy();
  });

  it('stops waiting on a DingTalk client that never answers', async () => {
    vi.useFakeTimers();
    mocks.runDingTalkSso.mockReturnValue(new Promise(() => {}));
    render(<DingTalkSsoPage />);

    await act(() => vi.advanceTimersByTimeAsync(DINGTALK_SSO_TIMEOUT_MS));

    expect(replace).toHaveBeenCalledWith('/tasks/42');
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('navigates once when a late answer arrives after the timeout', async () => {
    vi.useFakeTimers();
    let settle: (value: { redirect: string; status: string }) => void = () => {};
    mocks.runDingTalkSso.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(<DingTalkSsoPage />);

    await act(() => vi.advanceTimersByTimeAsync(DINGTALK_SSO_TIMEOUT_MS));
    settle({ redirect: '/late', status: 'signed-in' });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/tasks/42');
  });
});
