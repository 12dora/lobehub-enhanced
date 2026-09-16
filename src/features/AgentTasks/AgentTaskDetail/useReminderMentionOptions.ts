import type { IEditor } from '@lobehub/editor';
import debug from 'debug';
import { $createTextNode, $insertNodes } from 'lexical';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { reminderService } from '@/services/reminder';

const log = debug('agent-tasks:reminder-mention');

type DirectorySearch = Awaited<ReturnType<typeof reminderService.searchDirectory>>;

interface MentionSearch {
  leadOffset: number;
  matchingString: string;
  replaceableString: string;
}

interface MentionMenuItem {
  description?: string;
  disabled?: boolean;
  key: string;
  label: string;
  metadata?: Record<string, unknown>;
  onSelect?: (editor: IEditor) => void;
}

/**
 * The canonical body token for a recipient: `@姓名·部门` (person) or `@部门名`.
 * It is what `parseReminderMentions` (server + client) reads back.
 */
export const buildReminderMentionToken = (name: string, dept?: string | null): string =>
  dept ? `@${name}·${dept}` : `@${name}`;

/**
 * Insert a picked recipient as PLAIN TEXT, followed by a real space.
 *
 * Deliberately not `INSERT_MENTION_COMMAND`: that inserts a MentionNode plus a
 * CursorNode whose text is U+FEFF, so two adjacent picks serialise to
 * `@a·x` + U+FEFF + `@b·y`. The mention grammar requires a token to start at the
 * beginning of the text or after whitespace (and U+FEFF is not whitespace), so
 * every recipient after the first would be silently dropped on save. The
 * plugin-level `markdownWriter` cannot fix that either — `registerMarkdownWriter`
 * is first-wins and `ReactMentionPlugin` is already registered without one by
 * `createChatInputRichPlugins`.
 *
 * The trailing space also closes the `@` trigger, so the menu does not re-open
 * on the token that was just inserted.
 */
const insertMentionToken = (editor: IEditor, token: string) => {
  const lexicalEditor = editor.getLexicalEditor();
  if (!lexicalEditor) return;

  // `onSelect` already runs inside a Lexical update (the slash plugin removes
  // the typed query there); a nested update is merged into the same batch.
  lexicalEditor.update(() => {
    const node = $createTextNode(`${token} `);
    $insertNodes([node]);
    node.selectEnd();
  });
};

/**
 * `@` picker for the reminder task body, backed by the DingTalk directory
 * mirror (`reminder.searchDirectory`). Typing `@胡` offers 「胡玉琴A · 外贸组」
 * and inserting writes the plain token `@胡玉琴A·外贸组 ` into the body.
 *
 * Returns `undefined` when disabled so non-reminder (or read-only) editors keep
 * no `@` menu at all — the Editor only registers the trigger when `items` is
 * present.
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
          log('searchDirectory failed: %O', error);
          // An empty menu would read as 「查无此人」; say the lookup failed.
          return [
            {
              disabled: true,
              key: 'reminder-mention-error',
              label: t('taskReminder.mention.searchFailed'),
            },
          ];
        }
        if (!result) return [];
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
          onSelect: (editor: IEditor) => insertMentionToken(editor, token),
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
          onSelect: (editor: IEditor) => insertMentionToken(editor, token),
        } satisfies MentionMenuItem;
      });

      return [...users, ...departments];
    },
    [t],
  );

  return useMemo(() => (enabled ? { items: loadItems } : undefined), [enabled, loadItems]);
};
