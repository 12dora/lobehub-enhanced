/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AUDIT_STREAM_TOP_THRESHOLD_PX, useAuditStreamScroll } from './useAuditStreamScroll';

const ROW_PX = 40;

interface HarnessProps {
  count: number;
  loadingOlder?: boolean;
  onNearTop?: () => void;
  resetKey?: string;
}

/** Box whose scrollHeight follows the rendered row count (happy-dom has no layout). */
const Harness = ({ count, loadingOlder, onNearTop, resetKey }: HarnessProps) => {
  const { onScroll, scrollRef, showJump } = useAuditStreamScroll({
    itemCount: count,
    loadingOlder,
    onNearTop,
    resetKey,
  });
  return (
    <div
      data-count={count}
      data-jump={showJump ? '1' : '0'}
      data-testid="box"
      ref={(el) => {
        scrollRef.current = el;
        if (el && !Object.getOwnPropertyDescriptor(el, 'scrollHeight')) {
          Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 200 });
          Object.defineProperty(el, 'scrollHeight', {
            configurable: true,
            get: () => Number(el.dataset.count) * ROW_PX,
          });
        }
      }}
      onScroll={onScroll}
    />
  );
};

const box = (container: HTMLElement) => container.firstElementChild as HTMLDivElement;

describe('useAuditStreamScroll', () => {
  it('opens at the bottom once the first items arrive', () => {
    const { container, rerender } = render(<Harness count={0} />);
    rerender(<Harness count={20} />);
    expect(box(container).scrollTop).toBe(20 * ROW_PX);
  });

  it('jumps to the bottom when resetKey changes, even with an unchanged item count', () => {
    const { container, rerender } = render(<Harness count={20} resetKey="a" />);
    const el = box(container);
    el.scrollTop = 0;
    fireEvent.scroll(el);

    rerender(<Harness count={20} resetKey="b" />);
    expect(el.scrollTop).toBe(20 * ROW_PX);
    expect(el.dataset.jump).toBe('0');
  });

  it('keeps the reading position anchored when older messages prepend', () => {
    const { container, rerender } = render(<Harness count={20} />);
    const el = box(container);
    el.scrollTop = 30;
    fireEvent.scroll(el);

    rerender(<Harness loadingOlder count={20} />);
    rerender(<Harness count={30} loadingOlder={false} />);

    expect(el.scrollTop).toBe(30 + 10 * ROW_PX);
    // A prepend is not "new messages below": no jump affordance.
    expect(el.dataset.jump).toBe('0');
  });

  it('offers the jump affordance when new messages append while scrolled up', () => {
    const { container, rerender } = render(<Harness count={20} />);
    const el = box(container);
    el.scrollTop = 100;
    fireEvent.scroll(el);

    rerender(<Harness count={21} />);
    expect(el.scrollTop).toBe(100);
    expect(el.dataset.jump).toBe('1');
  });

  it('calls onNearTop only within the top threshold and never from the bottom', () => {
    const onNearTop = vi.fn();
    const { container } = render(<Harness count={20} onNearTop={onNearTop} />);
    const el = box(container);

    el.scrollTop = 20 * ROW_PX - 200;
    fireEvent.scroll(el);
    el.scrollTop = AUDIT_STREAM_TOP_THRESHOLD_PX + 1;
    fireEvent.scroll(el);
    expect(onNearTop).not.toHaveBeenCalled();

    el.scrollTop = AUDIT_STREAM_TOP_THRESHOLD_PX;
    fireEvent.scroll(el);
    expect(onNearTop).toHaveBeenCalledTimes(1);
  });
});
