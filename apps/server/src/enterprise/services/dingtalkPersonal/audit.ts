import type { LobeChatDatabase } from '@/database/type';
import type {
  AuditAction,
  AuditTargetType,
} from '@/server/enterprise/services/audit/auditActionCatalog';
import { PlatformAuditService } from '@/server/enterprise/services/platformAudit';

const AUDIT_ACTION = {
  authorize: 'dingtalk.personal.authorize',
  report_submit: 'dingtalk.personal.report.submit',
  revoke: 'dingtalk.personal.revoke',
  todo_complete: 'dingtalk.personal.todo.complete',
  todo_update: 'dingtalk.personal.todo.update',
} as const;

export type DingtalkPersonalAuditAction =
  'authorize' | 'revoke' | 'todo.update' | 'todo.complete' | 'report.submit';

const actionString = (action: DingtalkPersonalAuditAction): string => {
  switch (action) {
    case 'authorize': {
      return AUDIT_ACTION.authorize;
    }
    case 'report.submit': {
      return AUDIT_ACTION.report_submit;
    }
    case 'revoke': {
      return AUDIT_ACTION.revoke;
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
