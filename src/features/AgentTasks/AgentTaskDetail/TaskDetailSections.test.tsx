/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TaskDetailSections from './TaskDetailSections';

const mocks = vi.hoisted(() => ({
  isMobile: true,
  taskState: {
    activeTaskId: 'T-1',
    taskDetailMap: { 'T-1': { config: {}, identifier: 'T-1', status: 'backlog' } } as Record<
      string,
      unknown
    >,
  },
}));

const reminderConfig = {
  reminder: {
    kind: 'reminder',
    once: false,
    reminderId: 'rmd_1',
    scheduleSummary: '每天 09:00',
  },
};

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({
    children,
    horizontal,
    ...props
  }: {
    children?: ReactNode;
    horizontal?: boolean;
    [key: string]: unknown;
  }) => (
    <div data-horizontal={horizontal ? 'true' : 'false'} {...props}>
      {children}
    </div>
  ),
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => mocks.isMobile,
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: any) => selector(mocks.taskState),
}));

vi.mock('./TaskActivities', () => ({ default: () => <div data-testid="task-activities" /> }));
vi.mock('./TaskArtifacts', () => ({ default: () => <div data-testid="task-artifacts" /> }));
vi.mock('./TaskDetailAssignee', () => ({ default: () => <div data-testid="task-assignee" /> }));
vi.mock('./TaskDetailRunPauseAction', () => ({
  default: () => <div data-testid="task-run-action" />,
}));
vi.mock('./TaskDetailTitleInput', () => ({ default: () => <div data-testid="task-title" /> }));
vi.mock('./TaskInstruction', () => ({ default: () => <div data-testid="task-instruction" /> }));
vi.mock('./TaskModelConfig', () => ({ default: () => <div data-testid="task-model" /> }));
vi.mock('./TaskParentBar', () => ({ default: () => <div data-testid="task-parent-bar" /> }));
vi.mock('./TaskProperties', () => ({ default: () => <div data-testid="task-properties" /> }));
vi.mock('./TaskSubtasks', () => ({ default: () => <div data-testid="task-subtasks" /> }));
vi.mock('./TaskVerifyConfig', () => ({ default: () => <div data-testid="task-verify" /> }));
vi.mock('./TaskReminderPanel', () => ({ default: () => <div data-testid="task-reminder" /> }));

const documentOrder = (a: Element, b: Element) =>
  a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;

describe('TaskDetailSections layout', () => {
  beforeEach(() => {
    mocks.isMobile = true;
    mocks.taskState.taskDetailMap = { 'T-1': { config: {}, identifier: 'T-1', status: 'backlog' } };
  });

  it('stacks the properties panel below the title on mobile', () => {
    render(<TaskDetailSections />);

    const title = screen.getByTestId('task-title');
    const properties = screen.getByTestId('task-properties');
    const runAction = screen.getByTestId('task-run-action');

    // Properties render after the title, not as a sibling right column.
    expect(documentOrder(title, properties)).toBeTruthy();
    // Run button stays reachable at the bottom of the stacked header.
    expect(documentOrder(properties, runAction)).toBeTruthy();

    // The header stack must not be a horizontal row on mobile — walking up from
    // the properties panel to the title's container, nothing is horizontal.
    let node: HTMLElement | null = properties.parentElement;
    const seen: string[] = [];
    while (node && !node.contains(title)) {
      seen.push(node.dataset.horizontal ?? 'false');
      node = node.parentElement;
    }
    expect(seen).not.toContain('true');
  });

  it('keeps the two-column header on desktop', () => {
    mocks.isMobile = false;
    render(<TaskDetailSections />);

    const title = screen.getByTestId('task-title');
    const properties = screen.getByTestId('task-properties');
    const runAction = screen.getByTestId('task-run-action');

    // Desktop keeps properties in the right column, i.e. after the run button,
    // inside a horizontal row.
    expect(documentOrder(runAction, properties)).toBeTruthy();
    expect(properties.parentElement?.dataset.horizontal).toBe('true');
    expect(documentOrder(title, properties)).toBeTruthy();
  });
});

describe('TaskDetailSections reminder branch', () => {
  beforeEach(() => {
    mocks.isMobile = false;
    mocks.taskState.taskDetailMap = {
      'T-1': { config: reminderConfig, identifier: 'T-1', status: 'scheduled' },
    };
  });

  it('swaps the agent-run controls for the reminder panel', () => {
    render(<TaskDetailSections />);

    expect(screen.getByTestId('task-reminder')).toBeTruthy();
    // Nothing that belongs to an agent run survives on a reminder task.
    expect(screen.queryByTestId('task-assignee')).toBeNull();
    expect(screen.queryByTestId('task-model')).toBeNull();
    expect(screen.queryByTestId('task-verify')).toBeNull();
    expect(screen.queryByTestId('task-run-action')).toBeNull();
    // The body editor and the shared sections stay.
    expect(screen.getByTestId('task-instruction')).toBeTruthy();
    expect(screen.getByTestId('task-properties')).toBeTruthy();
  });

  it('renders the reminder panel above the body on mobile too', () => {
    mocks.isMobile = true;
    render(<TaskDetailSections />);

    const panel = screen.getByTestId('task-reminder');
    const instruction = screen.getByTestId('task-instruction');

    expect(documentOrder(panel, instruction)).toBeTruthy();
  });

  it('keeps the agent-run controls on a normal task', () => {
    mocks.taskState.taskDetailMap = {
      'T-1': { config: {}, identifier: 'T-1', status: 'backlog' },
    };
    render(<TaskDetailSections />);

    expect(screen.queryByTestId('task-reminder')).toBeNull();
    expect(screen.getByTestId('task-assignee')).toBeTruthy();
    expect(screen.getByTestId('task-verify')).toBeTruthy();
  });
});
