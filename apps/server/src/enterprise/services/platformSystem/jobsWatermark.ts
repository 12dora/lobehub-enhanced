import { PlatformStatusSettingsModel } from '@/database/models/platform/statusSettings';
import type { LobeChatDatabase, Transaction } from '@/database/type';

const coerceDate = (value: Date | string | null | undefined): Date | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Operator watermark. A missing row is "nothing cleared". A read failure (table not
 * ready, or the settings query itself) leaves the list unfiltered instead of failing
 * the status page; the error class is logged without row contents.
 */
export const readJobsClearedAt = async (
  db: LobeChatDatabase | Transaction,
  options: { strict?: boolean } = {},
): Promise<Date | null> => {
  try {
    const row = options.strict
      ? await new PlatformStatusSettingsModel(db).getForUpdate()
      : await new PlatformStatusSettingsModel(db).get();
    return coerceDate(row?.jobsClearedAt);
  } catch (error) {
    if (options.strict) throw error;
    console.error('[admin.system.jobs] cleared-at unavailable', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return null;
  }
};

/** Persists the watermark on the database clock. Does not delete job rows or idempotency keys. */
export const writeJobsClearedAt = async (
  db: LobeChatDatabase | Transaction,
  params: { updatedBy: string },
): Promise<Date> => {
  const row = await new PlatformStatusSettingsModel(db).setJobsClearedAt({
    updatedBy: params.updatedBy,
  });
  const stored = coerceDate(row.jobsClearedAt);
  if (!stored) {
    throw new Error('Status settings watermark update did not return a time');
  }
  return stored;
};
