import { useSyncExternalStore } from 'react';

import { getServerConfigStoreState } from '@/store/serverConfig';

/**
 * Whether this deployment offers 钉钉个人数据.
 *
 * Source: `serverConfig.enterprise.capabilities.dingtalkPersonal` — true only when the admin switch
 * is on and the `aihub-dws` sidecar is configured. **Fails closed**: the payload is injected HTML,
 * so it is read as untrusted and only an explicit `true` counts.
 */
export const readDingtalkPersonalCapability = (enterprise: unknown): boolean => {
  if (!enterprise || typeof enterprise !== 'object') return false;

  const { capabilities } = enterprise as { capabilities?: unknown };
  if (!capabilities || typeof capabilities !== 'object') return false;

  return (capabilities as { dingtalkPersonal?: unknown }).dingtalkPersonal === true;
};

const readFromStore = (): boolean =>
  readDingtalkPersonalCapability(getServerConfigStoreState()?.serverConfig?.enterprise);

const subscribe = (onStoreChange: () => void) => {
  const store = typeof window === 'undefined' ? undefined : window.global_serverConfigStore;
  return store ? store.subscribe(onStoreChange) : () => {};
};

/**
 * Live capability flag. It reads the app's server-config store itself rather than through its React
 * context, because the connector routes that mount the card are also rendered without that provider
 * (route-level tests); with no store it reads as off.
 */
export const useDingtalkPersonalEnabled = (): boolean =>
  useSyncExternalStore(subscribe, readFromStore, () => false);
