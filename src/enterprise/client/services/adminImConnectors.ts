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
  AdminImConnectorTestInput,
  AdminImConnectorTestOutput,
  AdminImConnectorUpsertInput,
  AdminImConnectorView,
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

export type AdminImConnectorsService = AdminImConnectorsBindingsService &
  AdminImConnectorsMutationService &
  AdminImConnectorsReadService;

class AdminImConnectorsServiceImpl implements AdminImConnectorsService {
  get = (input: AdminImConnectorGetInput) => lambdaClient.admin.imConnectors.get.query(input);

  list = () => lambdaClient.admin.imConnectors.list.query();

  listBindings = (input: AdminImConnectorBindingsListInput) =>
    lambdaClient.admin.imConnectors.bindings.list.query(input);

  removeBinding = (input: AdminImConnectorBindingsRemoveInput) =>
    lambdaClient.admin.imConnectors.bindings.remove.mutate(input);

  test = (input: AdminImConnectorTestInput) => lambdaClient.admin.imConnectors.test.mutate(input);

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
  AdminImConnectorTestInput,
  AdminImConnectorTestOutput,
  AdminImConnectorUpsertInput,
  AdminImConnectorView,
  ImConnectorBindingSource,
  ImConnectorPlatform,
};
