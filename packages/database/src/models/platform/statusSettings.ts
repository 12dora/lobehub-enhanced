import { and, eq, sql } from 'drizzle-orm';

import type { StatusAlertSettings } from '@/types/platform/statusAlerts';

import { inTransaction } from '../../repositories/platform/tx';
import { PLATFORM_STATUS_SETTINGS_ID, platformStatusSettings } from '../../schemas/platform';
import type { LobeChatDatabase, Transaction } from '../../type';
import { PlatformRevisionConflictError } from './errors';

export { PLATFORM_STATUS_SETTINGS_ID };

export interface PlatformStatusSettingsItem {
  apiTokenCreatedAt: Date | null;
  apiTokenHash: string | null;
  apiTokenHint: string | null;
  /** Stored jsonb. Callers apply `normalizeStatusAlertSettings`. */
  config: Record<string, unknown>;
  createdAt: Date;
  id: typeof PLATFORM_STATUS_SETTINGS_ID;
  jobsClearedAt: Date | null;
  revision: number;
  /** Ciphertext. Undefined on write means keep; this field is never a plaintext secret. */
  robotSecret: string | null;
  /** Ciphertext of the group-robot webhook. Undefined on write means keep. */
  robotWebhook: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

type StatusSettingsDb = LobeChatDatabase | Transaction;

const asConfig = (config: StatusAlertSettings): Record<string, unknown> =>
  config as unknown as Record<string, unknown>;

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Reads and writes the singleton {@link platformStatusSettings} row.
 *
 * Absent row → `get()` returns `null` (callers treat revision as 0).
 * Deep-import this file — do not pull `models/platform` (the barrel loads unrelated models).
 */
export class PlatformStatusSettingsModel {
  private readonly db: StatusSettingsDb;

  constructor(db: StatusSettingsDb) {
    this.db = db;
  }

  get = async (): Promise<PlatformStatusSettingsItem | null> => this.read(false);

  /** Same row as {@link get}, locked until the surrounding transaction commits. */
  getForUpdate = async (): Promise<PlatformStatusSettingsItem | null> => this.read(true);

  /**
   * Replace persisted alert config with CAS.
   * `robotSecret` and `robotWebhook`: undefined keeps the stored ciphertext, null clears it,
   * a string is stored as already-encrypted ciphertext.
   * First write (no row) requires `expectedRevision === 0` and inserts at revision 1.
   *
   * @throws PlatformRevisionConflictError when expectedRevision mismatches
   */
  updateConfig = async (params: {
    config: StatusAlertSettings;
    expectedRevision: number;
    robotSecret?: string | null;
    robotWebhook?: string | null;
    updatedBy: string;
  }): Promise<PlatformStatusSettingsItem> =>
    this.write({
      bumpRevision: true,
      expectedRevision: params.expectedRevision,
      updatedBy: params.updatedBy,
      values: (current) => ({
        config: asConfig(params.config),
        robotSecret:
          params.robotSecret === undefined ? (current?.robotSecret ?? null) : params.robotSecret,
        robotWebhook:
          params.robotWebhook === undefined ? (current?.robotWebhook ?? null) : params.robotWebhook,
      }),
    });

  /**
   * Move a plaintext webhook out of `config` into the encrypted column.
   * Does not change `revision`. No-op when the column is already set.
   */
  adoptRobotWebhook = async (params: {
    ciphertext: string;
    config: Record<string, unknown>;
  }): Promise<PlatformStatusSettingsItem | null> =>
    inTransaction(this.db, async (db) => {
      const [locked] = await db
        .select()
        .from(platformStatusSettings)
        .where(eq(platformStatusSettings.id, PLATFORM_STATUS_SETTINGS_ID))
        .limit(1)
        .for('update');
      if (!locked) return null;
      if (locked.robotWebhook) return this.toItem(locked);
      const [updated] = await db
        .update(platformStatusSettings)
        .set({
          config: params.config,
          robotWebhook: params.ciphertext,
          updatedAt: new Date(),
        })
        .where(eq(platformStatusSettings.id, PLATFORM_STATUS_SETTINGS_ID))
        .returning();
      return updated ? this.toItem(updated) : this.toItem(locked);
    });

  /**
   * Advance the jobs-list watermark to the database clock. Does not change `revision`.
   * The stored time is `greatest(current, now())` so a slower writer cannot move it
   * backwards, and it shares a clock with job `finished_at` (`statement_timestamp()`).
   */
  setJobsClearedAt = async (params: { updatedBy: string }): Promise<PlatformStatusSettingsItem> =>
    inTransaction(this.db, async (db) => {
      const [locked] = await db
        .select()
        .from(platformStatusSettings)
        .where(eq(platformStatusSettings.id, PLATFORM_STATUS_SETTINGS_ID))
        .limit(1)
        .for('update');

      if (!locked) {
        const [inserted] = await db
          .insert(platformStatusSettings)
          .values({
            config: {},
            id: PLATFORM_STATUS_SETTINGS_ID,
            jobsClearedAt: sql`now()`,
            revision: 1,
            updatedBy: params.updatedBy,
          })
          .onConflictDoNothing({ target: platformStatusSettings.id })
          .returning();
        if (inserted) return this.toItem(inserted);
      }

      const [updated] = await db
        .update(platformStatusSettings)
        .set({
          jobsClearedAt: sql`greatest(coalesce(${platformStatusSettings.jobsClearedAt}, '-infinity'::timestamptz), now())`,
          updatedAt: new Date(),
          updatedBy: params.updatedBy,
        })
        .where(eq(platformStatusSettings.id, PLATFORM_STATUS_SETTINGS_ID))
        .returning();
      if (!updated) {
        throw new Error('Status settings watermark update missed the singleton row');
      }
      return this.toItem(updated);
    });

