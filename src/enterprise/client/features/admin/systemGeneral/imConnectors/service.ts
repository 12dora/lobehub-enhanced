import {
  type AdminImConnectorsBindingsService,
  type AdminImConnectorsMutationService,
  adminImConnectorsService,
} from '@/enterprise/client/services/adminImConnectors';

/**
 * The write half of the IM connector service. Narrowed to what a card needs so tests can inject a
 * stub without standing up the whole client service.
 */
export type ImConnectorMutationService = AdminImConnectorsMutationService;

export const imConnectorMutationService: ImConnectorMutationService = adminImConnectorsService;

/**
 * Account bindings — read and both writes in one interface. They are injected together because the
 * 绑定用户 section reads the list right after it writes it; splitting them would only mean two
 * stubs for one surface.
 */
export type ImConnectorBindingsService = AdminImConnectorsBindingsService;

export const imConnectorBindingsService: ImConnectorBindingsService = adminImConnectorsService;
