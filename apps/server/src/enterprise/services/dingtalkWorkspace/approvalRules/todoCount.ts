import { dingtalkWorkspaceRequest } from '../client';
import { DingtalkWorkspaceError } from '../errors';

/**
 * Cheap pending-OA-task count for one user.
 * `GET /v1.0/workflow/processes/todoTasks/numbers?userId=` → `{ result: number }`.
 *
 * Lives here (not `approval/api.ts`) so the rules worker can gate scans
 * without sharing that module with the approval-service agent.
 */
export const parsePendingApprovalTaskCount = (body: unknown): number => {
  const raw =
    typeof body === 'number'
      ? body
      : body && typeof body === 'object' && 'result' in body
        ? (body as { result: unknown }).result
        : undefined;

  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw));
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number.parseInt(raw.trim(), 10);
  throw new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE');
};

export const getPendingApprovalTaskCount = async (staffId: string): Promise<number> => {
  const userId = staffId.trim();
  if (!userId) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  const body = await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    method: 'GET',
    path: '/v1.0/workflow/processes/todoTasks/numbers',
    query: { userId },
  });
  return parsePendingApprovalTaskCount(body);
};
