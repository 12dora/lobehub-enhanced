/**
 * @vitest-environment node
 */
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it, vi } from 'vitest';

import { config } from './proxy';

vi.mock('@/libs/next/proxy/define-config', () => ({
  defineConfig: () => ({ middleware: vi.fn() }),
}));

describe('proxy SPA matcher', () => {
  it.each(['/admin', '/admin/', '/admin/agents', '/admin/connectors/detail'])(
    'runs the proxy for %s',
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    },
  );

  // Without a middleware pass there is no SPA rewrite, so the bridge would 404.
  it.each(['/verify', '/verify/run-1', '/verify-im', '/dingtalk/sso'])(
    'runs the proxy for %s so session gating can apply',
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    },
  );

  it('does not overmatch non-admin routes with the same prefix', () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: '/administrator' })).toBe(
      false,
    );
  });
});
