import { describe, expect, it } from 'vitest';

import {
  ADMIN_BROWSER_PROFILE_KEY,
  ADMIN_IM_CONNECTOR_BINDINGS_KEY,
  ADMIN_IM_CONNECTORS_KEY,
  ADMIN_SYSTEM_ENTERPRISE_LOOKUP_SETTINGS_KEY,
  ADMIN_SYSTEM_INFRA_SETTINGS_KEY,
  ADMIN_SYSTEM_SANDBOX_SETTINGS_KEY,
  buildAdminBrowserProfileKey,
  buildAdminEnterpriseLookupSettingsKey,
  buildAdminImConnectorBindingsKey,
  buildAdminImConnectorsKey,
  buildAdminInfraSettingsKey,
  buildAdminSandboxSettingsKey,
} from './swrKeys';

describe('admin infra settings SWR keys', () => {
  it('returns null when SYSTEM_READ is unavailable', () => {
    expect(buildAdminInfraSettingsKey(false)).toBeNull();
  });

  it('returns a stable key when the page is allowed', () => {
    expect(buildAdminInfraSettingsKey(true)).toEqual([ADMIN_SYSTEM_INFRA_SETTINGS_KEY]);
    expect(buildAdminBrowserProfileKey(true)).toEqual([ADMIN_BROWSER_PROFILE_KEY]);
    expect(buildAdminBrowserProfileKey(false)).toBeNull();
    expect(buildAdminSandboxSettingsKey(true)).toEqual([ADMIN_SYSTEM_SANDBOX_SETTINGS_KEY]);
    expect(buildAdminSandboxSettingsKey(false)).toBeNull();
    expect(buildAdminImConnectorsKey(true)).toEqual([ADMIN_IM_CONNECTORS_KEY]);
    expect(buildAdminImConnectorsKey(false)).toBeNull();
  });

  /** The 企业查询 card owns its own request, so its key has to stay distinct from the shared one. */
  it('keys the enterprise lookup settings separately from the infra snapshot', () => {
    expect(buildAdminEnterpriseLookupSettingsKey(false)).toBeNull();
    expect(buildAdminEnterpriseLookupSettingsKey(true)).toEqual([
      ADMIN_SYSTEM_ENTERPRISE_LOOKUP_SETTINGS_KEY,
    ]);
    expect(ADMIN_SYSTEM_ENTERPRISE_LOOKUP_SETTINGS_KEY).not.toBe(ADMIN_SYSTEM_INFRA_SETTINGS_KEY);
  });
});

describe('admin IM connector bindings SWR key', () => {
  it('returns null when the section is not readable', () => {
    expect(buildAdminImConnectorBindingsKey(false, 'dingtalk', '')).toBeNull();
  });

  it('carries the search term, so every filter is its own cache entry', () => {
    expect(buildAdminImConnectorBindingsKey(true, 'dingtalk', '')).toEqual([
      ADMIN_IM_CONNECTOR_BINDINGS_KEY,
      'dingtalk',
      '',
    ]);
    expect(buildAdminImConnectorBindingsKey(true, 'dingtalk', '张三')).toEqual([
      ADMIN_IM_CONNECTOR_BINDINGS_KEY,
      'dingtalk',
      '张三',
    ]);
  });

  it('shares one prefix, so a write can invalidate every filter at once', () => {
    const matches = (key: unknown) =>
      Array.isArray(key) && key[0] === ADMIN_IM_CONNECTOR_BINDINGS_KEY;

    expect(matches(buildAdminImConnectorBindingsKey(true, 'dingtalk', ''))).toBe(true);
    expect(matches(buildAdminImConnectorBindingsKey(true, 'dingtalk', '张三'))).toBe(true);
    expect(matches(buildAdminImConnectorsKey(true))).toBe(false);
  });
});
