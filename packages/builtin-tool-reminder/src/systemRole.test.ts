import { describe, expect, it } from 'vitest';

import { ReminderManifest } from './manifest';
import { systemPrompt } from './systemRole';

describe('reminder systemRole', () => {
  it('is attached to the manifest', () => {
    expect(ReminderManifest.systemRole).toBe(systemPrompt);
  });

  it('stays within the 900-character budget', () => {
    expect(systemPrompt.length).toBeLessThanOrEqual(900);
  });

  it('creates in one call from names and asks on clarification/confirmation', () => {
    expect(systemPrompt).toContain('createReminder');
    expect(systemPrompt).toContain('一次调用');
    expect(systemPrompt).toContain('姓名·部门');
    expect(systemPrompt).toContain('needs_clarification');
    expect(systemPrompt).toContain('姓名 · 部门');
    expect(systemPrompt).toContain('needs_confirmation');
    expect(systemPrompt).not.toContain('必须先调用 searchDirectory');
  });

  it('interprets times in Asia/Shanghai using serverNow', () => {
    expect(systemPrompt).toContain('Asia/Shanghai');
    expect(systemPrompt).toContain('serverNow');
  });

  it('maps 每天/每周/每月 to schedule kinds', () => {
    expect(systemPrompt).toContain('每天');
    expect(systemPrompt).toContain('每周');
    expect(systemPrompt).toContain('每月');
    expect(systemPrompt).toContain('once');
  });

  it('asks for a short structured confirmation after create', () => {
    expect(systemPrompt).toContain('收件人');
    expect(systemPrompt).toContain('时间');
    expect(systemPrompt).toContain('周期');
    expect(systemPrompt).toContain('内容');
    expect(systemPrompt).toContain('任务编号');
  });
});
