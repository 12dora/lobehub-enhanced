import { describe, expect, it } from 'vitest';

import { ReminderManifest } from './manifest';
import { systemPrompt } from './systemRole';

describe('reminder systemRole', () => {
  it('is attached to the manifest', () => {
    expect(ReminderManifest.systemRole).toBe(systemPrompt);
  });

  it('requires directory search and forbids guessing same-name people', () => {
    expect(systemPrompt).toContain('searchDirectory');
    expect(systemPrompt).toContain('createReminder');
    expect(systemPrompt).toContain('ambiguous');
    expect(systemPrompt).toContain('姓名 · 最小部门');
    expect(systemPrompt).toContain('不要猜');
  });

  it('interprets times in Asia/Shanghai using serverNow', () => {
    expect(systemPrompt).toContain('Asia/Shanghai');
    expect(systemPrompt).toContain('serverNow');
    expect(systemPrompt).toContain('提前');
  });

  it('maps 每周/每天 to repeat and relays department confirmation', () => {
    expect(systemPrompt).toContain('每周');
    expect(systemPrompt).toContain('每天');
    expect(systemPrompt).toContain('needsConfirmation');
    expect(systemPrompt).toContain('30');
  });

  it('asks for a short structured confirmation after create', () => {
    expect(systemPrompt).toContain('收件人');
    expect(systemPrompt).toContain('时间');
    expect(systemPrompt).toContain('周期');
    expect(systemPrompt).toContain('内容');
  });
});
