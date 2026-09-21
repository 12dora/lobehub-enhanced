import type { z } from 'zod';

import { lambdaClient } from '@/libs/trpc/client';
import type {
  AdminImConnectorBindingItem,
  AdminImConnectorBindingsListInput,
  AdminImConnectorBindingsListOutput,
  AdminImConnectorBindingsRemoveInput,
  AdminImConnectorBindingsRemoveOutput,
  AdminImConnectorBindingsUpsertInput,
  AdminImConnectorBindingsUpsertOutput,
  AdminImConnectorGetInput,
  adminImConnectorListOutputSchema,
  AdminImConnectorProbeWorkspacePermissionsOutput,
  AdminImConnectorTestInput,
  AdminImConnectorTestOutput,
  AdminImConnectorUpsertInput,
  AdminImConnectorView,
  DingtalkPermissionProbe,
  ImConnectorBindingBoundVia,
  ImConnectorBindingSource,
  ImConnectorPlatform,
} from '@/server/enterprise/contracts/adminImConnectors';

export type AdminImConnectorList = z.infer<typeof adminImConnectorListOutputSchema>;

/**
 * Read half of the IM connector boundary. `list` always answers with one entry per supported
 * platform, so the tab renders the same set of cards whether or not a row was ever saved.
 */
export interface AdminImConnectorsReadService {
  get: (input: AdminImConnectorGetInput) => Promise<AdminImConnectorView>;
  list: () => Promise<AdminImConnectorList>;
}

/**
 * Write half. Both calls need SYSTEM_OPERATE; `test` takes the draft values so a credential can be
 * verified before it is stored, and falls back to the saved row for any field left out.
 */
export interface AdminImConnectorsMutationService {
  probeWorkspacePermissions: () => Promise<AdminImConnectorProbeWorkspacePermissionsOutput>;
  test: (input: AdminImConnectorTestInput) => Promise<AdminImConnectorTestOutput>;
  upsert: (input: AdminImConnectorUpsertInput) => Promise<AdminImConnectorView>;
}

/**
 * Manual account bindings. Separate from the connector row itself: an administrator binds a
 * DingTalk corp user to an AIHub account so reminders reach an account that never signed in
 * through DingTalk (a local or break-glass account, most of all). `listBindings` needs SYSTEM_READ,
 * the two writes SYSTEM_OPERATE.
 */
export interface AdminImConnectorsBindingsService {
  listBindings: (
    input: AdminImConnectorBindingsListInput,
  ) => Promise<AdminImConnectorBindingsListOutput>;
  removeBinding: (
    input: AdminImConnectorBindingsRemoveInput,
  ) => Promise<AdminImConnectorBindingsRemoveOutput>;
  upsertBinding: (
    input: AdminImConnectorBindingsUpsertInput,
  ) => Promise<AdminImConnectorBindingsUpsertOutput>;
}

/**
 * Contacts directory sync state, as the notification app's worker last reported it (Redis key
 * `messenger:dingtalk:directory-status`). `running` is what the 立即同步 button polls on.
 */
export interface AdminImConnectorDirectoryStatus {
  departments: number;
  lastError: string | null;
  lastRunAt: string | null;
  state: 'error' | 'idle' | 'ok' | 'running';
  users: number;
}

/**
 * Probe payload for the notification app. Like the robot's probe it takes the draft values, and
 * falls back to the stored row for anything left out (`adminImConnectorTestNotifyAppInputSchema`).
 */
export interface AdminImConnectorNotifyAppTestInput {
  notifyAppKey?: string;
  notifyAppSecret?: string;
}

/**
 * 通知应用（服务号） — the second DingTalk app: it sends work notifications and syncs the contacts
 * directory. `directoryStatus` needs SYSTEM_READ; the probe and the sync need SYSTEM_OPERATE.
 */
export interface AdminImConnectorsNotifyAppService {
  directoryStatus: () => Promise<AdminImConnectorDirectoryStatus>;
  syncDirectory: () => Promise<AdminImConnectorDirectoryStatus>;
  testNotifyApp: (
    input?: AdminImConnectorNotifyAppTestInput,
  ) => Promise<AdminImConnectorTestOutput>;
}

export type AdminImConnectorsService = AdminImConnectorsBindingsService &
  AdminImConnectorsNotifyAppService &
  AdminImConnectorsMutationService &
  AdminImConnectorsReadService;

class AdminImConnectorsServiceImpl implements AdminImConnectorsService {
  directoryStatus = () => lambdaClient.admin.imConnectors.directoryStatus.query();

  get = (input: AdminImConnectorGetInput) => lambdaClient.admin.imConnectors.get.query(input);

  list = () => lambdaClient.admin.imConnectors.list.query();

  listBindings = (input: AdminImConnectorBindingsListInput) =>
    lambdaClient.admin.imConnectors.bindings.list.query(input);

  probeWorkspacePermissions = () =>
    lambdaClient.admin.imConnectors.probeWorkspacePermissions.mutate();

  removeBinding = (input: AdminImConnectorBindingsRemoveInput) =>
    lambdaClient.admin.imConnectors.bindings.remove.mutate(input);

  syncDirectory = () => lambdaClient.admin.imConnectors.syncDirectory.mutate();

  test = (input: AdminImConnectorTestInput) => lambdaClient.admin.imConnectors.test.mutate(input);

  testNotifyApp = (input?: AdminImConnectorNotifyAppTestInput) =>
    lambdaClient.admin.imConnectors.testNotifyApp.mutate(input);

  upsert = (input: AdminImConnectorUpsertInput) =>
    lambdaClient.admin.imConnectors.upsert.mutate(input);

  upsertBinding = (input: AdminImConnectorBindingsUpsertInput) =>
    lambdaClient.admin.imConnectors.bindings.upsert.mutate(input);
}

export const adminImConnectorsService: AdminImConnectorsService =
  new AdminImConnectorsServiceImpl();

export type {
  AdminImConnectorBindingItem,
  AdminImConnectorBindingsListInput,
  AdminImConnectorBindingsListOutput,
  AdminImConnectorBindingsRemoveInput,
  AdminImConnectorBindingsRemoveOutput,
  AdminImConnectorBindingsUpsertInput,
  AdminImConnectorBindingsUpsertOutput,
  AdminImConnectorGetInput,
  AdminImConnectorProbeWorkspacePermissionsOutput,
  AdminImConnectorTestInput,
  AdminImConnectorTestOutput,
  AdminImConnectorUpsertInput,
  AdminImConnectorView,
  DingtalkPermissionProbe,
  ImConnectorBindingBoundVia,
  ImConnectorBindingSource,
  ImConnectorPlatform,
};
