/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TaskInstruction from './TaskInstruction';

const mocks = vi.hoisted(() => {
  const documents = { json: { root: {} } as unknown, markdown: '@胡玉琴 \n\n每日例会 9:00' };

  return {
    documents,
    editor: {
      getDocument: vi.fn((type: string) => (type === 'json' ? documents.json : documents.markdown)),
      setDocument: vi.fn((type: string, value: string) => {
        if (type === 'markdown') documents.markdown = value;
      }),
    },
    message: { error: vi.fn(), success: vi.fn() },
    mutateReminderLists: vi.fn(),
    refreshTaskDetail: vi.fn(),
    refreshTaskList: vi.fn(),
    saveTask: vi.fn(),
    taskState: {
      activeTaskId: 'T-7',
      taskDetailMap: {} as Record<string, unknown>,
    },
    updateTask: vi.fn(),
  };
});

const reminderDetail = {
  config: { reminder: { kind: 'reminder', once: false, reminderId: 'rmd_1' } },
  identifier: 'T-7',
  instruction: '@胡玉琴 \n\n每日例会 9:00',
  status: 'scheduled',
};

const plainDetail = {
  config: {},
  identifier: 'T-7',
  instruction: 'Do the thing',
  status: 'backlog',
};

vi.mock('@lobehub/editor/react', () => ({ useEditor: () => mocks.editor }));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: () => <button type="button">attach</button>,
  Alert: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
    <div data-testid="clarify-alert">
      {title}
      {description}
    </div>
  ),
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Tag: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <span data-testid="candidate" onClick={onClick}>
      {children}
    </span>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({ App: { useApp: () => ({ message: mocks.message }) } }));

vi.mock('antd-style', () => ({ cssVar: { colorTextTertiary: '#999' } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && Object.keys(params).length > 0 ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

// A stub canvas with an explicit "the user typed" affordance, so the test can
// drive the dirty-draft transition without a real Lexical editor.
vi.mock('@/features/EditorCanvas', () => ({
  EditorCanvas: ({ onContentChange }: { onContentChange?: () => void }) => (
    <button data-testid="type" type="button" onClick={() => onContentChange?.()}>
      editor
    </button>
  ),
}));

vi.mock('@/features/EditorCanvas/attachmentRegistry', () => ({ seedAttachments: vi.fn() }));
vi.mock('@/features/EditorCanvas/editorAttachments', () => ({
  pickAndInsertAttachments: vi.fn(),
}));

vi.mock('@/features/EditLock', () => ({
  EditingIndicator: () => null,
  useEditLock: () => ({ holderId: null, lockedByOther: false, pending: false }),
}));

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    task: {
      acquireTaskLock: { mutate: vi.fn() },
      getTaskLock: { query: vi.fn() },
      releaseTaskLock: { mutate: vi.fn() },
    },
  },
}));

vi.mock('@/services/reminder', () => ({
  reminderService: { saveTask: mocks.saveTask, searchDirectory: vi.fn() },
}));

vi.mock('../ReminderList/swrKeys', () => ({
  mutateReminderLists: mocks.mutateReminderLists,
}));

// The `@` picker drags in the real `@lobehub/editor` bundle; it has its own
// coverage and nothing here depends on it.
vi.mock('./useReminderMentionOptions', () => ({
  useReminderMentionOptions: () => undefined,
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: any) =>
    selector({
      ...mocks.taskState,
      internal_refreshTaskDetail: mocks.refreshTaskDetail,
      refreshTaskList: mocks.refreshTaskList,
      updateTask: mocks.updateTask,
    }),
}));

const clickSave = () => fireEvent.click(screen.getByText('taskReminder.instruction.save'));

