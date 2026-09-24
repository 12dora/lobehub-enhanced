import { describe, expect, it } from 'vitest';

import type { DecryptedConnector } from '@/database/models/connector';
import type { ConnectorCredentials, UserConnectorToolItem } from '@/database/schemas';

import { buildConnectorManifests } from './buildConnectorManifests';

const httpConnector = (
  credentials: ConnectorCredentials | null,
  metadata?: Record<string, unknown>,
): DecryptedConnector =>
  ({
    credentials,
    id: 'c1',
    identifier: 'my-conn',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example.com',
    mcpStdioConfig: null,
    metadata: metadata ?? null,
    name: 'My Connector',
    oidcConfig: null,
  }) as any;

const tool = (): UserConnectorToolItem =>
  ({
    crudType: 'read',
    id: 't1',
    inputSchema: { properties: {}, type: 'object' },
    permission: 'auto',
    toolName: 'doThing',
    userConnectorId: 'c1',
  }) as any;

const mcpParamsOf = (connector: DecryptedConnector) => {
  const [manifest] = buildConnectorManifests([connector], [tool()]);
  // mcpParams is a runtime-only field not in the public ToolManifest type.
  return (manifest as any).mcpParams as { auth?: unknown; headers?: Record<string, string> };
};

describe('buildConnectorManifests mcpParams headers', () => {
  it('merges metadata.customHeaders alongside bearer auth', () => {
    const params = mcpParamsOf(
      httpConnector({ token: 'tok', type: 'bearer' }, { customHeaders: { 'X-Tenant': 't1' } }),
    );

    expect(params.auth).toEqual({ token: 'tok', type: 'bearer' });
    expect(params.headers).toEqual({ 'X-Tenant': 't1' });
  });

  it('applies metadata.customHeaders with no auth credential', () => {
    const params = mcpParamsOf(httpConnector(null, { customHeaders: { 'X-Api-Key': 'abc' } }));

    expect(params.auth).toBeUndefined();
    expect(params.headers).toEqual({ 'X-Api-Key': 'abc' });
  });

  it('lets metadata.customHeaders override legacy header-credential keys', () => {
    const params = mcpParamsOf(
      httpConnector(
        { headers: { Authorization: 'Token old' }, type: 'header' },
        { customHeaders: { Authorization: 'Token new' } },
      ),
    );

    expect(params.headers).toEqual({ Authorization: 'Token new' });
  });

  it('leaves headers undefined when there are none (unchanged behavior)', () => {
    const params = mcpParamsOf(httpConnector({ token: 'tok', type: 'bearer' }));

    expect(params.auth).toEqual({ token: 'tok', type: 'bearer' });
    expect(params.headers).toBeUndefined();
  });
});

describe('buildConnectorManifests disabled tools', () => {
  const disabledTool = (): UserConnectorToolItem => ({ ...tool(), permission: 'disabled' }) as any;

  it('tells the model where the user switches the tool back on, as a markdown link', () => {
    const [manifest] = buildConnectorManifests([httpConnector(null)], [disabledTool()]);

    expect(manifest.api[0].description).toContain('[TOOL DISABLED]');
    expect(manifest.api[0].description).toContain('"doThing"');
    expect(manifest.api[0].description).toContain('[设置 → 连接器](/settings/connector)');
    expect(manifest.api[0].humanIntervention).toBe('required');
  });

  it('uses the resolver for an absolute link on IM turns', () => {
    const [manifest] = buildConnectorManifests(
      [httpConnector(null)],
      [disabledTool()],
      (path) => `https://aihub.example.com/dingtalk/sso?redirect=${encodeURIComponent(path)}`,
    );

    expect(manifest.api[0].description).toContain(
      '[设置 → 连接器](https://aihub.example.com/dingtalk/sso?redirect=%2Fsettings%2Fconnector)',
    );
  });
});
