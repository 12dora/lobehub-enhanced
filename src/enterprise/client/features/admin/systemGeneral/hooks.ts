'use client';

import { useCallback, useRef, useState } from 'react';

import type {
  AdminImConnectorDirectoryStatus,
  AdminImConnectorsBindingsService,
  AdminImConnectorsNotifyAppService,
  AdminImConnectorsReadService,
  ImConnectorPlatform,
} from '@/enterprise/client/services/adminImConnectors';
import type {
  AdminBrowserProfileService,
  AdminDocumentRenderSettingsService,
  AdminInfraSettingsService,
  AdminSandboxSettingsService,
  AdminSystemInfraSettings,
  AdminSystemTestDependencyResult,
} from '@/enterprise/client/services/adminSystem';
import { useClientDataSWR } from '@/libs/swr';
import type { AdminSystemInfraDependency } from '@/server/enterprise/contracts/adminSystem';

import {
  buildAdminBrowserProfileKey,
  buildAdminBrowserProfileOptionsKey,
  buildAdminDocumentRenderSettingsKey,
  buildAdminDocumentRenderStatusKey,
  buildAdminImConnectorBindingsKey,
  buildAdminImConnectorDirectoryStatusKey,
  buildAdminImConnectorsKey,
  buildAdminInfraSettingsKey,
  buildAdminSandboxSettingsKey,
} from './swrKeys';

/** Queue depth and sidecar health move on their own; 15s is the same cadence 网络代理 polls at. */
const DOCUMENT_RENDER_STATUS_REFRESH_MS = 15_000;

/** The stream worker republishes its heartbeat every 30s (TTL 120s); 20s reads it without racing. */
const IM_CONNECTOR_STATUS_REFRESH_MS = 20_000;

/** Only while a sync is running: a full directory pass takes seconds, not minutes. */
export const IM_CONNECTOR_DIRECTORY_RUNNING_REFRESH_MS = 10_000;

export const directoryStatusRefreshInterval = (
  data?: Pick<AdminImConnectorDirectoryStatus, 'state'> | null,
): number => (data?.state === 'running' ? IM_CONNECTOR_DIRECTORY_RUNNING_REFRESH_MS : 0);

