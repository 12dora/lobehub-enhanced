import { describe, expect, it } from 'vitest';

import { createSystemRole } from './systemRole';

describe('web-onboarding createSystemRole', () => {
  it('requires a SOUL.md write before finish when the inbox is not managed', () => {
    const role = createSystemRole();

    expect(role).toContain('Persist SOUL.md');
    expect(role).toContain('updateDocument(type="soul")');
    expect(role).toContain('Only after both documents reflect the session, call finishOnboarding.');
    expect(role).not.toContain('The assistant persona is managed by the organisation');
  });

  it('does not demand a SOUL.md write when the inbox is managed', () => {
    const role = createSystemRole('zh-CN', { isManagedInbox: true });

    expect(role).toContain(
      'The assistant persona (name, avatar, and SOUL.md) is managed by the organisation',
    );
    expect(role).toContain('Continue with the user persona only.');
    expect(role).toContain('Do not write or update SOUL.md.');
    expect(role).not.toContain('Persist SOUL.md');
    expect(role).not.toContain('If SOUL.md is missing agent identity');
    expect(role).not.toContain('patch SOUL.md / Persona');
    expect(role).toContain(
      'Only after the persona document reflects the session, call finishOnboarding.',
    );
    expect(role).toContain('Preferred reply language: zh-CN');
  });
});
