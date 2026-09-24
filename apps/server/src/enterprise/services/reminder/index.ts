import debug from 'debug';

import { DingTalkDirectoryModel } from '@/database/models/dingtalkDirectory';
import { isUniqueViolation } from '@/database/models/platform/pgUniqueViolation';
import type {
  ReceivedReminder,
  ReminderRecipientInput,
  ReminderWithRecipients,
} from '@/database/models/reminder';
import { ReminderModel } from '@/database/models/reminder';
import { UserModel } from '@/database/models/user';
import type { ReminderRepeatRule, ReminderStatus } from '@/database/schemas/reminder';
import type { LobeChatDatabase } from '@/database/type';
import { resolveDingTalkStaffId } from '@/server/services/messenger/platforms/dingtalk/resolveStaffId';

import { formatServerNowIso, REMINDER_DEFAULT_TZ } from './schedule';

export type { ReceivedReminder };

export {
  buildReminderNotice,
  formatRepeatSummary,
  initialFireAt,
  isDue,
  nextClockTime,
  nextFireAt,
  REMINDER_DEFAULT_TZ,
  resolveOneShotFireAt,
} from './schedule';
export {
  ensureReminderWorkerStarted,
  isReminderWorkerRuntime,
  REMINDER_SWEEP_INTERVAL_MS,
  runReminderSweep,
  stopReminderWorker,
  stopReminderWorkerForTest,
} from './worker';

const log = debug('lobe-server:reminder');

export const REMINDER_TIME_PAST = 'REMINDER_TIME_PAST';
export const REMINDER_RECIPIENT_UNKNOWN = 'REMINDER_RECIPIENT_UNKNOWN';
export const REMINDER_CONTENT_EMPTY = 'REMINDER_CONTENT_EMPTY';
export const REMINDER_NOT_FOUND = 'REMINDER_NOT_FOUND';
export const REMINDER_SCHEDULE_INVALID = 'REMINDER_SCHEDULE_INVALID';
export const REMINDER_CREATE_RETRY = 'REMINDER_CREATE_RETRY';
export const REMINDER_INTERNAL = 'REMINDER_INTERNAL';
export const REMINDER_FIRE_AT_LEAD_MS = 30_000;
export const REMINDER_LARGE_AUDIENCE_THRESHOLD = 30;
export const REMINDER_MAX_RECIPIENT_QUERIES = 50;

export type ReminderServiceErrorCode =
  | typeof REMINDER_CONTENT_EMPTY
  | typeof REMINDER_CREATE_RETRY
  | typeof REMINDER_INTERNAL
  | typeof REMINDER_NOT_FOUND
  | typeof REMINDER_RECIPIENT_UNKNOWN
  | typeof REMINDER_SCHEDULE_INVALID
  | typeof REMINDER_TIME_PAST;

export class ReminderServiceError extends Error {
  readonly code: ReminderServiceErrorCode;

  constructor(code: ReminderServiceErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ReminderServiceError';
    this.code = code;
  }
}

const RETRYABLE_PG_CODES = new Set(['23505', '40001', '40P01']);

const collectPgCodes = (error: unknown): string[] => {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string' && code.length > 0) codes.push(code);
    }
    current =
      typeof current === 'object' && current !== null && 'cause' in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return codes;
};

/** Unique-violation / serialization / deadlock that is safe to retry once. */
export const isReminderCreateRetryConflict = (error: unknown): boolean => {
  if (isUniqueViolation(error)) return true;
  if (collectPgCodes(error).some((code) => RETRYABLE_PG_CODES.has(code))) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to create task after max retries/i.test(message);
};

export interface ReminderRecipientRef {
  deptId?: string;
  kind: 'department' | 'user';
  staffId?: string;
}

export interface ReminderCreateInput {
  confirmLargeAudience?: boolean;
  content: string;
  createdByAgentId?: string | null;
  fireAt: Date | string;
  recipients: ReminderRecipientRef[];
  repeat?: ReminderRepeatRule | null;
  source?: 'tool' | 'ui';
  topicId?: string | null;
}

