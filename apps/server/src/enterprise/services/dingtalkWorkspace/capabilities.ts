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
import { CUSTOM_TODO_READ_SCOPE, peekOrgTodoReadGate } from './todo/orgReadGate';

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
  /** https://open-dev.dingtalk.com apply link, when DingTalk returned one. */
  applyUrl?: string;
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

const APPROVAL_FORM_READ_SCOPES = ['Workflow.Form.Read'];
const APPROVAL_INSTANCE_WRITE_SCOPES = ['Workflow.Instance.Write'];
const TODO_READ_SCOPES = ['Todo.Todo.Read'];
const TODO_WRITE_SCOPES = ['Todo.Todo.Write'];
const CUSTOM_TODO_READ_SCOPES = [CUSTOM_TODO_READ_SCOPE];
const CALENDAR_EVENT_READ_SCOPES = ['Calendar.Event.Read'];
const CALENDAR_EVENT_WRITE_SCOPES = ['Calendar.Event.Write'];
const CALENDAR_SCHEDULE_READ_SCOPES = ['Calendar.EventSchedule.Read'];
const CALENDAR_ROOMS_SCOPES = ['VideoConference.Conference.Read'];

/** Write-scope probes POST this exact payload. Never retry them with a filled body. */
const EMPTY_WRITE_PROBE_BODY = Object.freeze({}) as Record<string, never>;

const MAX_PROBE_MISSING_SCOPES = 16;

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

type SubProbeOutcome =
  | { kind: 'ignore' }
  | { applyUrl?: string; kind: 'missing'; scopes: string[] }
  | { kind: 'not_configured' }
  | { kind: 'ok' }
  | { kind: 'unreachable' };

type SubProbeKind = 'read' | 'warning' | 'write';

const scopesFromError = (error: DingtalkWorkspaceError, fallback: readonly string[]): string[] => {
  if (error.missingScopes && error.missingScopes.length > 0) return error.missingScopes;
  return [...fallback];
};

const outcomeFromWriteOrWarning = (
  error: unknown,
  fallback: readonly string[],
): SubProbeOutcome => {
  if (error instanceof DingtalkWorkspaceError) {
    if (error.code === 'DINGTALK_NOT_CONFIGURED') return { kind: 'not_configured' };
    if (error.code === 'DINGTALK_FORBIDDEN') {
      return {
        applyUrl: error.applyUrl,
        kind: 'missing',
        scopes: scopesFromError(error, fallback),
      };
    }
    // Scope is checked before the body: 400/404 means the scope is present.
    if (error.code === 'DINGTALK_INVALID' || error.code === 'DINGTALK_NOT_FOUND') {
      return { kind: 'ok' };
    }
    // Rate limit / 5xx / timeout: do not fail the capability.
    return { kind: 'ignore' };
  }
  return { kind: 'ignore' };
};

const outcomeFromRead = (error: unknown, fallback: readonly string[]): SubProbeOutcome => {
  if (error instanceof DingtalkWorkspaceError) {
    if (error.code === 'DINGTALK_NOT_CONFIGURED') return { kind: 'not_configured' };
    if (error.code === 'DINGTALK_FORBIDDEN') {
      return {
        applyUrl: error.applyUrl,
        kind: 'missing',
        scopes: scopesFromError(error, fallback),
      };
    }
    return { kind: 'unreachable' };
  }
  return { kind: 'unreachable' };
};

const runSubProbe = async (
  kind: SubProbeKind,
  fallback: readonly string[],
  request: () => Promise<unknown>,
): Promise<SubProbeOutcome> => {
  try {
    await request();
    return { kind: 'ok' };
  } catch (error) {
    if (kind === 'read') return outcomeFromRead(error, fallback);
    return outcomeFromWriteOrWarning(error, fallback);
  }
};

