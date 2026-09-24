/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBeforeApproveSnapshot, runBeforeApproveChecks } from './beforeApproveRegistry';
import Intervention from './index';

const { cardCheck } = vi.hoisted(() => ({ cardCheck: vi.fn() }));

/** A builtin card that claims the host's before-approve hook on mount, like the DingTalk confirm cards. */
const CheckingCard = ({
  registerBeforeApprove,
}: {
  registerBeforeApprove?: (id: string, callback: () => void | Promise<void>) => () => void;
}) => {
  useEffect(() => registerBeforeApprove?.('card-check', cardCheck), [registerBeforeApprove]);
  return <div>card body</div>;
};

vi.mock('@lobechat/builtin-tools/interventions', () => ({
  getBuiltinIntervention: (identifier: string) =>
    identifier === 'checking-tool' ? CheckingCard : undefined,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  toolInterventionSelectors: { approvalMode: () => 'manual' },
}));

vi.mock('../../../../../store', () => ({
  dataSelectors: { getDbMessageById: () => () => undefined },
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({
      cancelToolInteraction: vi.fn(),
      skipToolInteraction: vi.fn(),
      submitHeteroIntervention: vi.fn(),
      submitToolInteraction: vi.fn(),
      updatePluginArguments: vi.fn(),
    }),
}));

vi.mock('../Arguments', () => ({ default: () => null }));
vi.mock('./Fallback', () => ({ default: () => <div>fallback body</div> }));
vi.mock('./KeyValueEditor', () => ({ default: () => null }));
vi.mock('./SecurityBlacklistWarning', () => ({ default: () => null }));

vi.mock('./customInteractionHandlers', () => ({
  isCustomInteractionIdentifier: () => false,
  isHeteroInteractionIdentifier: () => false,
  prepareCustomInteractionSubmit: vi.fn(),
  recordCustomInteractionResolution: vi.fn(),
}));

// The card's own footer: approving runs the host's before-approve handler first.
vi.mock('./ApprovalActions', () => ({
  default: ({ onBeforeApprove }: { onBeforeApprove?: () => void | Promise<void> }) => (
    <button type="button" onClick={() => void onBeforeApprove?.()}>
      approve
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  cardCheck.mockReset();
});

const renderIntervention = (identifier: string, id = 'tool-msg-1') =>
  render(
    <Intervention
      apiName="doThing"
      id={id}
      identifier={identifier}
      requestArgs="{}"
      toolCallId={`call_${id}`}
    />,
  );

describe('Intervention before-approve checks', () => {
  it('the card’s own approve still runs its check exactly once', () => {
    renderIntervention('checking-tool');

    fireEvent.click(screen.getByText('approve'));

    expect(cardCheck).toHaveBeenCalledTimes(1);
  });

  it('mirrors the card’s check into the shared registry while the card is on screen', async () => {
    const { unmount } = renderIntervention('checking-tool', 'tool-msg-2');

    expect(getBeforeApproveSnapshot('tool-msg-2')).toMatchObject({ checkCount: 1, mounted: true });

    // What "approve all" runs for this call: the very same check.
    await runBeforeApproveChecks('tool-msg-2');
    expect(cardCheck).toHaveBeenCalledTimes(1);

    unmount();
    expect(getBeforeApproveSnapshot('tool-msg-2')).toMatchObject({ checkCount: 0, mounted: false });
  });

  it('marks a card without checks as mounted, so approve all may approve it directly', () => {
    const { unmount } = renderIntervention('plain-tool', 'tool-msg-3');

    expect(screen.getByText('fallback body')).toBeInTheDocument();
    expect(getBeforeApproveSnapshot('tool-msg-3')).toMatchObject({ checkCount: 0, mounted: true });

    unmount();
    expect(getBeforeApproveSnapshot('tool-msg-3').mounted).toBe(false);
  });
});
