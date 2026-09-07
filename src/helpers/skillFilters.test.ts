import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectDisabledSkillIds,
  filterBuiltinSkills,
  shouldEnableBuiltinSkill,
  withDisabledSkillGuard,
} from './skillFilters';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('skillFilters', () => {
  it('should disable agent-browser when the run cannot execute on a device', () => {
    expect(shouldEnableBuiltinSkill('lobe-agent-browser', { canExecuteOnDevice: false })).toBe(
      false,
    );
  });

  it('should disable task builtin skill globally', () => {
    expect(shouldEnableBuiltinSkill('task', { canExecuteOnDevice: false })).toBe(false);
    expect(shouldEnableBuiltinSkill('task', { canExecuteOnDevice: true })).toBe(false);
  });

  it('should enable agent-browser when the run can execute on a device', () => {
    expect(shouldEnableBuiltinSkill('lobe-agent-browser', { canExecuteOnDevice: true })).toBe(true);
  });

  it('should not be affected by Windows platform detection when device execution is enabled', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    vi.resetModules();

    const { shouldEnableBuiltinSkill } = await import('./skillFilters');

    expect(shouldEnableBuiltinSkill('lobe-agent-browser', { canExecuteOnDevice: true })).toBe(true);
  });

  it('should keep non-device-only skills enabled', () => {
    expect(shouldEnableBuiltinSkill('lobe-artifacts', { canExecuteOnDevice: false })).toBe(true);
  });

  it('should filter builtin skills by device execution context', () => {
    const skills = [
      {
        content: 'agent-browser',
        description: 'agent-browser',
        identifier: 'lobe-agent-browser',
        name: 'Agent Browser',
        source: 'builtin' as const,
      },
      {
        content: 'artifacts',
        description: 'artifacts',
        identifier: 'lobe-artifacts',
        name: 'Artifacts',
        source: 'builtin' as const,
      },
      {
        content: 'task',
        description: 'task',
        identifier: 'task',
        name: 'Task',
        source: 'builtin' as const,
      },
    ];

    const filtered = filterBuiltinSkills(skills, { canExecuteOnDevice: false });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].identifier).toBe('lobe-artifacts');
  });

  describe('collectDisabledSkillIds', () => {
    it('unions both user lists', () => {
      expect([
        ...collectDisabledSkillIds({
          disabledSkillIdentifiers: ['my-skill'],
          uninstalledBuiltinTools: ['lobe-artifacts'],
        }),
      ]).toEqual(['lobe-artifacts', 'my-skill']);
    });

    it('drops mandatory catalog keys, even when a stale entry exists', () => {
      expect([
        ...collectDisabledSkillIds({
          disabledSkillIdentifiers: ['org-skill', 'my-skill'],
          mandatorySkillIds: ['org-skill'],
        }),
      ]).toEqual(['my-skill']);
    });

    it('returns an empty set when nothing is configured', () => {
      expect(collectDisabledSkillIds({}).size).toBe(0);
    });
  });

  describe('withDisabledSkillGuard', () => {
    const service = {
      findAll: async () => ({
        data: [{ identifier: 'blocked' }, { identifier: 'allowed' }] as any,
        total: 2,
      }),
      findById: async (id: string) =>
        ({ id, identifier: id === 'x' ? 'blocked' : 'allowed' }) as any,
      findByName: async (name: string) => ({ identifier: name }) as any,
      readResource: async () => ({}) as any,
    };

    it('returns the original service when nothing is disabled', () => {
      expect(withDisabledSkillGuard(service, new Set())).toBe(service);
    });

    it('hides disabled skills from every lookup', async () => {
      const guarded = withDisabledSkillGuard(service, new Set(['blocked']));

      expect(await guarded.findById('x')).toBeUndefined();
      expect(await guarded.findByName('blocked')).toBeUndefined();
      expect(await guarded.findById('y')).toMatchObject({ identifier: 'allowed' });
      expect(await guarded.findAll()).toEqual({ data: [{ identifier: 'allowed' }], total: 1 });
    });

    it('keeps the extra members of the wrapped service', () => {
      const guarded = withDisabledSkillGuard(service, new Set(['blocked']));

      expect(typeof guarded.readResource).toBe('function');
    });
  });
});
