// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  adminPlatformAgentProvisionTaskManagerInputSchema,
  adminPlatformAgentProvisionTaskManagerOutputSchema,
} from '../../contracts/platformAgents';
import { adminAgentsRouter } from './agents';

describe('adminAgentsRouter provisionTaskManager', () => {
  it('registers a mutation next to provisionDefaultInbox', () => {
    const record = (
      adminAgentsRouter as unknown as {
        _def: { record: Record<string, { _def: { type: string } }> };
      }
    )._def.record;

    expect(record.provisionTaskManager?._def.type).toBe('mutation');
    expect(record.provisionDefaultInbox?._def.type).toBe('mutation');
  });

  it('accepts the same optional locale payload as provisionDefaultInbox and returns a get-shaped output', () => {
    expect(adminPlatformAgentProvisionTaskManagerInputSchema.safeParse(undefined).success).toBe(
      true,
    );
    expect(
      adminPlatformAgentProvisionTaskManagerInputSchema.safeParse({ locale: 'zh-CN' }).success,
    ).toBe(true);
    expect(
      adminPlatformAgentProvisionTaskManagerOutputSchema.safeParse({
        draftToken: 'b'.repeat(64),
        identity: {
          agentKey: 'task-manager',
          currentVersionId: 'version-id',
          draftSequence: 1,
          id: 'agent-id',
          isDefault: false,
          migrationRequired: false,
          revision: 1,
          status: 'published',
          systemKey: 'task-manager',
        },
      }).success,
    ).toBe(true);
    expect(
      adminPlatformAgentProvisionTaskManagerOutputSchema.safeParse({
        created: true,
        identityId: 'agent-id',
      }).success,
    ).toBe(false);
  });
});