export interface ReminderLargeAudience {
  deptId: string;
  memberCount: number;
  name: string;
}

export type ReminderCreateResult =
  ReminderWithRecipients | { audience: ReminderLargeAudience[]; needsConfirmation: true };

export interface ReminderDirectoryUserHit {
  active: boolean;
  ambiguous: boolean;
  deptPath: string;
  leafDeptId: string | null;
  leafDeptName: string;
  name: string;
  staffId: string;
}

export interface ReminderDirectoryDepartmentHit {
  deptId: string;
  memberCount: number;
  name: string;
  pathNames: string;
}

export interface ReminderDirectorySearchResult {
  ambiguous: boolean;
  departments: ReminderDirectoryDepartmentHit[];
  serverNow: string;
  users: ReminderDirectoryUserHit[];
}

const creatorDisplayName = (
  user: {
    email?: string | null;
    fullName?: string | null;
    username?: string | null;
  } | null,
): string => {
  const fullName = user?.fullName?.trim();
  if (fullName) return fullName;
  const username = user?.username?.trim();
  if (username) return username;
  const email = user?.email?.trim();
  if (email) return email;
  return '用户';
};

const parseFireAt = (fireAt: Date | string): Date => {
  if (fireAt instanceof Date) {
    if (Number.isNaN(fireAt.getTime())) {
      throw new ReminderServiceError(REMINDER_TIME_PAST);
    }
    return fireAt;
  }
  const parsed = new Date(fireAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new ReminderServiceError(REMINDER_TIME_PAST);
  }
  return parsed;
};

export class ReminderService {
  private readonly directory: DingTalkDirectoryModel;
  private readonly model: ReminderModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {
    this.directory = new DingTalkDirectoryModel(db);
    this.model = new ReminderModel(db, userId);
  }

  searchDirectory = async (
    q: string,
    kind?: 'department' | 'user',
  ): Promise<ReminderDirectorySearchResult> => {
    const hits = await this.directory.search(q, kind ? { kind } : undefined);
    if (hits.users.length === 0 && hits.departments.length === 0) {
      // A miss may mean the mirror is stale (sync runs every 12 h): ask for an early
      // sync. The helper allows one walk per 6 h and remembers this name for 6 h.
      // Never blocks the lookup.
      void import('@/server/enterprise/services/dingtalkDirectory/sync')
        .then(({ requestDirectorySyncOnLookupMiss }) =>
          requestDirectorySyncOnLookupMiss(this.db, {}, q),
        )
        .catch(() => undefined);
    }
    const nameCounts = new Map<string, number>();
    for (const user of hits.users) {
      nameCounts.set(user.name, (nameCounts.get(user.name) ?? 0) + 1);
    }
    const users: ReminderDirectoryUserHit[] = hits.users.map((user) => ({
      ...user,
      ambiguous: (nameCounts.get(user.name) ?? 0) >= 2,
    }));
    return {
      ambiguous: users.some((user) => user.ambiguous),
      departments: hits.departments,
      serverNow: formatServerNowIso(),
      users,
    };
  };

  create = async (input: ReminderCreateInput): Promise<ReminderCreateResult> => {
    const fireAt = parseFireAt(input.fireAt);
    if (fireAt.getTime() <= Date.now() + REMINDER_FIRE_AT_LEAD_MS) {
      throw new ReminderServiceError(REMINDER_TIME_PAST);
    }

    const content = input.content.trim();
    if (!content) {
      throw new ReminderServiceError(REMINDER_CONTENT_EMPTY, 'Reminder content is required');
    }

    const snapshots = await this.resolveRecipientSnapshots(input.recipients);
    const largeAudience = snapshots
      .filter(
        (row) =>
          row.kind === 'department' && (row.memberCount ?? 0) > REMINDER_LARGE_AUDIENCE_THRESHOLD,
      )
      .map((row) => ({
        deptId: row.deptId!,
        memberCount: row.memberCount ?? 0,
        name: row.displayName,
      }));

    if (largeAudience.length > 0 && !input.confirmLargeAudience) {
      return { audience: largeAudience, needsConfirmation: true };
    }

    const user = await UserModel.findById(this.db, this.userId);
    const created = await this.model.create({
      content,
      createdByAgentId: input.createdByAgentId ?? null,
      creatorName: creatorDisplayName(user ?? null),
      fireAt,
      recipients: snapshots,
      repeatRule: input.repeat ?? null,
      source: input.source ?? 'tool',
      timezone: REMINDER_DEFAULT_TZ,
      topicId: input.topicId ?? null,
    });
    log('created reminder=%s recipients=%d', created.id, snapshots.length);
    return created;
  };

