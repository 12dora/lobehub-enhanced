/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ApprovalActions from './ApprovalActions';
import { CANCEL_INTERVENTION_REASON } from './CancelInterventionButton';

const approveToolCall = vi.fn(async () => {});
const cancelToolInteraction = vi.fn(async () => {});
const rejectAndContinueToolCall = vi.fn(async () => {});

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    disabled,
    loading,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled || loading} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Flexbox: ({
    children,
    className,
    ref,
  }: {
    children?: ReactNode;
    className?: string;
    ref?: Ref<HTMLDivElement>;
  }) => (
    <div className={className} ref={ref}>
      {children}
    </div>
  ),
}));

// `ApprovalActions` only takes the `ApprovalMode` *type* from the intervention
// barrel; stub it so the test never pulls the builtin-tool registry in.
vi.mock('./index', () => ({ default: () => null }));

// base-ui ActionIcon needs the app's MotionProvider; a plain button keeps the
// test focused on the cancel behaviour.
vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({
    disabled,
    loading,
    onClick,
    'aria-label': ariaLabel,
  }: {
    'aria-label'?: string;
    'disabled'?: boolean;
    'loading'?: boolean;
    'onClick'?: () => void;
  }) => (
    <button aria-label={ariaLabel} disabled={disabled || loading} type="button" onClick={onClick} />
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t:${key}` }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({ addToolToAllowList: vi.fn() }),
}));

vi.mock('../../../../../store', () => ({
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({ approveToolCall, cancelToolInteraction, rejectAndContinueToolCall }),
}));

const renderActions = () =>
  render(
    <ApprovalActions
      apiName="someWrite"
      approvalMode="manual"
      identifier="lobe-dingtalk-approval"
      messageId="tool-msg-1"
      toolCallId="call_1"
    />,
  );

const renderCreatingActions = () =>
  render(
    <ApprovalActions
      apiName="someWrite"
      approvalMode="manual"
      identifier="lobe-dingtalk-approval"
      messageId="tmp_tool-msg-1"
      toolCallId="call_1"
    />,
  );

const cancelButton = () => screen.getByLabelText('t:globalApproval.cancel');
const submitButton = () => screen.getByRole('button', { name: /tool\.intervention\.submit/ });

const pressEscape = (target: Element, init: KeyboardEventInit = {}) => {
  fireEvent(target, new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', ...init }));
};

beforeEach(() => {
  approveToolCall.mockClear();
  cancelToolInteraction.mockClear();
  rejectAndContinueToolCall.mockClear();
  approveToolCall.mockImplementation(async () => {});
  cancelToolInteraction.mockImplementation(async () => {});
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('ApprovalActions cancel button', () => {
  it('cancels the pending approval without resuming the run', async () => {
    renderActions();

    await act(async () => {
      cancelButton().click();
    });

    expect(cancelToolInteraction).toHaveBeenCalledTimes(1);
    // The reason is the persisted tool result the model reads next turn, so it
    // must be the fixed English sentence — never a translated string.
    expect(cancelToolInteraction).toHaveBeenCalledWith('tool-msg-1', CANCEL_INTERVENTION_REASON);
    expect(CANCEL_INTERVENTION_REASON).toBe('The user cancelled this action. It was not executed.');
    expect(rejectAndContinueToolCall).not.toHaveBeenCalled();
    expect(approveToolCall).not.toHaveBeenCalled();
  });

  it('stays disabled while the cancel request is in flight', async () => {
    let resolveCancel: (() => void) | undefined;
    cancelToolInteraction.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = () => resolve();
        }),
    );

    renderActions();
    const cancel = cancelButton();

    await act(async () => {
      cancel.click();
    });
    await act(async () => {
      cancel.click();
    });

    expect(cancelToolInteraction).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCancel?.();
    });
  });

  it('does not cancel a tool message that is still being created', async () => {
    renderCreatingActions();

    await act(async () => {
      cancelButton().click();
    });

    expect(cancelToolInteraction).not.toHaveBeenCalled();
  });
});

describe('ApprovalActions single in-flight lock', () => {
  it('blocks cancel (button and Escape) while an approve is in flight', async () => {
    approveToolCall.mockImplementation(() => new Promise<void>(() => {}));
    renderActions();

    await act(async () => {
      submitButton().click();
    });

    expect(approveToolCall).toHaveBeenCalledTimes(1);

    // Approve and cancel resolve the same tool call server-side, so the X must
    // not stay live and let the user "cancel" an action already being executed.
    expect(cancelButton()).toBeDisabled();

    await act(async () => {
      cancelButton().click();
    });
    pressEscape(document.body);

    expect(cancelToolInteraction).not.toHaveBeenCalled();
  });

  it('blocks approve while a cancel is in flight', async () => {
    cancelToolInteraction.mockImplementation(() => new Promise<void>(() => {}));
    renderActions();

    await act(async () => {
      cancelButton().click();
    });

    expect(cancelToolInteraction).toHaveBeenCalledTimes(1);
    expect(submitButton()).toBeDisabled();

    await act(async () => {
      submitButton().click();
    });

    expect(approveToolCall).not.toHaveBeenCalled();
    expect(rejectAndContinueToolCall).not.toHaveBeenCalled();
  });
});

describe('ApprovalActions Escape handling', () => {
  it('cancels the pending approval without resuming the run', () => {
    renderActions();

    pressEscape(document.body);

    expect(cancelToolInteraction).toHaveBeenCalledTimes(1);
    expect(cancelToolInteraction).toHaveBeenCalledWith('tool-msg-1', CANCEL_INTERVENTION_REASON);
    // Esc is not the numbered "Reject" option — nothing may make the agent reply.
    expect(rejectAndContinueToolCall).not.toHaveBeenCalled();
    expect(approveToolCall).not.toHaveBeenCalled();
  });

  it('ignores Escape while the user is typing in an input outside the card', () => {
    renderActions();

    const composer = document.createElement('textarea');
    document.body.append(composer);

    pressEscape(composer);

    expect(cancelToolInteraction).not.toHaveBeenCalled();
  });

  it('ignores Escape inside a contenteditable surface', () => {
    renderActions();

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.append(editor);

    pressEscape(editor);

    expect(cancelToolInteraction).not.toHaveBeenCalled();
  });

  it('ignores Escape while an IME composition is active', () => {
    renderActions();

    pressEscape(document.body, { isComposing: true });
    // Legacy IME signal used by browsers that do not set `isComposing`.
    pressEscape(document.body, { keyCode: 229 });

    expect(cancelToolInteraction).not.toHaveBeenCalled();
  });

  it('ignores Escape aimed at an overlay that owns the keyboard', () => {
    renderActions();

    for (const role of ['dialog', 'alertdialog', 'menu', 'listbox']) {
      const overlay = document.createElement('div');
      overlay.setAttribute('role', role);
      const inner = document.createElement('span');
      overlay.append(inner);
      document.body.append(overlay);

      pressEscape(inner);
    }

    expect(cancelToolInteraction).not.toHaveBeenCalled();
  });

  it('ignores Escape combined with a modifier key', () => {
    renderActions();

    pressEscape(document.body, { metaKey: true });
    pressEscape(document.body, { ctrlKey: true });
    pressEscape(document.body, { altKey: true });

    expect(cancelToolInteraction).not.toHaveBeenCalled();
  });

  it('ignores Escape while a cancel request is already in flight', () => {
    cancelToolInteraction.mockImplementation(() => new Promise<void>(() => {}));
    renderActions();

    pressEscape(document.body);
    pressEscape(document.body);

    expect(cancelToolInteraction).toHaveBeenCalledTimes(1);
  });

  it('does not cancel a tool message that is still being created', () => {
    renderCreatingActions();

    pressEscape(document.body);

    expect(cancelToolInteraction).not.toHaveBeenCalled();
  });

  it('leaves reason mode instead of cancelling when Escape lands in the reject input', () => {
    renderActions();

    const reasonInput = screen.getByLabelText('t:tool.intervention.rejectReasonPlaceholder');
    const [approveOption, rejectOption] = screen.getAllByRole('radio');

    fireEvent.click(rejectOption);
    expect(rejectOption).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(reasonInput, { key: 'Escape' });

    expect(cancelToolInteraction).not.toHaveBeenCalled();
    expect(rejectAndContinueToolCall).not.toHaveBeenCalled();
    expect(approveOption).toHaveAttribute('aria-checked', 'true');
  });
});
