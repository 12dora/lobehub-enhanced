import type { IEditor } from '@lobehub/editor';
import { INSERT_MENTION_COMMAND } from '@lobehub/editor';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { reminderService } from '@/services/reminder';

type DirectorySearch = Awaited<ReturnType<typeof reminderService.searchDirectory>>;

interface MentionSearch {
  leadOffset: number;
  matchingString: string;
  replaceableString: string;
}

interface MentionMenuItem {
  description?: string;
  key: string;
  label: string;
  metadata?: Record<string, unknown>;
  onSelect: (editor: IEditor) => void;
}

/**
 * The inserted mention node carries the FULL token (`@姓名·部门`) as its label,
 * not just the name. `@lobehub/editor` serialises a mention to markdown through
 * the plugin's `markdownWriter` when one is registered and falls back to the raw
 * label otherwise — carrying the `@` in the label makes both paths emit exactly
 * the token `parseReminderMentions` expects, so the picker can never silently
 * produce a body the server reads as "no recipients".
 */
export const buildReminderMentionToken = (name: string, dept?: string | null): string =>
  dept ? `@${name}·${dept}` : `@${name}`;

/**
 * `@` picker for the reminder task body, backed by the DingTalk directory
 * mirror (`reminder.searchDirectory`). Typing `@胡` offers 「胡玉琴A · 外贸组」
 * and inserting writes the plain token `@胡玉琴A·外贸组` into the markdown.
 *
 * Returns `undefined` when disabled so non-reminder editors keep no `@` menu at
 * all (the Editor only registers the trigger when `items` is present).
 */
export const useReminderMentionOptions = (enabled: boolean) => {
  const { t } = useTranslation('chat');
  // Per-query cache: the menu re-queries on every keystroke, and the directory
  // mirror is static within a session.
  const cacheRef = useRef(new Map<string, DirectorySearch>());

  const loadItems = useCallback(
    async (search: MentionSearch | null): Promise<MentionMenuItem[]> => {
      const query = search?.matchingString?.trim() ?? '';
      if (!query) return [];

      let result = cacheRef.current.get(query);
      if (!result) {
        try {
          result = await reminderService.searchDirectory({ q: query });
        } catch (error) {
          console.error('[useReminderMentionOptions] searchDirectory failed:', error);
          return [];
        }
        cacheRef.current.set(query, result);
      }

      const users = (result.users ?? []).map((user) => {
        const token = buildReminderMentionToken(user.name, user.leafDeptName);

        return {
          description: user.deptPath,
          key: `user:${user.staffId}`,
          label: user.leafDeptName
            ? t('taskReminder.mention.user', { dept: user.leafDeptName, name: user.name })
            : user.name,
          onSelect: (editor: IEditor) => {
            editor.dispatchCommand(INSERT_MENTION_COMMAND, {
              label: token,
              metadata: { kind: 'user', staffId: user.staffId },
            });
          },
        } satisfies MentionMenuItem;
      });

      const departments = (result.departments ?? []).map((department) => {
        const token = buildReminderMentionToken(department.name);

        return {
          description: department.pathNames,
          key: `dept:${department.deptId}`,
          label: t('taskReminder.mention.department', {
            count: department.memberCount ?? 0,
            name: department.name,
          }),
          onSelect: (editor: IEditor) => {
            editor.dispatchCommand(INSERT_MENTION_COMMAND, {
              label: token,
              metadata: { deptId: department.deptId, kind: 'department' },
            });
          },
        } satisfies MentionMenuItem;
      });

      return [...users, ...departments];
    },
    [t],
  );

  // A trailing space keeps two picked recipients apart: the mention grammar only
  // matches a token at a line start or after whitespace.
  const markdownWriter = useCallback(
    (mention: { label?: string }) => `${mention?.label ?? ''} `,
    [],
  );

  return useMemo(
    () => (enabled ? { items: loadItems, markdownWriter } : undefined),
    [enabled, loadItems, markdownWriter],
  );
};
