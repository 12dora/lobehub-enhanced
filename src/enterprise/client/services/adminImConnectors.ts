import type { z } from 'zod';

import { lambdaClient } from '@/libs/trpc/client';
import type {
  AdminImConnectorGetInput,
  adminImConnectorListOutputSchema,
  AdminImConnectorTestInput,
  AdminImConnectorTestOutput,
  AdminImConnectorUpsertInput,
  AdminImConnectorView,
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

export type AdminImConnectorsService = AdminImConnectorsMutationService &
  AdminImConnectorsReadService;

class AdminImConnectorsServiceImpl implements AdminImConnectorsService {
  get = (input: AdminImConnectorGetInput) => lambdaClient.admin.imConnectors.get.query(input);

  list = () => lambdaClient.admin.imConnectors.list.query();

  test = (input: AdminImConnectorTestInput) => lambdaClient.admin.imConnectors.test.mutate(input);

  upsert = (input: AdminImConnectorUpsertInput) =>
    lambdaClient.admin.imConnectors.upsert.mutate(input);
}

export const adminImConnectorsService: AdminImConnectorsService =
  new AdminImConnectorsServiceImpl();

export type {
  AdminImConnectorGetInput,
  AdminImConnectorTestInput,
  AdminImConnectorTestOutput,
  AdminImConnectorUpsertInput,
  AdminImConnectorView,
};
