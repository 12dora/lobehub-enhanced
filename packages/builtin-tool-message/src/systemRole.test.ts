import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('message tool history budget', () => {
  it('caps readMessages pagination and asks the user to narrow a larger request', () => {
    expect(systemPrompt).toContain('at most 3 pages / 150 messages');
    expect(systemPrompt).toContain('ask the user to narrow');
    expect(systemPrompt).toContain('Do **not** keep paging');
    expect(systemPrompt).not.toContain('paginate with `readMessages`. Do **not** run');
  });
});
