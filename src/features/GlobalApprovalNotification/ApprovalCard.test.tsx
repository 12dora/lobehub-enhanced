/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import ApprovalCard from './ApprovalCard';
import type { GlobalApprovalGroup } from './useGlobalPendingApprovals';

// The shared test i18n instance uses the default `.` key separator, so the flat
// `globalApproval.*` keys never resolve there. Assert on the keys instead, which
// is what actually has to stay in sync with `packages/locales/src/default/chat.ts`.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => `t:${key}` }),
}));

// The card's own `ConversationProvider` / intervention body are not under test
// here — the header wiring is.
vi.mock('@/features/Conversation', () => ({
  ConversationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
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

const buildGroup = (identifier: string): GlobalApprovalGroup => ({
  context,
  interventions: [
    {
      apiName: 'someWrite',
      identifier,
      intervention: { status: 'pending' } as never,
      requestArgs: '{}',
      toolCallId: 'call_1',
      toolMessageId: 'msg_tool',
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
  useChatStore.setState({ dbMessagesMap: { [chatKey]: [] as UIChatMessage[] } } as never);
});

describe('ApprovalCard header', () => {
  it('renders the approval header and the intervention body', () => {
    renderCard(buildGroup('lobe-dingtalk-approval'));

    expect(screen.getByTestId('intervention-body')).toBeInTheDocument();
    // Matched loosely: the subtitle line is prefixed with the agent name.
    expect(screen.getByText(/globalApproval\.subtitle/)).toBeInTheDocument();
  });

  it.each([['lobe-dingtalk-approval'], ['lobe-user-interaction'], ['lobe-claude-code']])(
    'leaves cancel to the intervention body for %s',
    (identifier) => {
      renderCard(buildGroup(identifier));

      // Cancel is owned by `ApprovalActions`, which only the approve/reject
      // renderers mount. A header copy here would double up on approval cards
      // and add a stray X to custom interactions (ask-user …) that already have
      // their own close affordance.
      expect(screen.queryByLabelText('t:globalApproval.cancel')).toBeNull();
    },
  );
});
