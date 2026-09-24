import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTION,
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPE,
  AUDIT_TARGET_TYPES,
} from './auditActionCatalog';

describe('dingtalk personal audit catalog', () => {
  it('catalogues the five personal actions and the target type', () => {
    const actions = [
      'dingtalk.personal.authorize',
      'dingtalk.personal.revoke',
      'dingtalk.personal.todo.update',
      'dingtalk.personal.todo.complete',
      'dingtalk.personal.report.submit',
    ] as const;

    for (const action of actions) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(AUDIT_ACTION.DINGTALK_PERSONAL_AUTHORIZE).toBe('dingtalk.personal.authorize');
    expect(AUDIT_ACTION.DINGTALK_PERSONAL_REVOKE).toBe('dingtalk.personal.revoke');
    expect(AUDIT_ACTION.DINGTALK_PERSONAL_TODO_UPDATE).toBe('dingtalk.personal.todo.update');
    expect(AUDIT_ACTION.DINGTALK_PERSONAL_TODO_COMPLETE).toBe('dingtalk.personal.todo.complete');
    expect(AUDIT_ACTION.DINGTALK_PERSONAL_REPORT_SUBMIT).toBe('dingtalk.personal.report.submit');
    expect(AUDIT_TARGET_TYPES).toContain('dingtalk_personal');
    expect(new Set(AUDIT_TARGET_TYPES).size).toBe(AUDIT_TARGET_TYPES.length);
    expect(AUDIT_TARGET_TYPE.DINGTALK_PERSONAL).toBe('dingtalk_personal');
  });
});
