import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('remote device system prompt', () => {
  it('keeps example links and tells the model to use the platform APP_URL in IM', () => {
    expect(systemPrompt).toContain('[下载桌面端](/downloads)');
    expect(systemPrompt).toContain('[设备页](/settings/devices)');
    expect(systemPrompt).toContain(
      'When replying in IM, use the absolute AIHub address from the platform context (bot_platform_context carries APP_URL) instead of the app-relative example links.',
    );
  });
});