describe('TaskInstruction — reminder save flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.documents.markdown = '@胡玉琴 \n\n每日例会 9:00';
    mocks.refreshTaskDetail.mockResolvedValue(undefined);
    mocks.refreshTaskList.mockResolvedValue(undefined);
    mocks.updateTask.mockResolvedValue(undefined);
    mocks.mutateReminderLists.mockResolvedValue(undefined);
    mocks.taskState.taskDetailMap = { 'T-7': reminderDetail };
  });

  afterEach(() => cleanup());

  it('keeps the save button disabled until the draft is dirty', () => {
    render(<TaskInstruction />);

    const save = screen.getByText('taskReminder.instruction.save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('type'));

    expect((screen.getByText('taskReminder.instruction.save') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('never autosaves a reminder task', async () => {
    vi.useFakeTimers();
    render(<TaskInstruction />);

    fireEvent.click(screen.getByTestId('type'));
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(mocks.updateTask).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('still autosaves a plain task after the debounce', async () => {
    mocks.taskState.taskDetailMap = { 'T-7': plainDetail };
    vi.useFakeTimers();
    render(<TaskInstruction />);

    // No footer at all on a non-reminder task.
    expect(screen.queryByText('taskReminder.instruction.save')).toBeNull();

    fireEvent.click(screen.getByTestId('type'));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(mocks.updateTask).toHaveBeenCalledWith(
      'T-7',
      expect.objectContaining({
        instruction: '@胡玉琴 \n\n每日例会 9:00',
      }),
    );
    vi.useRealTimers();
  });

  it('saves through reminderService and reports the interpretation', async () => {
    mocks.saveTask.mockResolvedValue({
      interpretation: {
        recipients: [{ displayName: '胡玉琴A' }, { displayName: '邵军军' }],
        schedule: { kind: 'daily', time: '09:00' },
        scheduleChanged: true,
      },
      status: 'saved',
    });

    render(<TaskInstruction />);
    fireEvent.click(screen.getByTestId('type'));
    clickSave();

    await waitFor(() =>
      expect(mocks.saveTask).toHaveBeenCalledWith({
        editorData: mocks.documents.json,
        instruction: '@胡玉琴 \n\n每日例会 9:00',
        taskId: 'T-7',
      }),
    );
    await waitFor(() =>
      expect(mocks.message.success).toHaveBeenCalledWith(
        expect.stringContaining('taskReminder.instruction.saved'),
      ),
    );
    expect(mocks.message.success).toHaveBeenCalledWith(expect.stringContaining('"count":2'));
    await waitFor(() => expect(mocks.refreshTaskDetail).toHaveBeenCalledWith('T-7'));
    // The draft is clean again, so Save goes back to disabled.
    await waitFor(() =>
      expect(
        (screen.getByText('taskReminder.instruction.save') as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });

  it('renders the clarification alert and rewrites the token when a candidate is picked', async () => {
    mocks.saveTask.mockResolvedValue({
      ambiguous: [
        {
          candidates: [
            { deptPath: '公司/外贸组', leafDeptName: '外贸组', name: '胡玉琴A', staffId: 's1' },
            { deptPath: '公司/安环部', leafDeptName: '安环部', name: '胡玉琴B', staffId: 's2' },
          ],
          query: '胡玉琴',
        },
      ],
      status: 'needs_clarification',
      unknown: ['张三'],
    });

    render(<TaskInstruction />);
    fireEvent.click(screen.getByTestId('type'));
    clickSave();

    await waitFor(() => expect(screen.getByTestId('clarify-alert')).toBeTruthy());
    expect(screen.getByText(/张三/)).toBeTruthy();

    const candidates = screen.getAllByTestId('candidate');
    expect(candidates).toHaveLength(2);

    fireEvent.click(candidates[0]);

    expect(mocks.editor.setDocument).toHaveBeenCalledWith(
      'markdown',
      '@胡玉琴A·外贸组 \n\n每日例会 9:00',
    );
    // The resolved name leaves the alert; the unknown name stays.
    await waitFor(() => expect(screen.queryAllByTestId('candidate')).toHaveLength(0));
  });

  it('reports a failed save without clearing the draft', async () => {
    mocks.saveTask.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<TaskInstruction />);
    fireEvent.click(screen.getByTestId('type'));
    clickSave();

    await waitFor(() =>
      expect(mocks.message.error).toHaveBeenCalledWith('taskReminder.instruction.saveFailed'),
    );
    expect((screen.getByText('taskReminder.instruction.save') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('refuses an empty body with an explicit error', async () => {
    mocks.documents.markdown = '   ';

    render(<TaskInstruction />);
    fireEvent.click(screen.getByTestId('type'));
    clickSave();

    await waitFor(() =>
      expect(mocks.message.error).toHaveBeenCalledWith('taskReminder.error.contentEmpty'),
    );
    expect(mocks.saveTask).not.toHaveBeenCalled();
    // The draft stays dirty so the body is not silently lost.
    expect((screen.getByText('taskReminder.instruction.save') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('strips the editor zero-width space so every mention is sent', async () => {
    mocks.documents.markdown = '@胡玉琴A·外贸组\uFEFF@邵军军·业务部\n\n每日例会';
    mocks.saveTask.mockResolvedValue({ interpretation: {}, status: 'saved' });

    render(<TaskInstruction />);
    fireEvent.click(screen.getByTestId('type'));
    clickSave();

    await waitFor(() =>
      expect(mocks.saveTask).toHaveBeenCalledWith(
        expect.objectContaining({
          instruction: '@胡玉琴A·外贸组 @邵军军·业务部\n\n每日例会',
        }),
      ),
    );
  });

  it('reports a recipient-less body instead of failing silently', async () => {
    // What the server answers when the body carries no mention at all.
    mocks.saveTask.mockResolvedValue({ ambiguous: [], status: 'needs_clarification', unknown: [] });

    render(<TaskInstruction />);
    fireEvent.click(screen.getByTestId('type'));
    clickSave();

    await waitFor(() =>
      expect(mocks.message.error).toHaveBeenCalledWith('taskReminder.recipients.empty'),
    );
    expect(screen.queryByTestId('clarify-alert')).toBeNull();
    expect((screen.getByText('taskReminder.instruction.save') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('maps REMINDER_TIME_PAST to its own toast', async () => {
    mocks.saveTask.mockRejectedValue(new Error('REMINDER_TIME_PAST'));

    render(<TaskInstruction />);
    fireEvent.click(screen.getByTestId('type'));
    clickSave();

    await waitFor(() =>
      expect(mocks.message.error).toHaveBeenCalledWith('taskReminder.error.timePast'),
    );
  });

  it('never clears the draft on an unexpected result shape', async () => {
    mocks.saveTask.mockResolvedValue({ status: 'something_else' });

    render(<TaskInstruction />);
    fireEvent.click(screen.getByTestId('type'));
    clickSave();

    await waitFor(() =>
      expect(mocks.message.error).toHaveBeenCalledWith('taskReminder.instruction.saveFailed'),
    );
    expect(mocks.message.success).not.toHaveBeenCalled();
    expect((screen.getByText('taskReminder.instruction.save') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('revalidates the reminder tables after a successful save', async () => {
    mocks.saveTask.mockResolvedValue({ interpretation: {}, status: 'saved' });

    render(<TaskInstruction />);
    fireEvent.click(screen.getByTestId('type'));
    clickSave();

    await waitFor(() => expect(mocks.mutateReminderLists).toHaveBeenCalled());
  });

  it('restores the persisted body when the draft is discarded', () => {
    render(<TaskInstruction />);
    fireEvent.click(screen.getByTestId('type'));

    fireEvent.click(screen.getByText('taskReminder.instruction.discard'));

    expect(mocks.editor.setDocument).toHaveBeenCalledWith('markdown', '@胡玉琴 \n\n每日例会 9:00');
    expect((screen.getByText('taskReminder.instruction.save') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
