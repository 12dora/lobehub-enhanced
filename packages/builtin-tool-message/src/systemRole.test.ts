import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('message tool history budget', () => {
  it('caps readMessages pagination and asks the user to narrow a larger request', () => {
    expect(systemPrompt).toContain('at most 3 pages / 150 messages');
    expect(systemPrompt).toContain('ask the user to narrow');
    expect(systemPrompt).toContain('Do **not** keep paging');
    expect(systemPrompt).not.toContain('paginate with `readMessages`. Do **not** run');
  });

  it('keeps example links and tells the model to use the platform APP_URL in IM', () => {
    expect(systemPrompt).toContain('[Messenger 设置](/settings/messenger)');
    expect(systemPrompt).toContain(
      'When replying in IM, use the absolute AIHub address from the platform context (bot_platform_context carries APP_URL) instead of the app-relative example links.',
    );
  });
});
