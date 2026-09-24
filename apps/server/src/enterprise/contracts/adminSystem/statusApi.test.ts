import { describe, expect, it } from 'vitest';

import {
  adminSystemStatusApiRotateOutputSchema,
  adminSystemStatusApiViewSchema,
  STATUS_API_TOKEN_PATTERN,
} from './statusApi';

const view = {
  createdAt: '2026-09-25T00:00:00.000Z',
  endpoints: {
    events: 'https://example.com/api/status/v1/events',
    health: 'https://example.com/api/status/v1/health',
    summary: 'https://example.com/api/status/v1/summary',
  },
  envTokenConfigured: false,
  tokenHint: 'sk-status-…a1b2',
  tokenSet: true,
};

describe('admin status API contracts', () => {
  it('accepts a view and a one-time sk-status token, and rejects extra fields', () => {
    expect(adminSystemStatusApiViewSchema.parse(view)).toEqual(view);
    expect(
      adminSystemStatusApiViewSchema.parse({ ...view, createdAt: null, tokenHint: null }),
    ).toMatchObject({
      createdAt: null,
      tokenSet: true,
    });
    expect(
      adminSystemStatusApiViewSchema.safeParse({ ...view, token: 'sk-status-secret' }).success,
    ).toBe(false);

    const token = `sk-status-${'a1'.repeat(16)}`;
    expect(STATUS_API_TOKEN_PATTERN.test(token)).toBe(true);
    expect(adminSystemStatusApiRotateOutputSchema.parse({ token, view }).token).toBe(token);
    expect(
      adminSystemStatusApiRotateOutputSchema.safeParse({ token: 'sk-status-short', view }).success,
    ).toBe(false);
    expect(
      adminSystemStatusApiRotateOutputSchema.safeParse({ token, view, hash: 'abc' }).success,
    ).toBe(false);
  });
});
