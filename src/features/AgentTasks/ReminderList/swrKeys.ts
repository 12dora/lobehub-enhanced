import { mutate } from '@/libs/swr';

/**
 * SWR keys of the 定时提醒 reads, in one place so every surface that mutates a
 * reminder (the tables AND the task detail panel) invalidates the same caches.
 *
 * `mutate` from `@/libs/swr` is the workspace-scoped one; concrete keys are
 * augmented with the active workspace id, which is why the invalidation below
 * uses a predicate instead of the literal tuples.
 */
export const REMINDER_KEY_PREFIX = 'reminder:';

export const REMINDER_LIST_CREATED_KEY = 'reminder:listCreated';
export const REMINDER_LIST_RECEIVED_KEY = 'reminder:listReceived';

/** Router-side maximum (`limit` is capped at 200) — ask for the whole set. */
export const REMINDER_LIST_LIMIT = 200;

/** Key of 我发起的 — shared by the table and the detail panel's row lookup. */
export const createdRemindersKey = (includeFinished: boolean) =>
  [REMINDER_LIST_CREATED_KEY, includeFinished] as const;

/** Key of 我收到的. */
export const receivedRemindersKey = () => [REMINDER_LIST_RECEIVED_KEY] as const;

/**
 * Revalidate every reminder list after a mutation (立即发送 / 取消 / 保存),
 * wherever it was triggered from. Matches any key whose first segment starts
 * with `reminder:`, so a workspace-augmented key still matches.
 */
export const mutateReminderLists = () =>
  mutate(
    (key: unknown) =>
      Array.isArray(key) &&
      typeof key[0] === 'string' &&
      (key[0] as string).startsWith(REMINDER_KEY_PREFIX),
  );
