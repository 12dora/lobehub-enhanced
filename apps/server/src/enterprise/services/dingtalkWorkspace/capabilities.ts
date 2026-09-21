import type { ApprovalAutomationTier } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';
import { and, eq, isNotNull } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { SystemBotProviderModel } from '@/database/models/systemBotProvider';
import { dingtalkDirectoryUsers } from '@/database/schemas';
import { dingTalkConnectorSettingsSchema } from '@/server/enterprise/contracts/adminImConnectors';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  readNotifyAppFromProviderRow,
  resolveNotifyAppConfig,
} from '@/server/services/messenger/platforms/dingtalk/notifyApp';

import { dingtalkWorkspaceRequest } from './client';
import { DingtalkWorkspaceError } from './errors';

const log = debug('lobe-server:dingtalk-workspace:capabilities');

export const DINGTALK_WORKSPACE_CAPABILITIES_CACHE_MS = 30_000;

export type DingtalkWorkspaceFeature = 'approval' | 'calendar' | 'todo';

export interface DingtalkWorkspaceCapabilities {
  approval: boolean;
  automationTier: ApprovalAutomationTier;
  calendar: boolean;
  todo: boolean;
}

export type DingtalkPermissionProbeReason = 'forbidden' | 'not_configured' | 'unreachable';

export interface DingtalkPermissionProbe {
  missingScopes?: string[];
  ok: boolean;
  reason?: DingtalkPermissionProbeReason;
}

export interface DingtalkWorkspacePermissionProbe {
  approval: DingtalkPermissionProbe;
  calendar: DingtalkPermissionProbe;
  todo: DingtalkPermissionProbe;
}

const DEFAULT_TIER: ApprovalAutomationTier = 'moderate';
const TIERS = new Set<ApprovalAutomationTier>(['moderate', 'off', 'relaxed', 'strict']);

const APPROVAL_SCOPES = ['Workflow.Form.Read'];
const TODO_SCOPES = ['Todo.Todo.Read'];
const CALENDAR_SCOPES = ['Calendar.Event.Read'];

interface CapabilitiesSnapshot extends DingtalkWorkspaceCapabilities {
  fetchedAt: number;
  notifyConfigured: boolean;
}

let cache: CapabilitiesSnapshot | null = null;

export const resetDingtalkWorkspaceCapabilitiesCacheForTest = (): void => {
  cache = null;
};

export const invalidateDingtalkWorkspaceCapabilities = (): void => {
  cache = null;
};

const asTier = (value: unknown): ApprovalAutomationTier =>
  typeof value === 'string' && TIERS.has(value as ApprovalAutomationTier)
    ? (value as ApprovalAutomationTier)
    : DEFAULT_TIER;

const parseWorkspaceSwitches = (
  raw: Record<string, unknown> | undefined,
): {
  approval: boolean;
  automationTier: ApprovalAutomationTier;
  calendar: boolean;
  todo: boolean;
} => {
  const parsed = dingTalkConnectorSettingsSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return {
      approval: parsed.data.workspaceApprovalEnabled,
      automationTier: parsed.data.approvalAutomationTier,
      calendar: parsed.data.workspaceCalendarEnabled,
      todo: parsed.data.workspaceTodoEnabled,
    };
  }
  return {
    approval: raw?.workspaceApprovalEnabled === true,
    automationTier: asTier(raw?.approvalAutomationTier),
    calendar: raw?.workspaceCalendarEnabled === true,
    todo: raw?.workspaceTodoEnabled === true,
  };
};

const loadSnapshot = async (): Promise<CapabilitiesSnapshot> => {
  const now = Date.now();
  if (cache && cache.fetchedAt + DINGTALK_WORKSPACE_CAPABILITIES_CACHE_MS > now) return cache;

  const empty: CapabilitiesSnapshot = {
    approval: false,
    automationTier: DEFAULT_TIER,
    calendar: false,
    fetchedAt: now,
    notifyConfigured: false,
    todo: false,
  };

  try {
    const db = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
    const row = await SystemBotProviderModel.findByPlatform(db, 'dingtalk', gateKeeper);
    const notify = row
      ? readNotifyAppFromProviderRow({
          credentials: row.credentials,
          settings: row.settings,
        })
      : null;
    const switches = parseWorkspaceSwitches(
      isRecord(row?.settings) ? (row?.settings as Record<string, unknown>) : undefined,
    );
    const notifyConfigured = Boolean(notify);
    cache = {
      approval: notifyConfigured && switches.approval,
      automationTier: switches.automationTier,
      calendar: notifyConfigured && switches.calendar,
      fetchedAt: now,
      notifyConfigured,
      todo: notifyConfigured && switches.todo,
    };
    return cache;
  } catch (error) {
    log('load capabilities failed: %O', error instanceof Error ? error.name : 'UnknownError');
    cache = empty;
    return empty;
  }
};

