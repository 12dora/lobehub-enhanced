export const ADMIN_BROWSER_PROFILE_KEY = 'admin.browserProfile.get';
export const ADMIN_BROWSER_PROFILE_OPTIONS_KEY = 'admin.browserProfile.options';
export const ADMIN_SYSTEM_INFRA_SETTINGS_KEY = 'admin.system.getInfraSettings';
export const ADMIN_SYSTEM_SANDBOX_SETTINGS_KEY = 'admin.system.getSandboxSettings';
export const ADMIN_SYSTEM_DOCUMENT_RENDER_SETTINGS_KEY = 'admin.system.getDocumentRenderSettings';
export const ADMIN_SYSTEM_DOCUMENT_RENDER_STATUS_KEY = 'admin.system.getDocumentRenderStatus';
export const ADMIN_IM_CONNECTORS_KEY = 'admin.imConnectors.list';
export const ADMIN_IM_CONNECTOR_BINDINGS_KEY = 'admin.imConnectors.bindings.list';

export const buildAdminBrowserProfileKey = (enabled: boolean) =>
  enabled ? ([ADMIN_BROWSER_PROFILE_KEY] as const) : null;

export const buildAdminBrowserProfileOptionsKey = (enabled: boolean) =>
  enabled ? ([ADMIN_BROWSER_PROFILE_OPTIONS_KEY] as const) : null;

export const buildAdminInfraSettingsKey = (enabled: boolean) =>
  enabled ? ([ADMIN_SYSTEM_INFRA_SETTINGS_KEY] as const) : null;

export const buildAdminSandboxSettingsKey = (enabled: boolean) =>
  enabled ? ([ADMIN_SYSTEM_SANDBOX_SETTINGS_KEY] as const) : null;

export const buildAdminDocumentRenderSettingsKey = (enabled: boolean) =>
  enabled ? ([ADMIN_SYSTEM_DOCUMENT_RENDER_SETTINGS_KEY] as const) : null;

export const buildAdminDocumentRenderStatusKey = (enabled: boolean) =>
  enabled ? ([ADMIN_SYSTEM_DOCUMENT_RENDER_STATUS_KEY] as const) : null;

export const buildAdminImConnectorsKey = (enabled: boolean) =>
  enabled ? ([ADMIN_IM_CONNECTORS_KEY] as const) : null;

/**
 * The search term is part of the key: the list is server-filtered, so a different `q` is a
 * different resource rather than a client-side view of one cached answer.
 */
export const buildAdminImConnectorBindingsKey = (enabled: boolean, platform: string, q: string) =>
  enabled ? ([ADMIN_IM_CONNECTOR_BINDINGS_KEY, platform, q] as const) : null;
