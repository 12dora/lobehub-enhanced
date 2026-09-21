/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import type * as BaseUiModule from '@lobehub/ui/base-ui';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import ApprovalCard from './ApprovalCard';
import type { GlobalApprovalGroup } from './useGlobalPendingApprovals';

const rejectAndContinueToolCall = vi.fn(async () => {});

// The shared test i18n instance uses the default `.` key separator, so the flat
// `globalApproval.*` keys never resolve there. Assert on the keys instead, which
// is what actually has to stay in sync with `packages/locales/src/default/chat.ts`.
// base-ui ActionIcon needs the app's MotionProvider; a plain button keeps the test focused on behaviour.
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof BaseUiModule>()),
  ActionIcon: ({
    disabled,
    loading,
    onClick,
    title,
    'aria-label': ariaLabel,
  }: {
    'aria-label'?: string;
    'disabled'?: boolean;
    'loading'?: boolean;
    'onClick'?: () => void;
    'title'?: string;
  }) => (
    <button
      aria-label={ariaLabel}
      data-loading={loading ? 'true' : undefined}
      disabled={disabled || loading}
      title={title}
      type="button"
      onClick={onClick}
    />
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => `t:${key}` }),
}));

// The card's own `ConversationProvider` / intervention body are not under test
// here — the header wiring and the cancel action are.
vi.mock('@/features/Conversation', () => ({
  ConversationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({ rejectAndContinueToolCall }),
}));

vi.mock('@/features/Conversation/InterventionBar/InterventionContent', () => ({
  default: () => <div data-testid="intervention-body" />,
}));

vi.mock('@/features/Conversation/InterventionBar/InterventionTabBar', () => ({
  default: () => null,
}));

vi.mock('@/features/Conversation/Markdown', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const context = { agentId: 'agt_1', threadId: null, topicId: 'tpc_1' };
const chatKey = 'agt_1_tpc_1';

const buildGroup = (toolMessageId: string): GlobalApprovalGroup => ({
  context,
  interventions: [
    {
      apiName: 'someWrite',
      identifier: 'lobe-dingtalk-approval',
      intervention: { status: 'pending' } as never,
      requestArgs: '{}',
      toolCallId: 'call_1',
      toolMessageId,
    },
  ],
  key: chatKey,
});

const renderCard = (group: GlobalApprovalGroup) =>
  render(
    <MemoryRouter>
      <ApprovalCard group={group} />
    </MemoryRouter>,
  );

beforeEach(() => {
  rejectAndContinueToolCall.mockClear();
  rejectAndContinueToolCall.mockImplementation(async () => {});
  useChatStore.setState({ dbMessagesMap: { [chatKey]: [] as UIChatMessage[] } } as never);
});

describe('ApprovalCard cancel button', () => {
  it('cancels the active intervention with the localized reason', async () => {
    renderCard(buildGroup('msg_tool'));

    const cancel = screen.getByLabelText('t:globalApproval.cancel');

    await act(async () => {
      cancel.click();
    });

    expect(rejectAndContinueToolCall).toHaveBeenCalledTimes(1);
    expect(rejectAndContinueToolCall).toHaveBeenCalledWith(
      'msg_tool',
      't:globalApproval.cancelReason',
    );
  });

  it('stays disabled while the cancel request is in flight', async () => {
    let resolveReject: (() => void) | undefined;
    rejectAndContinueToolCall.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveReject = () => resolve();
        }),
    );

    renderCard(buildGroup('msg_tool'));

    const cancel = screen.getByLabelText('t:globalApproval.cancel');

    await act(async () => {
      cancel.click();
    });

    // Second click while the first request is still pending must be a no-op.
    await act(async () => {
      cancel.click();
    });

    expect(rejectAndContinueToolCall).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveReject?.();
    });
  });

  it('does not cancel a tool message that is still being created', async () => {
    renderCard(buildGroup('tmp_msg_tool'));

    const cancel = screen.getByLabelText('t:globalApproval.cancel');

    await act(async () => {
      cancel.click();
    });

    expect(rejectAndContinueToolCall).not.toHaveBeenCalled();
  });
});