const mergeProbeOutcomes = (
  outcomes: Array<{ outcome: SubProbeOutcome; required: boolean }>,
): DingtalkPermissionProbe => {
  const missing: string[] = [];
  const seen = new Set<string>();
  let applyUrl: string | undefined;
  let requiredMissing = false;
  let sawNotConfigured = false;
  let requiredUnreachable = false;

  const addScopes = (scopes: string[]) => {
    for (const scope of scopes) {
      if (!scope || seen.has(scope)) continue;
      seen.add(scope);
      if (missing.length < MAX_PROBE_MISSING_SCOPES) missing.push(scope);
    }
  };

  for (const { outcome, required } of outcomes) {
    switch (outcome.kind) {
      case 'missing': {
        addScopes(outcome.scopes);
        if (!applyUrl && outcome.applyUrl) applyUrl = outcome.applyUrl;
        if (required) requiredMissing = true;
        break;
      }
      case 'not_configured': {
        sawNotConfigured = true;
        break;
      }
      case 'unreachable': {
        if (required) requiredUnreachable = true;
        break;
      }
      default: {
        break;
      }
    }
  }

  const withApply = <T extends DingtalkPermissionProbe>(probe: T): T =>
    applyUrl ? { ...probe, applyUrl } : probe;

  if (requiredMissing) {
    return withApply({ missingScopes: missing, ok: false, reason: 'forbidden' });
  }
  if (sawNotConfigured) return notConfigured();
  if (requiredUnreachable) return { ok: false, reason: 'unreachable' };
  if (missing.length > 0) return withApply({ missingScopes: missing, ok: true });
  return { ok: true };
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

const probeApproval = async (staffId: string): Promise<DingtalkPermissionProbe> => {
  const outcomes: Array<{ outcome: SubProbeOutcome; required: boolean }> = [
    {
      required: true,
      outcome: await runSubProbe('read', APPROVAL_FORM_READ_SCOPES, () =>
        dingtalkWorkspaceRequest({
          recordError: false,
          api: 'v1',
          method: 'GET',
          path: '/v1.0/workflow/processes/userVisibilities/templates',
          query: { userId: staffId, maxResults: 1, nextToken: 0 },
        }),
      ),
    },
    {
      required: true,
      outcome: await runSubProbe('write', APPROVAL_INSTANCE_WRITE_SCOPES, () =>
        dingtalkWorkspaceRequest({
          recordError: false,
          api: 'v1',
          body: EMPTY_WRITE_PROBE_BODY,
          method: 'POST',
          path: '/v1.0/workflow/processInstances',
        }),
      ),
    },
  ];
  return mergeProbeOutcomes(outcomes);
};

/**
 * Custom.Todo.Read is optional. The cached org-read gate is the only signal —
 * this probe must not call organizations/tasks/query.
 */
const optionalOrgTodoReadOutcome = async (): Promise<SubProbeOutcome> => {
  const gate = await peekOrgTodoReadGate();
  if (gate === 'unavailable') return { kind: 'missing', scopes: [...CUSTOM_TODO_READ_SCOPES] };
  if (gate === 'available') return { kind: 'ok' };
  return { kind: 'ignore' };
};

const probeTodo = async (unionId: string): Promise<DingtalkPermissionProbe> => {
  const encoded = encodeURIComponent(unionId);
  const outcomes: Array<{ outcome: SubProbeOutcome; required: boolean }> = [
    {
      required: true,
      outcome: await runSubProbe('read', TODO_READ_SCOPES, () =>
        dingtalkWorkspaceRequest({
          recordError: false,
          api: 'v1',
          body: { isDone: false },
          method: 'POST',
          path: `/v1.0/todo/users/${encoded}/org/tasks/query`,
        }),
      ),
    },
    {
      required: true,
      outcome: await runSubProbe('write', TODO_WRITE_SCOPES, () =>
        dingtalkWorkspaceRequest({
          recordError: false,
          api: 'v1',
          body: EMPTY_WRITE_PROBE_BODY,
          method: 'POST',
          path: `/v1.0/todo/users/${encoded}/tasks`,
        }),
      ),
    },
    { required: false, outcome: await optionalOrgTodoReadOutcome() },
  ];
  return mergeProbeOutcomes(outcomes);
};

const probeCalendar = async (unionId: string): Promise<DingtalkPermissionProbe> => {
  const from = new Date();
  const to = new Date(from.getTime() + 60 * 60_000);
  const timeMin = from.toISOString();
  const timeMax = to.toISOString();
  const encoded = encodeURIComponent(unionId);
  const outcomes: Array<{ outcome: SubProbeOutcome; required: boolean }> = [
    {
      required: true,
      outcome: await runSubProbe('read', CALENDAR_EVENT_READ_SCOPES, () =>
        dingtalkWorkspaceRequest({
          recordError: false,
          api: 'v1',
          method: 'GET',
          path: `/v1.0/calendar/users/${encoded}/calendars/primary/events`,
          query: {
            maxResults: 1,
            timeMax,
            timeMin,
          },
        }),
      ),
    },
    {
      required: true,
      outcome: await runSubProbe('write', CALENDAR_EVENT_WRITE_SCOPES, () =>
        dingtalkWorkspaceRequest({
          recordError: false,
          api: 'v1',
          body: EMPTY_WRITE_PROBE_BODY,
          method: 'POST',
          path: `/v1.0/calendar/users/${encoded}/calendars/primary/events`,
        }),
      ),
    },
    {
      required: true,
      outcome: await runSubProbe('read', CALENDAR_SCHEDULE_READ_SCOPES, () =>
        dingtalkWorkspaceRequest({
          recordError: false,
          api: 'v1',
          body: { endTime: timeMax, startTime: timeMin, userIds: [unionId] },
          method: 'POST',
          path: `/v1.0/calendar/users/${encoded}/querySchedule`,
        }),
      ),
    },
    // Rooms is optional: missing VideoConference.Conference.Read is a warning only.
    {
      required: false,
      outcome: await runSubProbe('warning', CALENDAR_ROOMS_SCOPES, () =>
        dingtalkWorkspaceRequest({
          recordError: false,
          api: 'v1',
          method: 'GET',
          path: '/v1.0/rooms/meetingRoomLists',
          query: { maxResults: 1, unionId },
        }),
      ),
    },
  ];
  return mergeProbeOutcomes(outcomes);
};

/**
 * Permission probes with the notify-app token. Write scopes are checked by
 * POSTing `{}` (DingTalk rejects invalid params after the scope check and
 * never creates a resource).
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
  if (!probeUser) {
    return { approval: unreachable, calendar: unreachable, todo: unreachable };
  }
  const [approval, todo, calendar] = await Promise.all([
    probeApproval(probeUser.staffId),
    probeTodo(probeUser.unionId),
    probeCalendar(probeUser.unionId),
  ]);
  return { approval, calendar, todo };
};
