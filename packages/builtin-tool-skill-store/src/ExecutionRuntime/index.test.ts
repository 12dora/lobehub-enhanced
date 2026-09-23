import { describe, expect, it, vi } from 'vitest';

import { SkillStoreExecutionRuntime, type SkillStoreRuntimeService } from './index';

const service = (
  searchSkill?: SkillStoreRuntimeService['searchSkill'],
): SkillStoreRuntimeService => ({
  importFromGitHub: vi.fn(),
  importFromUrl: vi.fn(),
  importFromZipUrl: vi.fn(),
  ...(searchSkill ? { searchSkill } : {}),
});

describe('SkillStoreExecutionRuntime.searchSkill', () => {
  it('reports market search as unavailable when the service does not expose it', async () => {
    const runtime = new SkillStoreExecutionRuntime({ service: service() });

    const result = await runtime.searchSkill({ q: '钉钉' });

    expect(result).toEqual({
      content: 'Market skill search is not available in this environment.',
      success: false,
    });
  });

  it('treats a 401 unauthorized market response like a missing search', async () => {
    const searchSkill = vi.fn().mockRejectedValue(
      Object.assign(new Error('unauthorized'), {
        errorBody: { error: 'unauthorized', error_description: 'Missing bearer token' },
        status: 401,
      }),
    );
    const runtime = new SkillStoreExecutionRuntime({ service: service(searchSkill) });

    const result = await runtime.searchSkill({ q: '库存' });

    expect(result.success).toBe(false);
    expect(result.content).toBe('Market skill search is not available in this environment.');
    expect(result.content).not.toContain('Failed to search skills');
  });

  it('keeps a non-auth search failure', async () => {
    const searchSkill = vi.fn().mockRejectedValue(new Error('market down'));
    const runtime = new SkillStoreExecutionRuntime({ service: service(searchSkill) });

    const result = await runtime.searchSkill({});

    expect(result.content).toBe('Failed to search skills: market down');
  });
});
