// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readDingtalkPersonalCapability, useDingtalkPersonalEnabled } from './capability';

const mocks = vi.hoisted(() => ({ state: undefined as unknown }));

vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => mocks.state,
}));

afterEach(() => {
  mocks.state = undefined;
});

describe('readDingtalkPersonalCapability', () => {
  it('is true only when the server reports the flag as true', () => {
    expect(readDingtalkPersonalCapability({ capabilities: { dingtalkPersonal: true } })).toBe(true);
  });

  it('fails closed on a missing, partial, malformed or non-boolean payload', () => {
    expect(readDingtalkPersonalCapability(undefined)).toBe(false);
    expect(readDingtalkPersonalCapability({})).toBe(false);
    expect(readDingtalkPersonalCapability({ capabilities: null })).toBe(false);
    expect(readDingtalkPersonalCapability({ capabilities: { dingtalkTodo: true } })).toBe(false);
    expect(readDingtalkPersonalCapability({ capabilities: { dingtalkPersonal: 'true' } })).toBe(
      false,
    );
  });
});

describe('useDingtalkPersonalEnabled', () => {
  it('reads the flag from the app store', () => {
    mocks.state = { serverConfig: { enterprise: { capabilities: { dingtalkPersonal: true } } } };

    expect(renderHook(() => useDingtalkPersonalEnabled()).result.current).toBe(true);
  });

  // The connector routes are also rendered without the server-config provider.
  it('reads as off, without throwing, when no store exists', () => {
    expect(renderHook(() => useDingtalkPersonalEnabled()).result.current).toBe(false);
  });
});
