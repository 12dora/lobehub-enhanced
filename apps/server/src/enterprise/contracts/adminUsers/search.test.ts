import { describe, expect, it } from 'vitest';

import { adminUserSearchInputSchema, adminUserSearchOutputSchema } from './search';

describe('admin.users.search contract', () => {
  it('trims q, defaults limit to 20, and rejects empty q', () => {
    expect(adminUserSearchInputSchema.parse({ q: ' 邵军军 ' })).toEqual({
      limit: 20,
      q: '邵军军',
    });
    expect(adminUserSearchInputSchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(adminUserSearchInputSchema.safeParse({ limit: 51, q: 'a' }).success).toBe(false);
  });

  it('accepts UserPublicRef items including null display fields', () => {
    expect(
      adminUserSearchOutputSchema.parse({
        items: [
          {
            avatar: null,
            email: null,
            fullName: '邵军军',
            id: 'u1',
            username: null,
          },
        ],
      }).items,
    ).toHaveLength(1);
  });
});
