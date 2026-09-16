import { isReminderTaskConfig } from '@lobechat/types';
import { useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Alert, Button, Tag, Text } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import debug from 'debug';
import { Paperclip } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EditingIndicator, type EditLockClient, useEditLock } from '@/features/EditLock';
import { EditorCanvas } from '@/features/EditorCanvas';
import { seedAttachments } from '@/features/EditorCanvas/attachmentRegistry';
import { pickAndInsertAttachments } from '@/features/EditorCanvas/editorAttachments';
import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client';
import { reminderService } from '@/services/reminder';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { mutateReminderLists } from '../ReminderList/swrKeys';
import { formatReminderScheduleInput, replaceReminderMentionToken } from './reminderText';
import { useReminderMentionOptions } from './useReminderMentionOptions';

const log = debug('agent-tasks:reminder-instruction');

const DEBOUNCE_MS = 300;

/**
 * Zero-width no-break space. The editor writes one into the markdown for every
 * CursorNode it keeps next to an inline node, and it is NOT whitespace for the
 * mention grammar — left in place it glues two recipients into one unparsable
 * token. Stripping it on save is the last line of defence behind the picker,
 * which inserts plain text (see `useReminderMentionOptions`).
 */
const ZERO_WIDTH_NO_BREAK_SPACE = '\uFEFF';

/** Server error codes (`TRPCError.message`) that deserve their own toast. */
const SAVE_ERROR_KEYS = {
  REMINDER_CONTENT_EMPTY: 'taskReminder.error.contentEmpty',
  REMINDER_SCHEDULE_INVALID: 'taskReminder.error.scheduleInvalid',
  REMINDER_TIME_PAST: 'taskReminder.error.timePast',
} as const;

type SaveErrorKey = (typeof SAVE_ERROR_KEYS)[keyof typeof SAVE_ERROR_KEYS];

const saveErrorKey = (error: unknown): SaveErrorKey | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return undefined;
  return SAVE_ERROR_KEYS[message as keyof typeof SAVE_ERROR_KEYS];
};

// Stable lock RPC binding for the task resource.
const taskLockClient: EditLockClient = {
  acquire: (id) => lambdaClient.task.acquireTaskLock.mutate({ id }),
  peek: (id) => lambdaClient.task.getTaskLock.query({ id }),
  release: async (id) => {
    await lambdaClient.task.releaseTaskLock.mutate({ id });
  },
};

/** One candidate of an ambiguous name, as `resolveRecipients` reports it. */
interface AmbiguousCandidate {
  deptId?: string;
  deptPath: string;
  leafDeptName: string;
  name: string;
  staffId?: string;
}

interface Clarification {
  ambiguous: { candidates: AmbiguousCandidate[]; query: string }[];
  unknown: string[];
}

/** `reminder.saveTask`, bound to the router's own output (`undefined` on error). */
type SaveTaskResult = NonNullable<Awaited<ReturnType<typeof reminderService.saveTask>>>;

