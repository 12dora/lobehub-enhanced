'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { isNearBottom, LIVE_SCROLL_BOTTOM_THRESHOLD_PX } from './liveMessageUtils';

/** Distance (px) from the top of the transcript at which older history starts loading. */
export const AUDIT_STREAM_TOP_THRESHOLD_PX = 120;

export interface AuditStreamScrollArgs {
  itemCount: number;
  loadingOlder?: boolean;
  /** Called when the reader scrolls within {@link AUDIT_STREAM_TOP_THRESHOLD_PX} of the top. */
  onNearTop?: () => void;
  /**
   * Identity of the transcript (topic, body mode, …). A change starts over at the newest message:
   * stickiness, the prepend anchor and the jump affordance reset and the box scrolls to the bottom.
   */
  resetKey?: string;
}

/**
 * Follow-the-tail scrolling for an audit transcript (newest message at the bottom): sticks to the
 * bottom while the auditor is there, offers a jump affordance when new messages arrive while they
 * are not, asks for older history near the top, and restores the reading position after an older
 * page prepends. Shared by the live message pane and the conversation-history topic page.
 */
export const useAuditStreamScroll = ({
  itemCount,
  loadingOlder,
  onNearTop,
  resetKey,
}: AuditStreamScrollArgs) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const prevCountRef = useRef(0);
  const itemCountRef = useRef(itemCount);
  itemCountRef.current = itemCount;
  const wasLoadingOlderRef = useRef(false);
  const anchorScrollHeightRef = useRef(0);
  const anchorScrollTopRef = useRef(0);
  const onNearTopRef = useRef(onNearTop);
  onNearTopRef.current = onNearTop;

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    setShowJump(false);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el, LIVE_SCROLL_BOTTOM_THRESHOLD_PX);
    stickToBottomRef.current = near;
    if (near) setShowJump(false);
    // A box that fits entirely is "near the bottom" too — only a real upward scroll asks for more.
    if (!near && el.scrollTop <= AUDIT_STREAM_TOP_THRESHOLD_PX) onNearTopRef.current?.();
  }, []);

  // Capture scroll metrics before older messages prepend.
  useLayoutEffect(() => {
    if (loadingOlder && !wasLoadingOlderRef.current) {
      const el = scrollRef.current;
      if (el) {
        anchorScrollHeightRef.current = el.scrollHeight;
        anchorScrollTopRef.current = el.scrollTop;
      }
    }
    wasLoadingOlderRef.current = Boolean(loadingOlder);
  }, [loadingOlder]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    // Restore relative position after older-page prepend (do not rely on overflow-anchor).
    if (el && !loadingOlder && anchorScrollHeightRef.current > 0) {
      const delta = el.scrollHeight - anchorScrollHeightRef.current;
      anchorScrollHeightRef.current = 0;
      if (delta > 0) {
        el.scrollTop = anchorScrollTopRef.current + delta;
        prevCountRef.current = itemCount;
        return;
      }
    }

    const grew = itemCount > prevCountRef.current;
    prevCountRef.current = itemCount;
    if (grew && stickToBottomRef.current) {
      scrollToBottom();
    } else if (grew && !stickToBottomRef.current) {
      setShowJump(true);
    }
  }, [itemCount, loadingOlder, scrollToBottom]);

  // A new transcript identity starts reading at the newest message. Layout effect so a cached
  // transcript (same item count, no "grew" signal) still lands at the bottom before paint.
  useLayoutEffect(() => {
    prevCountRef.current = itemCountRef.current;
    anchorScrollHeightRef.current = 0;
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  return { onScroll, scrollRef, scrollToBottom, showJump };
};
