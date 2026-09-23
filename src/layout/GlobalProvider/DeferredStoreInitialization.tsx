'use client';

import { memo } from 'react';

import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useAiInfraStore } from '@/store/aiInfra';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserMemoryStore } from '@/store/userMemory';

interface DeferredStoreInitializationProps {
  isLogin: boolean;
}

const DeferredStoreInitialization = memo<DeferredStoreInitializationProps>(({ isLogin }) => {
  const useInitAiProviderKeyVaults = useAiInfraStore((s) => s.useFetchAiProviderRuntimeState);
  const useFetchPersona = useUserMemoryStore((s) => s.useFetchPersona);
  const useFetchMemoryEmbeddingAvailability = useUserMemoryStore(
    (s) => s.useFetchMemoryEmbeddingAvailability,
  );
  const isSyncActive = useElectronStore((s) => electronSyncSelectors.isSyncActive(s));
  const cacheScope = useCacheScope();
  // Deployment module switch: skip the persona fetch when the memory module is off (fail-open).
  const memoryEnabled = useServerConfigStore(
    (s) => serverConfigSelectors.enterpriseModules(s)?.memory !== false,
  );

  useInitAiProviderKeyVaults(isLogin, isSyncActive);
  useFetchPersona(isLogin && memoryEnabled);
  // Web chat builds its tool list on the client: without an embedding model the
  // memory tool must be dropped, same as the server-side run path. Keyed by the
  // cache scope so an account / workspace switch re-checks.
  useFetchMemoryEmbeddingAvailability(isLogin && memoryEnabled, cacheScope);

  return null;
});

export default DeferredStoreInitialization;