export const useAdminBrowserProfile = (enabled: boolean, service: AdminBrowserProfileService) =>
  useClientDataSWR(buildAdminBrowserProfileKey(enabled), () => service.getBrowserProfile(), {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

/**
 * The pools a fingerprint may be composed from. They are compiled into the build, so unlike the
 * profile itself they cannot go stale while the page is open.
 */
export const useAdminBrowserProfileOptions = (
  enabled: boolean,
  service: AdminBrowserProfileService,
) =>
  useClientDataSWR(
    buildAdminBrowserProfileOptionsKey(enabled),
    () => service.getBrowserProfileOptions(),
    { keepPreviousData: true, revalidateIfStale: false, revalidateOnFocus: false },
  );

export const useAdminInfraSettings = (enabled: boolean, service: AdminInfraSettingsService) =>
  useClientDataSWR(buildAdminInfraSettingsKey(enabled), () => service.getInfraSettings(), {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

export const useAdminSandboxSettings = (enabled: boolean, service: AdminSandboxSettingsService) =>
  useClientDataSWR(buildAdminSandboxSettingsKey(enabled), () => service.getSandboxSettings(), {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

export const useAdminDocumentRenderSettings = (
  enabled: boolean,
  service: AdminDocumentRenderSettingsService,
) =>
  useClientDataSWR(
    buildAdminDocumentRenderSettingsKey(enabled),
    () => service.getDocumentRenderSettings(),
    { keepPreviousData: true, revalidateOnFocus: false },
  );

/**
 * Polled, unlike the settings: `refreshWhenHidden` stays off so a backgrounded admin tab stops
 * asking the sidecar how it is.
 */
export const useAdminDocumentRenderStatus = (
  enabled: boolean,
  service: AdminDocumentRenderSettingsService,
) =>
  useClientDataSWR(
    buildAdminDocumentRenderStatusKey(enabled),
    () => service.getDocumentRenderStatus(),
    {
      keepPreviousData: true,
      refreshInterval: DOCUMENT_RENDER_STATUS_REFRESH_MS,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
    },
  );

/**
 * IM 连接器 list. One entry per supported platform, configured or not, so the tab can render the
 * cards without a second "does a row exist" request.
 *
 * Polled, unlike the infrastructure settings it sits next to: the connection state is a Redis
 * heartbeat the stream worker refreshes every 30s, and watching it come up after 启用 is the whole
 * point of the status pill. `refreshWhenHidden` stays off so a backgrounded admin tab goes quiet.
 */
export const useAdminImConnectors = (enabled: boolean, service: AdminImConnectorsReadService) =>
  useClientDataSWR(buildAdminImConnectorsKey(enabled), () => service.list(), {
    keepPreviousData: true,
    refreshInterval: IM_CONNECTOR_STATUS_REFRESH_MS,
    refreshWhenHidden: false,
    revalidateOnFocus: false,
  });

/**
 * Manual + auto account bindings for one IM platform, filtered server-side by `q`.
 *
 * Not polled: the card invalidates every cached `q` after a write (`imConnectors/invalidate.ts`).
 * A link made from IM itself therefore only shows up after the next write or a remount — the
 * trade the 已绑定员工 counter makes to keep this list off a timer.
 */
export const useAdminImConnectorBindings = (
  enabled: boolean,
  platform: ImConnectorPlatform,
  q: string,
  service: AdminImConnectorsBindingsService,
) =>
  useClientDataSWR(
    buildAdminImConnectorBindingsKey(enabled, platform, q),
    () => service.listBindings({ platform, ...(q.length > 0 ? { q } : {}) }),
    { keepPreviousData: true, revalidateOnFocus: false },
  );

/**
 * Contacts directory sync state of the 通知应用.
 *
 * Polled only while a sync is actually running — the rest of the time the counters change once an
 * hour (the worker's own cadence), and an admin watching 立即同步 is the only reason to ask often.
 */
export const useAdminImConnectorDirectoryStatus = (
  enabled: boolean,
  service: AdminImConnectorsNotifyAppService,
) =>
  useClientDataSWR(
    buildAdminImConnectorDirectoryStatusKey(enabled),
    () => service.directoryStatus(),
    {
      keepPreviousData: true,
      refreshInterval: directoryStatusRefreshInterval,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
    },
  );

export interface InfraProbeState {
  busy: Partial<Record<AdminSystemInfraDependency, boolean>>;
  results: Partial<Record<AdminSystemInfraDependency, AdminSystemTestDependencyResult>>;
  run: (dependency: AdminSystemInfraDependency) => Promise<void>;
}

export const useInfraDependencyProbe = (service: AdminInfraSettingsService): InfraProbeState => {
  const inFlight = useRef(new Set<AdminSystemInfraDependency>());
  const [busy, setBusy] = useState<Partial<Record<AdminSystemInfraDependency, boolean>>>({});
  const [results, setResults] = useState<
    Partial<Record<AdminSystemInfraDependency, AdminSystemTestDependencyResult>>
  >({});

  const run = useCallback(
    async (dependency: AdminSystemInfraDependency) => {
      if (inFlight.current.has(dependency)) return;
      inFlight.current.add(dependency);
      setBusy((current) => ({ ...current, [dependency]: true }));
      try {
        const result = await service.testDependency({ dependency });
        setResults((current) => ({ ...current, [dependency]: result }));
      } catch {
        setResults((current) => ({
          ...current,
          [dependency]: {
            checkedAt: new Date(),
            latencyMs: 0,
            message: 'unreachable',
            ok: false,
          },
        }));
      } finally {
        inFlight.current.delete(dependency);
        setBusy((current) => ({ ...current, [dependency]: false }));
      }
    },
    [service],
  );

  return { busy, results, run };
};

export type { AdminSystemInfraSettings };
