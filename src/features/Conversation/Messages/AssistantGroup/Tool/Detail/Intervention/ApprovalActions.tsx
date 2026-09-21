import { registerPendingHotkeyCard } from '@lobechat/shared-tool-ui/pending-hotkeys';
import { Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { CornerDownLeft } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';

import { useConversationStore } from '../../../../../store';
import CancelInterventionButton, { CANCEL_INTERVENTION_REASON } from './CancelInterventionButton';
import { type ApprovalMode } from './index';

interface ApprovalActionsProps {
  apiName: string;
  approvalMode: ApprovalMode;
  assistantGroupId?: string;
  identifier: string;
  messageId: string;
  /**
   * Callback to be called before approve action
   * Used to flush pending saves (e.g., debounced saves) from intervention components
   */
  onBeforeApprove?: () => void | Promise<void>;
  toolCallId: string;
}

type Choice = 'approve' | 'approve-remember' | 'reject';

/**
 * Which request is in flight. One lock for approve / reject / cancel: each of
 * them resolves the same tool call on the server, so a second decision fired
 * while the first is still travelling could execute an action the user believes
 * they cancelled (or vice versa).
 */
type Busy = 'cancel' | 'submit' | null;

/**
 * Overlays that own the keyboard while open — a card shortcut (Esc above all)
 * must never fire underneath one.
 */
const KEYBOARD_OWNING_OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    width: 100%;
  `,
  footer: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-block-start: 8px;
  `,
  number: css`
    flex-shrink: 0;
    width: 18px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  option: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    min-height: 40px;
    padding-block: 7px;
    padding-inline: 16px;
    border-radius: calc(${cssVar.borderRadiusLG} - 2px);

    color: ${cssVar.colorTextSecondary};

    transition:
      background 120ms,
      color 120ms;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  optionLabel: css`
    flex: 1;
    line-height: 1.4;
  `,
  optionList: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  optionSelected: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  rejectInput: css`
    flex: 1;

    width: 100%;
    padding: 0;
    border: none;
    border-radius: 0;

    font-family: inherit;
    font-size: 14px;
    line-height: 1.4;
    color: ${cssVar.colorText};

    background: transparent;

    &::placeholder {
      color: ${cssVar.colorTextSecondary};
    }

    &:focus,
    &:focus-visible {
      outline: none;
    }

    &:disabled {
      cursor: pointer;
      color: ${cssVar.colorTextSecondary};
    }
  `,
  shortcutHint: css`
    display: inline-flex;
    align-items: center;
    margin-inline-start: 6px;
    color: ${cssVar.colorTextTertiary};
  `,
  submitButton: css`
    &.ant-btn {
      min-width: 88px;
      height: 36px;
      border-radius: calc(${cssVar.borderRadiusLG} - 2px);
    }
  `,
}));

const ApprovalActions = memo<ApprovalActionsProps>(
  ({ approvalMode, apiName, assistantGroupId, identifier, messageId, onBeforeApprove }) => {
    const { t } = useTranslation('chat');
    const [choice, setChoice] = useState<Choice>('approve');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState<Busy>(null);
    const rejectInputRef = useRef<HTMLInputElement>(null);
    // `busy` only commits on the next render; this ref closes the same-tick
    // window where a double click / click + Esc would start two decisions.
    const inFlightRef = useRef(false);

    const isBusy = busy !== null;
    const isMessageCreating = messageId.startsWith('tmp_');
    const isLocked = isBusy || isMessageCreating;
    const isAllowListMode = approvalMode === 'allow-list';

    // Ordered choices drive both the numbered rows and the 1/2/3 shortcuts.
    // "Approve & don't ask again" is a first-class option (allow-list only)
    // rather than a checkbox nested under approve.
    const choices = useMemo<Choice[]>(
      () => (isAllowListMode ? ['approve', 'approve-remember', 'reject'] : ['approve', 'reject']),
      [isAllowListMode],
    );

    const [approveToolCall, cancelToolInteraction, rejectAndContinueToolCall] =
      useConversationStore((s) => [
        s.approveToolCall,
        s.cancelToolInteraction,
        s.rejectAndContinueToolCall,
      ]);
    const addToolToAllowList = useUserStore((s) => s.addToolToAllowList);

    const handleSubmit = useCallback(async () => {
      if (isLocked || inFlightRef.current) return;
      inFlightRef.current = true;
      setBusy('submit');
      try {
        if (choice === 'reject') {
          await rejectAndContinueToolCall(messageId, reason.trim() || undefined);
        } else {
          if (onBeforeApprove) {
            // A rejecting callback blocks the approval; the intervention surfaces its own message.
            try {
              await onBeforeApprove();
            } catch {
              return;
            }
          }
          await approveToolCall(messageId, assistantGroupId ?? '');
          if (isAllowListMode && choice === 'approve-remember') {
            await addToolToAllowList(`${identifier}/${apiName}`);
          }
        }
      } finally {
        inFlightRef.current = false;
        setBusy(null);
      }
    }, [
      addToolToAllowList,
      apiName,
      approveToolCall,
      assistantGroupId,
      choice,
      identifier,
      isAllowListMode,
      isLocked,
      messageId,
      onBeforeApprove,
      reason,
      rejectAndContinueToolCall,
    ]);

    /**
     * Esc — cancel this action. Resolves the tool call and stops there: no
     * assistant reply, unlike the numbered "Reject" option which is an explicit
     * "reject and let the assistant respond". Shared with the footer's X, and
     * under the same lock as Submit — the server resolves the tool call once, so
     * two decisions must never be in flight together.
     */
    const handleCancel = useCallback(async () => {
      if (isLocked || inFlightRef.current) return;
      inFlightRef.current = true;
      setBusy('cancel');
      try {
        await cancelToolInteraction(messageId, CANCEL_INTERVENTION_REASON);
      } finally {
        // A cancel that wins drops this intervention out of the pending list, so
        // this may run after unmount — a no-op in React.
        inFlightRef.current = false;
        setBusy(null);
      }
    }, [cancelToolInteraction, isLocked, messageId]);

    // When choice flips to reject (via click on row, '2', or arrow), pull focus
    // into the inline input so the user can start typing the reason immediately.
    useEffect(() => {
      if (choice === 'reject') {
        rejectInputRef.current?.focus();
      }
    }, [choice]);

    // Page-level keyboard: 1/2/↑/↓ to switch, Enter to submit. Skip while
    // typing anywhere on the page so we never hijack the main chat composer.
    // The reject input has its own onKeyDown for Enter / ↑.
    //
    // Kept fresh in a ref so the shared-arbiter registration below stays
    // mount-stable while the handler always sees current state.
    const containerRef = useRef<HTMLDivElement>(null);
    const onKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
    useEffect(() => {
      onKeyDownRef.current = (e: KeyboardEvent) => {
        if (e.defaultPrevented) return;
        // Never hijack a keystroke the user is aiming somewhere else: text entry
        // (chat composer, this card's own reject-reason input — which handles Esc
        // itself to leave reason mode), IME composition, or an overlay that owns
        // the keyboard while it is open.
        const target = e.target as HTMLElement | null;
        if (target) {
          const tag = target.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
        }
        if (target instanceof Element && target.closest(KEYBOARD_OWNING_OVERLAY_SELECTOR)) return;
        if (e.isComposing || e.keyCode === 229) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        // Digit keys select the matching numbered row directly.
        if (/^[1-9]$/.test(e.key)) {
          const next = choices[Number(e.key) - 1];
          if (next) {
            e.preventDefault();
            setChoice(next);
          }
          return;
        }
        switch (e.key) {
          case 'ArrowUp':
          case 'ArrowDown': {
            e.preventDefault();
            setChoice((c) => {
              const idx = choices.indexOf(c);
              const delta = e.key === 'ArrowUp' ? -1 : 1;
              const nextIdx = (idx + delta + choices.length) % choices.length;
              return choices[nextIdx];
            });
            break;
          }
          case 'Enter': {
            if (e.shiftKey) return;
            e.preventDefault();
            void handleSubmit();
            break;
          }
          case 'Escape': {
            if (isLocked) return;
            e.preventDefault();
            void handleCancel();
            break;
          }
          // No default
        }
      };
    }, [choices, handleCancel, handleSubmit, isLocked]);

    // One registration per mount: the shared arbiter dispatches each keypress
    // to exactly one pending card (containment first, then newest
    // registration), so this card and a coexisting AskUserQuestion card (e.g.
    // in the global approval notification) never race on the same keystroke.
    useEffect(() => {
      return registerPendingHotkeyCard({
        // The footer may be portaled away from the intervention body, so
        // containment covers the whole owning surface (marked with
        // `data-pending-hotkey-scope`: InterventionBar / global approval
        // card), falling back to the footer itself when rendered inline.
        contains: (node) => {
          const el = containerRef.current;
          if (!el) return false;
          return (el.closest('[data-pending-hotkey-scope]') ?? el).contains(node);
        },
        onKeyDown: (e) => onKeyDownRef.current(e),
      });
    }, []);

    const handleRejectInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = choices.indexOf('reject');
        const prev = choices[idx - 1];
        if (prev) setChoice(prev);
        rejectInputRef.current?.blur();
      } else if (e.key === 'Escape') {
        // Inside the reason input Esc only leaves reason mode — it must not
        // cancel the whole action. `preventDefault` also stops the shared
        // arbiter from treating this as a card-level Esc.
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        setChoice(choices[0]);
        rejectInputRef.current?.blur();
      }
    };

    const rejectNumber = choices.indexOf('reject') + 1;

    const approveLabel: Record<'approve' | 'approve-remember', string> = {
      'approve': t('tool.intervention.optionApprove'),
      'approve-remember': t('tool.intervention.optionApproveRemember'),
    };

    return (
      <Flexbox className={styles.container} ref={containerRef}>
        <div className={styles.optionList} role="radiogroup">
          {choices.map((c, index) => {
            if (c === 'reject') {
              return (
                <div
                  aria-checked={choice === 'reject'}
                  className={cx(styles.option, choice === 'reject' && styles.optionSelected)}
                  key={c}
                  role="radio"
                  onClick={() => {
                    setChoice('reject');
                    rejectInputRef.current?.focus();
                  }}
                >
                  <span className={styles.number}>{rejectNumber}.</span>
                  <input
                    aria-label={t('tool.intervention.rejectReasonPlaceholder')}
                    className={styles.rejectInput}
                    disabled={isLocked}
                    placeholder={t('tool.intervention.rejectReasonPlaceholder')}
                    ref={rejectInputRef}
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setChoice('reject')}
                    onKeyDown={handleRejectInputKeyDown}
                  />
                </div>
              );
            }

            return (
              <div
                aria-checked={choice === c}
                className={cx(styles.option, choice === c && styles.optionSelected)}
                key={c}
                role="radio"
                onClick={() => setChoice(c)}
              >
                <span className={styles.number}>{index + 1}.</span>
                <span className={styles.optionLabel}>{approveLabel[c]}</span>
              </div>
            );
          })}
        </div>

        <div className={styles.footer}>
          {/*
            Cancel lives here rather than in a host header so it renders for
            exactly the cards that offer approve / reject — builtin intervention
            renderers, the raw-JSON fallback and the error-boundary fallback.
            Custom interactions (ask-user …) never mount ApprovalActions and keep
            their own close / skip affordance and their own Esc handling.
          */}
          <CancelInterventionButton
            disabled={isLocked}
            loading={busy === 'cancel'}
            onCancel={handleCancel}
          />
          <Button
            className={styles.submitButton}
            disabled={isLocked}
            loading={busy === 'submit'}
            size={'middle'}
            type={'primary'}
            onClick={handleSubmit}
          >
            {t('tool.intervention.submit')}
            <span className={styles.shortcutHint}>
              <CornerDownLeft size={12} />
            </span>
          </Button>
        </div>
      </Flexbox>
    );
  },
);

export default ApprovalActions;
