/**
 * Operation-log event detail slide-in.
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Format from '../shared/format';
import EventDetailDrawer, { EVENT_PANEL_WIDTH, resolveEventPanelMotion } from './EventDetailDrawer';

const state = vi.hoisted(() => ({
  fetchCalls: [] as { enabled: boolean; id: string | undefined }[],
  motion: null as any,
  popupClassName: null as string | null | undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      ({
        'audit.logs.targetId.global': '全局',
        'audit.logs.targetType.audit_policy': '审计设置',
        'audit.logs.targetType.topic': '会话',
      })[key] ??
      opts?.defaultValue ??
      key,
  }),
}));

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/components/NeuralNetworkLoading', () => ({ default: () => null }));
vi.mock('../../primitives/UserNameCell', () => ({ default: () => <span>actor</span> }));
vi.mock('../shared/AuditStatusTag', () => ({ default: () => <span>status</span> }));
vi.mock('../shared/JsonDiffView', () => ({ default: () => <div>diff</div> }));
vi.mock('../shared/format', async (importOriginal) => ({
  ...(await importOriginal<typeof Format>()),
  formatAdminDateTime: () => '2026-09-18 10:00',
}));

const detail = (id: string) => ({
  action: 'topic.view',
  actorUser: null,
  actorUserId: 'user_1',
  afterDiff: null,
  beforeDiff: null,
  createdAt: new Date('2026-09-18T10:00:00Z'),
  id,
  reason: null,
  result: 'success',
  targetId: 'tpc_aQCv8pnTXPA7',
  targetLabel: 'Quarterly planning notes',
  targetType: 'topic',
});

vi.mock('../hooks/useAdminAudit', () => ({
  useFetchAuditEventDetail: (id: string | undefined, enabled: boolean) => {
    state.fetchCalls.push({ enabled, id });
    return { data: enabled && id ? detail(id) : undefined, error: undefined, isLoading: false };
  },
}));

vi.mock('@lobehub/ui/base-ui', () => {
  const Ctx = {
    onExitComplete: null as null | (() => void),
    onOpenChange: null as any,
    open: false,
  };
  return {
    Button: ({ children, onClick }: any) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    DrawerBackdrop: () => null,
    DrawerClose: (props: any) => (
      <button type="button" onClick={() => Ctx.onOpenChange?.(false)} {...props}>
        drawer-close
      </button>
    ),
    DrawerContent: ({ children }: any) => <div>{children}</div>,
    DrawerHeader: ({ children }: any) => <div>{children}</div>,
    DrawerPopup: ({ children, className, motionProps, placement, popupStyle, width }: any) => {
      state.popupClassName = className;
      state.motion = motionProps;
      return (
        <div
          data-open={String(Ctx.open)}
          data-placement={placement}
          data-popup-width={popupStyle?.width}
          data-testid="drawer"
          data-width={String(width)}
        >
          <button type="button" onClick={() => Ctx.onExitComplete?.()}>
            drawer-exit-complete
          </button>
          {children}
        </div>
      );
    },
    DrawerPortal: ({ children }: any) => <>{children}</>,
    DrawerRoot: ({ children, onExitComplete, onOpenChange, open }: any) => {
      Ctx.onExitComplete = onExitComplete;
      Ctx.onOpenChange = onOpenChange;
      Ctx.open = Boolean(open);
      return <>{children}</>;
    },
    DrawerTitle: ({ children }: any) => <div data-testid="drawer-title">{children}</div>,
    Text: ({ children }: any) => <span>{children}</span>,
  };
});

describe('EventDetailDrawer', () => {
  beforeEach(() => {
    state.fetchCalls.length = 0;
    state.motion = null;
    state.popupClassName = null;
  });

  it('slides in from the right with a stable CSS width and the clip fix', () => {
    render(<EventDetailDrawer open eventId="evt_1" onClose={vi.fn()} />);

    const drawer = screen.getByTestId('drawer');
    expect(drawer.dataset.open).toBe('true');
    expect(drawer.dataset.placement).toBe('right');
    expect(drawer.dataset.width).toBe(EVENT_PANEL_WIDTH);
    expect(drawer.dataset.popupWidth).toBe(`calc(${EVENT_PANEL_WIDTH} + 48px)`);
    expect(state.popupClassName).toBeTruthy();
    expect(state.motion.exit.x).toBe('100%');
    expect(state.motion.transition.duration).toBeGreaterThan(state.motion.exit.transition.duration);
    expect(resolveEventPanelMotion(true).transition.duration).toBe(0);
  });

  it('shows the resolved target label with the raw id underneath', () => {
    render(<EventDetailDrawer open eventId="evt_1" onClose={vi.fn()} />);

    expect(screen.getByTestId('event-target').textContent).toBe('会话 · Quarterly planning notes');
    expect(screen.getByText('tpc_aQCv8pnTXPA7')).toBeTruthy();
  });

  it('keeps the event rendered during the slide-out and drops it after exit completes', () => {
    const { rerender } = render(<EventDetailDrawer open eventId="evt_1" onClose={vi.fn()} />);

    rerender(<EventDetailDrawer eventId={null} open={false} onClose={vi.fn()} />);
    expect(screen.getByTestId('event-target')).toBeTruthy();
    expect(state.fetchCalls.at(-1)).toEqual({ enabled: true, id: 'evt_1' });

    fireEvent.click(screen.getByText('drawer-exit-complete'));
    expect(screen.queryByTestId('event-target')).toBeNull();
  });

  it('closes from the drawer chrome', () => {
    const onClose = vi.fn();
    render(<EventDetailDrawer open eventId="evt_1" onClose={onClose} />);
    fireEvent.click(screen.getByText('drawer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
