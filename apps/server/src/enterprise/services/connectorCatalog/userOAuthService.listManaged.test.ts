// @vitest-environment node
import debug from 'debug';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PlatformConnectorCatalogRepository,
  PlatformUserConnectorBindingRepository,
} from '@/database/repositories/platformConnectorCatalog';
import type {
  PlatformConnectorItem,
  PlatformUserConnectorBindingItem,
} from '@/database/schemas/platform';
import type { LobeChatDatabase } from '@/database/type';

import { managedConnectorSchema } from '../../contracts/platformConnectors';
import type { ConnectorCatalogReadService } from './catalogSnapshot';
import type { ConnectorCatalogSecretStore } from './catalogTypes';
import type { ConnectorOAuthRuntimeDependencies } from './oauthRuntime';
import { UserConnectorOAuthService } from './userOAuthService';

/** Matches LIST_MANAGED_MAX_PAGE_FETCHES in userOAuthService.ts. */
const MAX_PAGE_FETCHES = 4;

const now = new Date('2026-03-01T00:00:00.000Z');

const db = {} as unknown as LobeChatDatabase;
const secrets: ConnectorCatalogSecretStore = {
  loadCurrentSecretSources: async () => {
    throw new Error('unused');
  },
  persistSecret: async () => {
    throw new Error('unused');
  },
  resolveSecretRef: async () => null,
  resolveSecretVersion: async () => null,
};
const dependencies: ConnectorOAuthRuntimeDependencies = {
  callbackRedirectUri: 'https://aihub.example.test/oauth/connector/callback',
  outbound: {} as unknown as ConnectorOAuthRuntimeDependencies['outbound'],
  secrets,
};

interface CatalogRow {
  id: string;
  key: string;
  published: boolean;
}

const row = (key: string, published: boolean): CatalogRow => ({
  id: `id-${key}`,
  key,
  published,
});

const publishedProjection = (id: string, key: string) =>
  managedConnectorSchema.parse({
    binding: null,
    credentialMode: 'none',
    description: null,
    displayName: key,
    id,
    key,
    publishedRevision: 1,
    tools: [],
  });

const bindingFor = (id: string, connectorId: string): PlatformUserConnectorBindingItem => ({
  connectedAt: now,
  connectorId,
  createdAt: now,
  expiresAt: null,
  id,
  lastErrorCategory: null,
  legacyAuthStatus: 'disconnected',
  legacyEncryptedCredentials: null,
  legacyLastError: null,
  legacyStatus: 'active',
  oauthTokenRef: `vault://connectors/${connectorId}/oauthBindingToken/secret`,
  publishedRevision: 1,
  revision: 1,
  revisionResourceType: 'connector',
  revokedAt: null,
  scopes: ['issues:read'],
  status: 'connected',
  tokenFingerprint: `fingerprint-${connectorId}`,
  updatedAt: now,
  userId: 'user-list-managed',
});

const collaboratorsOf = (service: UserConnectorOAuthService) =>
  service as unknown as {
    bindings: PlatformUserConnectorBindingRepository;
    catalog: PlatformConnectorCatalogRepository;
    read: ConnectorCatalogReadService;
  };

const installCatalog = (
  service: UserConnectorOAuthService,
  rows: CatalogRow[],
  bindings = new Map<string, PlatformUserConnectorBindingItem>(),
) => {
  const collaborators = collaboratorsOf(service);
  const listConnectors = vi
    .spyOn(collaborators.catalog, 'listConnectors')
    .mockImplementation(async (params) => {
      const limit = params.limit ?? rows.length;
      const cursorKey =
        typeof params.cursor === 'string' ? params.cursor : params.cursor?.connectorKey;
      const rest = rows.filter((candidate) => (cursorKey ? candidate.key > cursorKey : true));
      const slice = rest.slice(0, limit);
      const last = slice.at(-1);
      return {
        items: slice.map(
          (candidate) =>
            ({ connectorKey: candidate.key, id: candidate.id }) as unknown as PlatformConnectorItem,
        ),
        nextCursor: rest.length > limit && last ? { connectorKey: last.key, id: last.id } : null,
      };
    });
  const getPublicPublishedBatch = vi
    .spyOn(collaborators.read, 'getPublicPublishedBatch')
    .mockImplementation(async (connectorIds) => {
      const byId = new Map<string, ReturnType<typeof publishedProjection>>();
      for (const connectorId of connectorIds) {
        const match = rows.find((candidate) => candidate.id === connectorId);
        if (!match?.published) continue;
        byId.set(connectorId, publishedProjection(match.id, match.key));
      }
      return byId;
    });
  const getBindingsForConnectors = vi
    .spyOn(collaborators.bindings, 'getBindingsForConnectors')
    .mockImplementation(async (connectorIds) => {
      const byConnectorId = new Map<string, PlatformUserConnectorBindingItem>();
      for (const connectorId of connectorIds) {
        const binding = bindings.get(connectorId);
        if (binding) byConnectorId.set(connectorId, binding);
      }
      return byConnectorId;
    });
  return { getBindingsForConnectors, getPublicPublishedBatch, listConnectors };
};