  listCreated = async (opts?: { limit?: number; status?: ReminderStatus }) =>
    this.model.listCreated(opts);

  listReceived = async (opts?: { limit?: number }): Promise<ReceivedReminder[]> => {
    const staffId = await resolveDingTalkStaffId(this.db, this.userId);
    if (!staffId) return [];
    return this.model.listReceived({ limit: opts?.limit, staffId });
  };

  cancel = async (id: string) => {
    try {
      return await this.model.cancel(id);
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) {
        throw new ReminderServiceError(REMINDER_NOT_FOUND);
      }
      throw error;
    }
  };

  hideReceived = async (deliveryId: string): Promise<void> => {
    const staffId = await resolveDingTalkStaffId(this.db, this.userId);
    if (!staffId) throw new ReminderServiceError(REMINDER_NOT_FOUND);
    const hidden = await this.model.hideReceived(deliveryId, staffId);
    if (!hidden) throw new ReminderServiceError(REMINDER_NOT_FOUND);
  };

  private resolveRecipientSnapshots = async (
    recipients: ReminderRecipientRef[],
  ): Promise<ReminderRecipientInput[]> => {
    if (recipients.length === 0) {
      throw new ReminderServiceError(REMINDER_RECIPIENT_UNKNOWN);
    }

    const staffIds = [
      ...new Set(
        recipients.filter((row) => row.kind === 'user' && row.staffId).map((row) => row.staffId!),
      ),
    ];
    const users = staffIds.length > 0 ? await this.directory.getUsers(staffIds) : [];
    const usersById = new Map(users.map((user) => [user.staffId, user]));

    const snapshots: ReminderRecipientInput[] = [];
    const seen = new Set<string>();

    for (const recipient of recipients) {
      if (recipient.kind === 'user') {
        const staffId = recipient.staffId?.trim();
        if (!staffId) throw new ReminderServiceError(REMINDER_RECIPIENT_UNKNOWN);
        const user = usersById.get(staffId);
        if (!user) throw new ReminderServiceError(REMINDER_RECIPIENT_UNKNOWN);
        const key = `user:${staffId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        snapshots.push({
          deptId: user.leafDeptId,
          deptName: user.leafDeptName,
          deptPath: user.deptPath,
          displayName: user.name,
          kind: 'user',
          memberCount: null,
          staffId,
        });
        continue;
      }

      const deptId = recipient.deptId?.trim();
      if (!deptId) throw new ReminderServiceError(REMINDER_RECIPIENT_UNKNOWN);
      const department = await this.directory.getDepartment(deptId);
      if (!department) throw new ReminderServiceError(REMINDER_RECIPIENT_UNKNOWN);
      const key = `department:${deptId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const memberStaffIds = await this.directory.subtreeMemberStaffIds(deptId);
      snapshots.push({
        deptId,
        deptName: department.name,
        deptPath: department.pathNames,
        displayName: department.name,
        kind: 'department',
        memberCount: memberStaffIds.length,
        staffId: null,
      });
    }

    if (snapshots.length === 0) {
      throw new ReminderServiceError(REMINDER_RECIPIENT_UNKNOWN);
    }
    return snapshots;
  };
}