export const getDingtalkWorkspaceCapabilities =
  async (): Promise<DingtalkWorkspaceCapabilities> => {
    const snapshot = await loadSnapshot();
    return {
      approval: snapshot.approval,
      automationTier: snapshot.automationTier,
      calendar: snapshot.calendar,
      todo: snapshot.todo,
    };
  };

/** Sync peek of the last loaded snapshot. Null when the cache is cold. Fail-closed. */
export const peekDingtalkWorkspaceCapabilities = (): DingtalkWorkspaceCapabilities | null => {
  if (!cache) return null;
  return {
    approval: cache.approval,
    automationTier: cache.automationTier,
    calendar: cache.calendar,
    todo: cache.todo,
  };
};

export const assertDingtalkFeature = async (feature: DingtalkWorkspaceFeature): Promise<void> => {
  const snapshot = await loadSnapshot();
  if (!snapshot.notifyConfigured) throw new DingtalkWorkspaceError('DINGTALK_NOT_CONFIGURED');
  if (!snapshot[feature]) throw new DingtalkWorkspaceError('DINGTALK_FEATURE_DISABLED');
};

const notConfigured = (): DingtalkPermissionProbe => ({ ok: false, reason: 'not_configured' });

const probeFromError = (error: unknown, missingScopes: string[]): DingtalkPermissionProbe => {
  if (error instanceof DingtalkWorkspaceError) {
    if (error.code === 'DINGTALK_NOT_CONFIGURED') return notConfigured();
    if (error.code === 'DINGTALK_FORBIDDEN') {
      return { missingScopes, ok: false, reason: 'forbidden' };
    }
    return { ok: false, reason: 'unreachable' };
  }
  return { ok: false, reason: 'unreachable' };
};

const firstActiveDirectoryProbeUser = async (): Promise<{
  staffId: string;
  unionId: string;
} | null> => {
  try {
    const db = await getServerDB();
    const [row] = await db
      .select({
        staffId: dingtalkDirectoryUsers.staffId,
        unionId: dingtalkDirectoryUsers.unionId,
      })
      .from(dingtalkDirectoryUsers)
      .where(
        and(eq(dingtalkDirectoryUsers.active, true), isNotNull(dingtalkDirectoryUsers.unionId)),
      )
      .limit(1);
    const unionId = typeof row?.unionId === 'string' ? row.unionId.trim() : '';
    const staffId = typeof row?.staffId === 'string' ? row.staffId.trim() : '';
    if (!unionId || !staffId) return null;
    return { staffId, unionId };
  } catch {
    return null;
  }
};

const probeApproval = async (): Promise<DingtalkPermissionProbe> => {
  try {
    await dingtalkWorkspaceRequest({
      api: 'v1',
      method: 'GET',
      path: '/v1.0/workflow/processes/userVisibilities/templates',
      query: { maxResults: 1, nextToken: 0 },
    });
    return { ok: true };
  } catch (error) {
    return probeFromError(error, APPROVAL_SCOPES);
  }
};

const probeTodo = async (unionId: string): Promise<DingtalkPermissionProbe> => {
  try {
    await dingtalkWorkspaceRequest({
      api: 'v1',
      body: { isDone: false, nextToken: '' },
      method: 'POST',
      path: `/v1.0/todo/users/${encodeURIComponent(unionId)}/org/tasks/query`,
    });
    return { ok: true };
  } catch (error) {
    return probeFromError(error, TODO_SCOPES);
  }
};

const probeCalendar = async (unionId: string): Promise<DingtalkPermissionProbe> => {
  const from = new Date();
  const to = new Date(from.getTime() + 60 * 60_000);
  try {
    await dingtalkWorkspaceRequest({
      api: 'v1',
      method: 'GET',
      path: `/v1.0/calendar/users/${encodeURIComponent(unionId)}/calendars/primary/events`,
      query: {
        maxResults: 1,
        timeMax: to.toISOString(),
        timeMin: from.toISOString(),
      },
    });
    return { ok: true };
  } catch (error) {
    return probeFromError(error, CALENDAR_SCOPES);
  }
};

/**
 * Cheap read-only permission probes with the notify-app token.
 */
export const probeWorkspacePermissions = async (): Promise<DingtalkWorkspacePermissionProbe> => {
  const notify = await resolveNotifyAppConfig();
  if (!notify) {
    return {
      approval: notConfigured(),
      calendar: notConfigured(),
      todo: notConfigured(),
    };
  }

  const probeUser = await firstActiveDirectoryProbeUser();
  const unreachable: DingtalkPermissionProbe = { ok: false, reason: 'unreachable' };
  const [approval, todo, calendar] = await Promise.all([
    probeApproval(),
    probeUser ? probeTodo(probeUser.unionId) : Promise.resolve(unreachable),
    probeUser ? probeCalendar(probeUser.unionId) : Promise.resolve(unreachable),
  ]);
  return { approval, calendar, todo };
};