const createService = () => new UserConnectorOAuthService(db, 'user-list-managed', dependencies);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UserConnectorOAuthService.listManaged', () => {
  it('skips a connector missing from the published batch instead of failing the page', async () => {
    const previousDebug = debug.disable();
    debug.enable('lobe-server:connector-oauth-user');
    const debugLog = vi.spyOn(debug, 'log').mockImplementation(() => undefined);
    const service = createService();
    const skipped = row('a-skip', false);
    const kept = row('b-keep', true);
    installCatalog(
      service,
      [skipped, kept],
      new Map([
        [skipped.id, bindingFor('binding-skip', skipped.id)],
        [kept.id, bindingFor('binding-keep', kept.id)],
      ]),
    );

    try {
      const result = await service.listManaged({ limit: 10, query: 'issues' });

      expect(result.items.map((item) => item.id)).toEqual([kept.id]);
      expect(result.nextCursor).toBeNull();
      expect(result.items[0]?.binding).toEqual({
        connectedAt: now,
        expiresAt: null,
        id: 'binding-keep',
        lastErrorCategory: null,
        scopes: ['issues:read'],
        status: 'connected',
        updatedAt: now,
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('vault://');
      expect(serialized).not.toContain('binding-skip');
      expect(serialized).not.toContain('fingerprint-');
      const logged = debugLog.mock.calls
        .flat()
        .map((part) => String(part))
        .join(' ');
      expect(logged).toContain('missing published snapshot');
      expect(logged).toContain(skipped.id);
      expect(logged).not.toContain(kept.id);
    } finally {
      debugLog.mockRestore();
      debug.disable();
      if (previousDebug) debug.enable(previousDebug);
    }
  });

  it('refills past a page of missing snapshots and does not hide the following connector', async () => {
    const service = createService();
    const gap = row('a-gap', false);
    const keep = row('b-keep', true);
    const later = row('c-later', true);
    const { listConnectors } = installCatalog(service, [gap, keep, later]);

    const first = await service.listManaged({ limit: 1, query: 'issues' });
    expect(first.items.map((item) => item.key)).toEqual([keep.key]);
    expect(first.nextCursor).toBe(keep.key);
    expect(listConnectors.mock.calls[0]?.[0]).toEqual({
      cursor: undefined,
      enabled: true,
      limit: 1,
      query: 'issues',
      status: 'published',
    });
    expect(listConnectors.mock.calls[1]?.[0]).toEqual({
      cursor: { connectorKey: gap.key, id: gap.id },
      enabled: true,
      limit: 1,
      query: 'issues',
      status: 'published',
    });

    const second = await service.listManaged({ cursor: keep.key, limit: 1, query: 'issues' });
    expect(second.items.map((item) => item.key)).toEqual([later.key]);
    expect(second.nextCursor).toBeNull();
  });

  it('sets the cursor to the last returned connector when the limit is filled mid-page', async () => {
    const service = createService();
    const gap = row('a-gap', false);
    const keepA = row('b-keep', true);
    const keepB = row('c-keep', true);
    const keepC = row('d-keep', true);
    installCatalog(service, [gap, keepA, keepB, keepC]);

    const first = await service.listManaged({ limit: 2 });
    expect(first.items.map((item) => item.key)).toEqual([keepA.key, keepB.key]);
    expect(first.nextCursor).toBe(keepB.key);

    const second = await service.listManaged({ cursor: first.nextCursor ?? undefined, limit: 2 });
    expect(second.items.map((item) => item.key)).toEqual([keepC.key]);
    expect(second.nextCursor).toBeNull();
  });

  it('keeps a short page cursor at the last scanned row when the fetch bound is hit', async () => {
    const service = createService();
    const rows = [
      row('a-keep', true),
      row('a-skip', false),
      row('b-skip-a', false),
      row('b-skip-b', false),
      row('c-skip-a', false),
      row('c-skip-b', false),
      row('d-skip-a', false),
      row('d-skip-b', false),
      row('e-keep', true),
    ];
    const { listConnectors } = installCatalog(service, rows);

    const first = await service.listManaged({ limit: 2 });
    expect(listConnectors).toHaveBeenCalledTimes(MAX_PAGE_FETCHES);
    expect(first.items.map((item) => item.key)).toEqual(['a-keep']);
    expect(first.nextCursor).toBe('d-skip-b');

    const second = await service.listManaged({ cursor: 'd-skip-b', limit: 2 });
    expect(second.items.map((item) => item.key)).toEqual(['e-keep']);
    expect(second.nextCursor).toBeNull();
  });

  it('returns the catalog cursor when skipped snapshots exhaust the fetch bound', async () => {
    const service = createService();
    const rows = [
      row('s1', false),
      row('s2', false),
      row('s3', false),
      row('s4', false),
      row('s5', false),
      row('z-keep', true),
    ];
    const { listConnectors } = installCatalog(service, rows);

    const first = await service.listManaged({ limit: 1 });
    expect(listConnectors).toHaveBeenCalledTimes(MAX_PAGE_FETCHES);
    expect(first.items).toEqual([]);
    expect(first.nextCursor).toBe('s4');

    const second = await service.listManaged({ cursor: first.nextCursor ?? undefined, limit: 1 });
    expect(second.items.map((item) => item.key)).toEqual(['z-keep']);
    expect(second.nextCursor).toBeNull();
  });

  it('returns an empty page with a null cursor when every remaining snapshot is missing', async () => {
    const service = createService();
    const { listConnectors } = installCatalog(service, [row('s1', false), row('s2', false)]);

    const result = await service.listManaged({ limit: 1 });
    expect(listConnectors).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ items: [], nextCursor: null });
  });
});
