import { and, count, eq, isNull, lt, ne, or } from 'drizzle-orm';

import type { DingtalkPersonalAuthorizationItem } from '../schemas/dingtalkPersonal';
import { dingtalkPersonalAuthorizations } from '../schemas/dingtalkPersonal';
import type { LobeChatDatabase, Transaction } from '../type';
import { idGenerator } from '../utils/idGenerator';

/** Skip `last_used_at` writes closer together than this. */
export const DINGTALK_PERSONAL_LAST_USED_MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface DingtalkPersonalAuthorizationUpsert {
  corpId: string;
  corpName: string;
  dingtalkUserName: string;
  profile: string;
  staffId: string;
}

export interface DingtalkPersonalAuthorizationUpsertOptions {
  /**
   * Login start time. A row revoked at or after this instant is left revoked
   * so an in-flight device login cannot undo revoke.
   */
  loginStartedAt?: Date;
  /**
   * checkStatus path. The update matches only a row that is not revoked,
   * so a revoke that landed during the broker call is left in place.
   */
  onlyIfNotRevoked?: boolean;
}

export interface DingtalkPersonalDisplacedAuthorization {
  id: string;
  profile: string;
  userId: string;
}

export interface DingtalkPersonalProfileClaim {
  displaced: DingtalkPersonalDisplacedAuthorization[];
  row: DingtalkPersonalAuthorizationItem | null;
}

type AuthorizationDb = LobeChatDatabase | Transaction;

class DingtalkPersonalProfileClaimDeclined extends Error {
  constructor() {
    super('DINGTALK_PERSONAL_PROFILE_CLAIM_DECLINED');
    this.name = 'DingtalkPersonalProfileClaimDeclined';
  }
}

const isClaimDeclined = (error: unknown): boolean => {
  if (error instanceof DingtalkPersonalProfileClaimDeclined) return true;
  if (error && typeof error === 'object' && 'cause' in error) {
    return isClaimDeclined((error as { cause?: unknown }).cause);
  }
  return false;
};

export class DingtalkPersonalAuthorizationModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  findMine = async (
    executor: AuthorizationDb = this.db,
  ): Promise<DingtalkPersonalAuthorizationItem | null> => {
    const [row] = await executor
      .select()
      .from(dingtalkPersonalAuthorizations)
      .where(eq(dingtalkPersonalAuthorizations.userId, this.userId))
      .limit(1);
    return row ?? null;
  };

  /**
   * One active profile. Other active or expired rows for that profile are
   * revoked in the same transaction, before this user's row becomes active.
   * A declined upsert rolls the revoke back.
   */
  claimActiveProfile = async (
    input: DingtalkPersonalAuthorizationUpsert,
    opts?: DingtalkPersonalAuthorizationUpsertOptions,
  ): Promise<DingtalkPersonalProfileClaim> => {
    try {
      return await this.db.transaction(async (tx) => {
        const displaced = await tx
          .update(dingtalkPersonalAuthorizations)
          .set({ status: 'revoked', updatedAt: new Date() })
          .where(
            and(
              eq(dingtalkPersonalAuthorizations.profile, input.profile),
              ne(dingtalkPersonalAuthorizations.userId, this.userId),
              or(
                eq(dingtalkPersonalAuthorizations.status, 'active'),
                eq(dingtalkPersonalAuthorizations.status, 'expired'),
              ),
            ),
          )
          .returning({
            id: dingtalkPersonalAuthorizations.id,
            profile: dingtalkPersonalAuthorizations.profile,
            userId: dingtalkPersonalAuthorizations.userId,
          });
        const row = await this.upsertActive(input, opts, tx);
        if (!row || row.status !== 'active') throw new DingtalkPersonalProfileClaimDeclined();
        return { displaced, row };
      });
    } catch (error) {
      if (isClaimDeclined(error)) return { displaced: [], row: null };
      throw error;
    }
  };

  /** True when a different user already holds this profile as active. */
  hasOtherActiveProfile = async (profile: string): Promise<boolean> => {
    const [row] = await this.db
      .select({ id: dingtalkPersonalAuthorizations.id })
      .from(dingtalkPersonalAuthorizations)
      .where(
        and(
          eq(dingtalkPersonalAuthorizations.profile, profile),
          eq(dingtalkPersonalAuthorizations.status, 'active'),
          ne(dingtalkPersonalAuthorizations.userId, this.userId),
        ),
      )
      .limit(1);
    return Boolean(row);
  };

  upsertActive = async (
    input: DingtalkPersonalAuthorizationUpsert,
    opts?: DingtalkPersonalAuthorizationUpsertOptions,
    executor: AuthorizationDb = this.db,
  ): Promise<DingtalkPersonalAuthorizationItem | null> => {
    const existing = await this.findMine(executor);
    const now = new Date();
    const authorizedAt =
      existing?.status === 'active' && existing.authorizedAt ? existing.authorizedAt : now;
    const setWhere = opts?.loginStartedAt
      ? or(
          ne(dingtalkPersonalAuthorizations.status, 'revoked'),
          lt(dingtalkPersonalAuthorizations.updatedAt, opts.loginStartedAt),
        )
      : opts?.onlyIfNotRevoked
        ? ne(dingtalkPersonalAuthorizations.status, 'revoked')
        : undefined;

    const [row] = await executor
      .insert(dingtalkPersonalAuthorizations)
      .values({
        authorizedAt,
        corpId: input.corpId,
        corpName: input.corpName,
        dingtalkUserName: input.dingtalkUserName,
        id: idGenerator('dingtalkPersonalAuthorizations'),
        lastErrorCode: null,
        profile: input.profile,
        staffId: input.staffId,
        status: 'active',
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: {
          authorizedAt,
          corpId: input.corpId,
          corpName: input.corpName,
          dingtalkUserName: input.dingtalkUserName,
          lastErrorCode: null,
          profile: input.profile,
          staffId: input.staffId,
          status: 'active',
          updatedAt: now,
        },
        ...(setWhere ? { setWhere } : {}),
        target: dingtalkPersonalAuthorizations.userId,
      })
      .returning();

    return row ?? null;
  };

  markExpired = async (lastErrorCode?: string | null): Promise<void> => {
    await this.db
      .update(dingtalkPersonalAuthorizations)
      .set({
        lastErrorCode: lastErrorCode ?? null,
        status: 'expired',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dingtalkPersonalAuthorizations.userId, this.userId),
          ne(dingtalkPersonalAuthorizations.status, 'revoked'),
        ),
      );
  };

  /** Returns false when the row was already revoked or missing. */
  markRevoked = async (): Promise<boolean> => {
    const rows = await this.db
      .update(dingtalkPersonalAuthorizations)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(
        and(
          eq(dingtalkPersonalAuthorizations.userId, this.userId),
          ne(dingtalkPersonalAuthorizations.status, 'revoked'),
        ),
      )
      .returning({ id: dingtalkPersonalAuthorizations.id });
    return rows.length > 0;
  };

  touchLastUsed = async (now = new Date()): Promise<void> => {
    const cutoff = new Date(now.getTime() - DINGTALK_PERSONAL_LAST_USED_MIN_INTERVAL_MS);
    await this.db
      .update(dingtalkPersonalAuthorizations)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(dingtalkPersonalAuthorizations.userId, this.userId),
          or(
            isNull(dingtalkPersonalAuthorizations.lastUsedAt),
            lt(dingtalkPersonalAuthorizations.lastUsedAt, cutoff),
          ),
        ),
      );
  };

  touchChecked = async (now = new Date()): Promise<void> => {
    await this.db
      .update(dingtalkPersonalAuthorizations)
      .set({ lastCheckedAt: now })
      .where(
        and(
          eq(dingtalkPersonalAuthorizations.userId, this.userId),
          ne(dingtalkPersonalAuthorizations.status, 'revoked'),
        ),
      );
  };

  static countActive = async (db: LobeChatDatabase): Promise<number> => {
    const [row] = await db
      .select({ value: count() })
      .from(dingtalkPersonalAuthorizations)
      .where(eq(dingtalkPersonalAuthorizations.status, 'active'));
    return Number(row?.value ?? 0);
  };
}
