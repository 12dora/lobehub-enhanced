import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { auditTargetDisplay } from './format';

const catalog: Record<string, string> = {
  'audit.logs.targetId.global': '全局',
  'audit.logs.targetType.audit_policy': '审计设置',
  'audit.logs.targetType.topic': '会话',
  'audit.logs.targetType.user': '用户',
};

const t = ((key: string, opts?: { defaultValue?: string }) =>
  catalog[key] ?? opts?.defaultValue ?? key) as unknown as TFunction<'admin'>;

describe('auditTargetDisplay', () => {
  it('prefers the server-resolved label over the raw id and keeps the id in the tooltip', () => {
    const display = auditTargetDisplay(t, {
      targetId: 'tpc_aQCv8pnTXPA7',
      targetLabel: 'Quarterly planning notes',
      targetType: 'topic',
    });
    expect(display.text).toBe('会话 · Quarterly planning notes');
    expect(display.tooltip).toBe('会话 · Quarterly planning notes\ntpc_aQCv8pnTXPA7');
    expect(display.rawId).toBe('tpc_aQCv8pnTXPA7');
  });

  it('localizes the global sentinel instead of printing the raw token', () => {
    for (const targetId of ['global', '__global__']) {
      const display = auditTargetDisplay(t, {
        targetId,
        targetLabel: null,
        targetType: 'audit_policy',
      });
      expect(display.text).toBe('审计设置 · 全局');
      expect(display.tooltip).toBe(`审计设置 · 全局\n${targetId}`);
    }
  });

  it('falls back to the raw id when no label is available (older backend / deleted row)', () => {
    const display = auditTargetDisplay(t, { targetId: 'user_HVPkuRpTERaJ', targetType: 'user' });
    expect(display.text).toBe('用户 · user_HVPkuRpTERaJ');
    // No duplicate id line when the name already is the id.
    expect(display.tooltip).toBe('用户 · user_HVPkuRpTERaJ');
  });

  it('ignores blank labels and humanizes unknown target types', () => {
    const display = auditTargetDisplay(t, {
      targetId: 'x_1',
      targetLabel: '   ',
      targetType: 'new_thing',
    });
    expect(display.text).toBe('New thing · x_1');
  });

  it('renders a dash when there is neither type nor id', () => {
    const display = auditTargetDisplay(t, { targetId: null, targetType: '' });
    expect(display.text).toBe('—');
    expect(display.tooltip).toBe('—');
  });
});
