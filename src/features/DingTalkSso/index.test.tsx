// @vitest-environment happy-dom
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DingTalkSsoPage from '.';
import type * as BridgeModule from './bridge';
import { DINGTALK_SSO_TIMEOUT_MS } from './bridge';

const mocks = vi.hoisted(() => ({ runDingTalkSso: vi.fn(), sendDingTalkSsoDiag: vi.fn() }));

vi.mock('./bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof BridgeModule>()),
  runDingTalkSso: mocks.runDingTalkSso,
  sendDingTalkSsoDiag: mocks.sendDingTalkSsoDiag,
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
  mocks.sendDingTalkSsoDiag.mockReset();
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
    mocks.runDingTalkSso.mockResolvedValue({
      redirect: '/tasks/42',
      stage: 'success',
      status: 'signed-in',
    });
    render(<DingTalkSsoPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tasks/42'));
    expect(mocks.runDingTalkSso).toHaveBeenCalledWith({ redirect: '/tasks/42' });
    expect(screen.queryByText(/钉钉免登不可用/)).toBeNull();
    // The bridge already beaconed `success`; the page must not send a second one.
    expect(mocks.sendDingTalkSsoDiag).not.toHaveBeenCalled();
  });

  it('hands an off-origin redirect param back as the root', async () => {
    stubLocation('?redirect=https%3A%2F%2Fevil.example');
    mocks.runDingTalkSso.mockResolvedValue({
      redirect: '/',
      stage: 'not_in_dingtalk',
      status: 'fallback',
    });
    render(<DingTalkSsoPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(mocks.runDingTalkSso).toHaveBeenCalledWith({ redirect: '/' });
  });

  it.each([['authcode_failed'], ['ready_timeout'], ['exchange_failed']])(
    'names the %s stage in the fallback line',
    async (stage) => {
      mocks.runDingTalkSso.mockResolvedValue({ redirect: '/tasks/42', stage, status: 'fallback' });
      render(<DingTalkSsoPage />);

      await waitFor(() =>
        expect(screen.getByText(`钉钉免登不可用（${stage}），正在转到登录页`)).toBeTruthy(),
      );
      expect(replace).toHaveBeenCalledWith('/tasks/42');
      // The bridge owns the beacon for its own stages.
      expect(mocks.sendDingTalkSsoDiag).not.toHaveBeenCalled();
    },
  );

  it('beacons page_error and says so when the bridge throws', async () => {
    mocks.runDingTalkSso.mockRejectedValue(new Error('boom'));
    render(<DingTalkSsoPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tasks/42'));
    expect(screen.getByText('钉钉免登不可用（page_error），正在转到登录页')).toBeTruthy();
    expect(mocks.sendDingTalkSsoDiag).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom', stage: 'page_error' }),
    );
  });

  it('stops waiting on a DingTalk client that never answers and beacons the timeout', async () => {
    vi.useFakeTimers();
    mocks.runDingTalkSso.mockReturnValue(new Promise(() => {}));
    render(<DingTalkSsoPage />);

    await act(() => vi.advanceTimersByTimeAsync(DINGTALK_SSO_TIMEOUT_MS));

    expect(replace).toHaveBeenCalledWith('/tasks/42');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(mocks.sendDingTalkSsoDiag).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'timeout' }),
    );
    expect(screen.getByText('钉钉免登不可用（timeout），正在转到登录页')).toBeTruthy();
  });

  it('navigates once when a late answer arrives after the timeout', async () => {
    vi.useFakeTimers();
    let settle: (value: { redirect: string; stage: string; status: string }) => void = () => {};
    mocks.runDingTalkSso.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    render(<DingTalkSsoPage />);

    await act(() => vi.advanceTimersByTimeAsync(DINGTALK_SSO_TIMEOUT_MS));
    settle({ redirect: '/late', stage: 'success', status: 'signed-in' });
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/tasks/42');
    expect(mocks.sendDingTalkSsoDiag).toHaveBeenCalledTimes(1);
  });
});