  /** Upsert or clear the status-API token hash. Does not change `revision`. The plaintext token is never stored. */
  setApiToken = async (
    params:
      | { clear: true; updatedBy: string }
      | {
          createdAt: Date;
          hash: string;
          hint: string;
          updatedBy: string;
        },
  ): Promise<PlatformStatusSettingsItem> =>
    this.write({
      bumpRevision: false,
      updatedBy: params.updatedBy,
      values: () =>
        'clear' in params
          ? { apiTokenCreatedAt: null, apiTokenHash: null, apiTokenHint: null }
          : {
              apiTokenCreatedAt: params.createdAt,
              apiTokenHash: params.hash,
              apiTokenHint: params.hint,
            },
    });

  private read = async (forUpdate: boolean): Promise<PlatformStatusSettingsItem | null> => {
    const query = this.db
      .select()
      .from(platformStatusSettings)
      .where(eq(platformStatusSettings.id, PLATFORM_STATUS_SETTINGS_ID))
      .limit(1);
    const [row] = forUpdate ? await query.for('update') : await query;
    return row ? this.toItem(row) : null;
  };

  private write = async (params: {
    bumpRevision: boolean;
    expectedRevision?: number;
    updatedBy: string;
    values: (
      current: PlatformStatusSettingsItem | null,
    ) => Partial<typeof platformStatusSettings.$inferInsert>;
  }): Promise<PlatformStatusSettingsItem> => {
    const run = async (db: Transaction) => {
      const [locked] = await db
        .select()
        .from(platformStatusSettings)
        .where(eq(platformStatusSettings.id, PLATFORM_STATUS_SETTINGS_ID))
        .limit(1)
        .for('update');

      const current = locked ? this.toItem(locked) : null;
      const currentRevision = current?.revision ?? 0;
      if (params.expectedRevision !== undefined && currentRevision !== params.expectedRevision) {
        throw new PlatformRevisionConflictError(
          'Status settings revision conflict: expectedRevision does not match current revision',
          {
            currentRevision,
            expectedRevision: params.expectedRevision,
            resourceId: PLATFORM_STATUS_SETTINGS_ID,
            resourceType: 'platform_status_settings',
          },
        );
      }

      const nextRevision = params.bumpRevision ? currentRevision + 1 : Math.max(currentRevision, 1);
      const patch = params.values(current);

      if (!current) {
        const [inserted] = await db
          .insert(platformStatusSettings)
          .values({
            config: {},
            id: PLATFORM_STATUS_SETTINGS_ID,
            revision: nextRevision,
            updatedBy: params.updatedBy,
            ...patch,
          })
          .onConflictDoNothing({ target: platformStatusSettings.id })
          .returning();
        if (!inserted) {
          throw new PlatformRevisionConflictError(
            'Status settings revision conflict: concurrent first-write',
            {
              expectedRevision: params.expectedRevision,
              resourceId: PLATFORM_STATUS_SETTINGS_ID,
              resourceType: 'platform_status_settings',
            },
          );
        }
        return this.toItem(inserted);
      }

      const [updated] = await db
        .update(platformStatusSettings)
        .set({
          ...patch,
          ...(params.bumpRevision ? { revision: nextRevision } : {}),
          updatedAt: new Date(),
          updatedBy: params.updatedBy,
        })
        .where(
          and(
            eq(platformStatusSettings.id, PLATFORM_STATUS_SETTINGS_ID),
            eq(platformStatusSettings.revision, currentRevision),
          ),
        )
        .returning();

      if (!updated) {
        throw new PlatformRevisionConflictError(
          'Status settings revision conflict: expectedRevision does not match current revision',
          {
            currentRevision,
            expectedRevision: params.expectedRevision ?? currentRevision,
            resourceId: PLATFORM_STATUS_SETTINGS_ID,
            resourceType: 'platform_status_settings',
          },
        );
      }

      return this.toItem(updated);
    };

    return inTransaction(this.db, run);
  };

  private toItem = (
    row: typeof platformStatusSettings.$inferSelect,
  ): PlatformStatusSettingsItem => ({
    apiTokenCreatedAt: row.apiTokenCreatedAt ?? null,
    apiTokenHash: row.apiTokenHash ?? null,
    apiTokenHint: row.apiTokenHint ?? null,
    config:
      row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? row.config : {},
    createdAt: row.createdAt,
    id: PLATFORM_STATUS_SETTINGS_ID,
    jobsClearedAt: asDate(row.jobsClearedAt),
    revision: row.revision,
    robotSecret: row.robotSecret ?? null,
    robotWebhook: row.robotWebhook ?? null,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? null,
  });
}
