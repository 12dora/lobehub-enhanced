import {
  type AdminImConnectorsMutationService,
  adminImConnectorsService,
} from '@/enterprise/client/services/adminImConnectors';

/**
 * The write half of the IM connector service. Narrowed to what a card needs so tests can inject a
 * stub without standing up the whole client service.
 */
export type ImConnectorMutationService = AdminImConnectorsMutationService;

export const imConnectorMutationService: ImConnectorMutationService = adminImConnectorsService;
