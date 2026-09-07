import { describe, expect, it } from 'vitest';

import { collectUserDisabledSkillIds, resolveDisabledSkillIds } from './disabledSkills';

describe('collectUserDisabledSkillIds', () => {
  it('unions the personal builtin uninstall list with disabled skill identifiers', () => {
    expect(
      collectUserDisabledSkillIds({
        toolConfig: {
          disabledSkillIdentifiers: ['market-skill'],
          uninstalledBuiltinTools: ['lobe-artifacts'],
        },
      }),
    ).toEqual(new Set(['lobe-artifacts', 'market-skill']));
  });

  it('uses the workspace lists and does not inherit the personal lists', () => {
    expect(
      collectUserDisabledSkillIds({
        toolConfig: {
          disabledSkillIdentifiers: ['personal-skill'],
          disabledSkillIdentifiersByWorkspace: { 'ws-1': ['workspace-skill'] },
          uninstalledBuiltinTools: ['lobe-artifacts'],
          uninstalledBuiltinToolsByWorkspace: { 'ws-1': ['document-processing'] },
        },
        workspaceId: 'ws-1',
      }),
    ).toEqual(new Set(['document-processing', 'workspace-skill']));
  });

  it('treats a workspace with no stored entry as empty rather than the personal list', () => {
    expect(
      collectUserDisabledSkillIds({
        toolConfig: {
          disabledSkillIdentifiers: ['personal-skill'],
          uninstalledBuiltinTools: ['lobe-artifacts'],
        },
        workspaceId: 'ws-missing',
      }),
    ).toEqual(new Set());
  });

  it('returns an empty set when no tool config is present', () => {
    expect(collectUserDisabledSkillIds({})).toEqual(new Set());
    expect(collectUserDisabledSkillIds({ workspaceId: 'ws-1' })).toEqual(new Set());
  });
});

describe('resolveDisabledSkillIds', () => {
  it('unions agent plugin tri-state with the user-scope set', () => {
    expect(
      resolveDisabledSkillIds({
        agentPlugins: ['pinned-skill', { identifier: 'agent-disabled', mode: 'disabled' }],
        toolConfig: {
          disabledSkillIdentifiers: ['market-skill'],
          uninstalledBuiltinTools: ['lobe-artifacts'],
        },
      }),
    ).toEqual(new Set(['agent-disabled', 'lobe-artifacts', 'market-skill']));
  });

  it('subtracts mandatory keys even when they appear in the user or platform lists', () => {
    expect(
      resolveDisabledSkillIds({
        agentPlugins: [{ identifier: 'mandatory.skill', mode: 'disabled' }],
        mandatoryKeys: ['mandatory.skill', 'org.required'],
        platformDisabledKeys: ['org.required', 'org.optional'],
        toolConfig: { disabledSkillIdentifiers: ['mandatory.skill', 'user-skill'] },
      }),
    ).toEqual(new Set(['org.optional', 'user-skill']));
  });

  it('does not inherit personal disables while a workspace is active', () => {
    expect(
      resolveDisabledSkillIds({
        agentPlugins: [{ identifier: 'agent-disabled', mode: 'disabled' }],
        toolConfig: {
          disabledSkillIdentifiers: ['personal-skill'],
          uninstalledBuiltinTools: ['lobe-artifacts'],
        },
        workspaceId: 'ws-1',
      }),
    ).toEqual(new Set(['agent-disabled']));
  });
});
