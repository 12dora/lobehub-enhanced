import type { LobeChatDatabase } from '@/database/type';
import type {
  AuditAction,
  AuditTargetType,
} from '@/server/enterprise/services/audit/auditActionCatalog';
import { PlatformAuditService } from '@/server/enterprise/services/platformAudit';

const AUDIT_ACTION = {
  aitable_records_create: 'dingtalk.personal.aitable.records.create',
  aitable_records_update: 'dingtalk.personal.aitable.records.update',
  authorize: 'dingtalk.personal.authorize',
  doc_append: 'dingtalk.personal.doc.append',
  doc_create: 'dingtalk.personal.doc.create',
  report_submit: 'dingtalk.personal.report.submit',
  revoke: 'dingtalk.personal.revoke',
  sheet_append: 'dingtalk.personal.sheet.append',
  todo_complete: 'dingtalk.personal.todo.complete',
  todo_update: 'dingtalk.personal.todo.update',
} as const;

export type DingtalkPersonalAuditAction =
  | 'aitable.records.create'
  | 'aitable.records.update'
  | 'authorize'
  | 'doc.append'
  | 'doc.create'
  | 'report.submit'
  | 'revoke'
  | 'sheet.append'
  | 'todo.complete'
  | 'todo.update';

const actionString = (action: DingtalkPersonalAuditAction): string => {
  switch (action) {
    case 'aitable.records.create': {
      return AUDIT_ACTION.aitable_records_create;
    }
    case 'aitable.records.update': {
      return AUDIT_ACTION.aitable_records_update;
    }
    case 'authorize': {
      return AUDIT_ACTION.authorize;
    }
    case 'doc.append': {
      return AUDIT_ACTION.doc_append;
    }
    case 'doc.create': {
      return AUDIT_ACTION.doc_create;
    }
    case 'report.submit': {
      return AUDIT_ACTION.report_submit;
    }
    case 'revoke': {
      return AUDIT_ACTION.revoke;
    }
    case 'sheet.append': {
      return AUDIT_ACTION.sheet_append;
    }
    case 'todo.complete': {
      return AUDIT_ACTION.todo_complete;
    }
    case 'todo.update': {
      return AUDIT_ACTION.todo_update;
    }
  }
};

/**
 * B2b adds these actions and the `dingtalk_personal` target to the audit catalog.
 * Until that lands, both are cast onto the current unions.
 * Authorize rows are idempotent on `dpp_<targetId>` so watcher and getLoginJob
 * do not double-write the same device login.
 */
export const appendDingtalkPersonalAudit = async (
  db: LobeChatDatabase,
  userId: string,
  action: DingtalkPersonalAuditAction,
  params: {
    afterDiff?: Record<string, unknown> | null;
    result?: 'failure' | 'success';
    targetId?: string;
  } = {},
): Promise<void> => {
  const full = actionString(action);
  await new PlatformAuditService(db).append({
    action: full as AuditAction,
    actorUserId: userId,
    afterDiff: params.afterDiff ?? null,
    ...(action === 'authorize' && params.targetId ? { id: `dpp_${params.targetId}` } : {}),
    result: params.result ?? 'success',
    targetId: params.targetId ?? null,
    targetType: 'dingtalk_personal' as AuditTargetType,
  });
};