const TaskInstruction = memo(() => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const { allowed: canEditTask } = usePermission('create_content');
  const instruction = useTaskStore(taskDetailSelectors.activeTaskInstruction);
  const persistedEditorData = useTaskStore(taskDetailSelectors.activeTaskEditorData);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskWorkspaceId = useTaskStore(taskDetailSelectors.activeTaskWorkspaceId);
  const persistedFiles = useTaskStore(taskDetailSelectors.activeTaskFiles);
  const taskConfig = useTaskStore((s) => taskDetailSelectors.activeTaskDetail(s)?.config);
  const updateTask = useTaskStore((s) => s.updateTask);
  const refreshTaskDetail = useTaskStore((s) => s.internal_refreshTaskDetail);
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const editor = useEditor();

  // A reminder task is never autosaved: every save re-runs the server-side
  // interpretation (mentions → recipients, wording → schedule) and re-arms the
  // cron, so it has to be an explicit, user-triggered action.
  const isReminder = isReminderTaskConfig(taskConfig);

  // Collaborative edit lock for workspace tasks (same model as pages): read-only
  // when another member is editing; acquired implicitly on the first edit.
  const [edited, setEdited] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clarification, setClarification] = useState<Clarification | undefined>(undefined);
  const taskIdRef = useRef(taskId);
  if (taskIdRef.current !== taskId) {
    taskIdRef.current = taskId;
    setEdited(false);
    setDirty(false);
    setClarification(undefined);
  }
  const lock = useEditLock({
    client: taskLockClient,
    // Only workspace tasks lock — personal (non-workspace) tasks stay fully
    // editable with no peek/pending, matching the server's workspace gating.
    enabled: Boolean(taskId && canEditTask && taskWorkspaceId),
    isDirty: edited,
    resourceId: taskId ?? undefined,
  });
  // Read-only until the lock resolves, so the user can't start typing on a task
  // that turns out to be locked and get bounced mid-edit.
  const editable = canEditTask && !lock.lockedByOther && !lock.pending;
  // The `@` picker follows the editor: no menu while another member holds the
  // lock (or it is still being peeked), so `@` can never insert into a body the
  // user is not allowed to change.
  const mentionOption = useReminderMentionOptions(isReminder && editable);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Skip save when the serialized state matches the last persisted snapshot —
  // Lexical fires content-change for selection moves and other no-op events.
  const lastSavedJsonRef = useRef<string | undefined>(undefined);
  // Set while we rewrite the document ourselves (discard / disambiguation), so
  // the resulting change event doesn't re-dirty a draft the user just dropped.
  const programmaticRef = useRef(false);

  const editorData = useMemo(
    () => ({
      content: instruction ?? '',
      editorData: persistedEditorData,
    }),
    [instruction, persistedEditorData],
  );

  useEffect(() => {
    if (persistedFiles && persistedFiles.length > 0) {
      seedAttachments(persistedFiles.map((f) => ({ id: f.id, url: f.url })));
    }
  }, [persistedFiles]);

  useEffect(() => {
    lastSavedJsonRef.current = undefined;
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [taskId]);

  const handleContentChange = useCallback(() => {
    if (!editable) return;
    if (!editor || !taskId) return;

    setEdited(true);

    // Reminder tasks: no debounce, no autosave — only mark the draft dirty and
    // wait for the explicit 保存.
    if (isReminder) {
      if (!programmaticRef.current) setDirty(true);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const json = editor.getDocument('json') as unknown;
      const jsonSignature = JSON.stringify(json);
      if (jsonSignature === lastSavedJsonRef.current) return;
      lastSavedJsonRef.current = jsonSignature;

      const markdown = String(editor.getDocument('markdown') ?? '');
      updateTask(taskId, { editorData: json, instruction: markdown }).catch((e) => {
        log('failed to autosave: %O', e);
      });
    }, DEBOUNCE_MS);
  }, [editable, editor, isReminder, taskId, updateTask]);

  /** Rewrite the document without latching the draft dirty (discard path). */
  const writeDocument = useCallback((write: () => void, { markDirty }: { markDirty: boolean }) => {
    programmaticRef.current = !markDirty;
    try {
      write();
    } catch (error) {
      log('failed to rewrite the document: %O', error);
    } finally {
      setTimeout(() => {
        programmaticRef.current = false;
      }, 0);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!editor || !taskId) return;
    const json = editor.getDocument('json') as unknown;
    const markdown = String(editor.getDocument('markdown') ?? '')
      .replaceAll(ZERO_WIDTH_NO_BREAK_SPACE, ' ')
      .trim();
    // An empty body would be rejected by the router's `instruction.min(1)` with
    // a generic failure; say what is wrong instead of a silent no-op.
    if (!markdown) {
      message.error(t('taskReminder.error.contentEmpty'));
      return;
    }

    setSaving(true);
    try {
      const result: SaveTaskResult | undefined = await reminderService.saveTask({
        editorData: json,
        instruction: markdown,
        taskId,
      });

      if (result?.status === 'needs_clarification') {
        const ambiguous = result.ambiguous ?? [];
        const unknown = result.unknown ?? [];

        setClarification({ ambiguous, unknown });
        // Zero resolved recipients with nothing to disambiguate = the body has
        // no mention line at all, and the Alert below would render empty.
        if (ambiguous.length === 0 && unknown.length === 0) {
          message.error(t('taskReminder.recipients.empty'));
        }
        return;
      }

      // Only a real `saved` clears the draft — anything else is a failure we do
      // not understand, and reporting it as 「已保存」 would lose the edit.
      if (result?.status !== 'saved') {
        message.error(t('taskReminder.instruction.saveFailed'));
        return;
      }

      setClarification(undefined);
      setDirty(false);
      message.success(
        t('taskReminder.instruction.saved', {
          count: result.interpretation?.recipients?.length ?? 0,
          schedule:
            formatReminderScheduleInput(result.interpretation?.schedule, t) ||
            t('taskReminder.instruction.scheduleUnchanged'),
        }),
      );
      await refreshTaskDetail(taskId);
      await refreshTaskList().catch(() => {});
      // The 定时提醒 tables read their own SWR caches; a save re-interprets
      // recipients and the schedule, so they are stale until revalidated.
      await mutateReminderLists().catch(() => {});
    } catch (error) {
      log('save failed: %O', error);
      message.error(t(saveErrorKey(error) ?? 'taskReminder.instruction.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [editor, message, refreshTaskDetail, refreshTaskList, t, taskId]);

  const handleDiscard = useCallback(() => {
    if (!editor) return;
    const hasEditorData =
      !!persistedEditorData &&
      typeof persistedEditorData === 'object' &&
      Object.keys(persistedEditorData as object).length > 0;

    writeDocument(
      () => {
        if (hasEditorData) editor.setDocument('json', JSON.stringify(persistedEditorData));
        else editor.setDocument('markdown', instruction ?? '');
      },
      { markDirty: false },
    );
    setDirty(false);
    setClarification(undefined);
  }, [editor, instruction, persistedEditorData, writeDocument]);

  const handlePickCandidate = useCallback(
    (query: string, candidate: AmbiguousCandidate) => {
      if (!editor) return;
      const markdown = String(editor.getDocument('markdown') ?? '');
      const token = candidate.leafDeptName
        ? `@${candidate.name}·${candidate.leafDeptName}`
        : `@${candidate.name}`;
      const next = replaceReminderMentionToken(markdown, query, token);

      if (next !== markdown) {
        writeDocument(() => editor.setDocument('markdown', next), { markDirty: true });
        setDirty(true);
      }

      setClarification((prev) =>
        prev
          ? { ...prev, ambiguous: prev.ambiguous.filter((entry) => entry.query !== query) }
          : prev,
      );
    },
    [editor, writeDocument],
  );

  const handleAttach = useCallback(() => {
    pickAndInsertAttachments(editor);
  }, [editor]);

  const showClarification =
    isReminder &&
    !!clarification &&
    (clarification.ambiguous.length > 0 || clarification.unknown.length > 0);

  return (
    <Flexbox gap={4}>
      <EditingIndicator
        holderId={lock.lockedByOther ? lock.holderId : null}
        pending={canEditTask && lock.pending}
      />
      {showClarification && (
        <Alert
          showIcon
          title={t('taskReminder.clarify.title')}
          type={'warning'}
          description={
            <Flexbox gap={8}>
              {clarification.ambiguous.map((entry) => (
                <Flexbox horizontal align={'center'} gap={6} key={entry.query} wrap={'wrap'}>
                  <Text fontSize={12}>
                    {t('taskReminder.clarify.candidatesFor', { name: entry.query })}
                  </Text>
                  {entry.candidates.map((candidate) => (
                    <Tag
                      key={candidate.staffId ?? `${candidate.name}-${candidate.deptPath}`}
                      size={'small'}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handlePickCandidate(entry.query, candidate)}
                    >
                      {t('taskReminder.clarify.candidate', {
                        dept: candidate.leafDeptName || candidate.deptPath,
                        name: candidate.name,
                      })}
                    </Tag>
                  ))}
                </Flexbox>
              ))}
              {clarification.unknown.length > 0 && (
                <Text fontSize={12}>
                  {t('taskReminder.clarify.unknown', {
                    names: clarification.unknown.join(t('taskReminder.schedule.separator')),
                  })}
                </Text>
              )}
            </Flexbox>
          }
        />
      )}
      <EditorCanvas
        disabled={!canEditTask}
        editable={!lock.lockedByOther && !lock.pending}
        editor={editor}
        editorData={editorData}
        entityId={taskId}
        mentionOption={mentionOption}
        placeholder={t('taskDetail.instructionPlaceholder')}
        onContentChange={handleContentChange}
      />
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        <ActionIcon
          icon={Paperclip}
          size={'small'}
          title={t('upload.action.tooltip')}
          onClick={handleAttach}
        />
        {isReminder && (
          <>
            <Button
              disabled={!dirty || !editable}
              loading={saving}
              size={'small'}
              type={'primary'}
              onClick={handleSave}
            >
              {t('taskReminder.instruction.save')}
            </Button>
            <Button
              disabled={!dirty || saving}
              size={'small'}
              type={'text'}
              onClick={handleDiscard}
            >
              {t('taskReminder.instruction.discard')}
            </Button>
            <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
              {t('taskReminder.instruction.hint')}
            </Text>
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default TaskInstruction;
