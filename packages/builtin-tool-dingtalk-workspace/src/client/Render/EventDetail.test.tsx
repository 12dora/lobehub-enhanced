/**
 * @vitest-environment happy-dom
 */
import type { BuiltinRenderProps } from '@lobechat/types';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import EventDetail from './EventDetail';

const dict = zhPlugin as Record<string, string>;

const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

afterEach(() => cleanup());

const props = (pluginState?: unknown): BuiltinRenderProps<Record<string, unknown>, any> => ({
  args: {},
  content: '',
  messageId: 'msg_1',
  pluginState,
});

const EVENT = {
  attendees: [{ displayName: '张三' }, { displayName: '李四' }],
  end: '2026-09-21T10:30:00+08:00',
  eventId: 'evt_1',
  location: '会议室 A',
  start: '2026-09-21T09:30:00+08:00',
  summary: '季度评审',
};

describe('EventDetail', () => {
  it('renders the event nested under `event`', () => {
    render(<EventDetail {...props({ event: EVENT, success: true })} />);

    expect(screen.getByText('季度评审')).toBeTruthy();
    expect(screen.getByText('2026-09-21 09:30 – 10:30')).toBeTruthy();
    expect(screen.getByText('会议室 A')).toBeTruthy();
    expect(screen.getByText('2 人参与')).toBeTruthy();
  });

  it('also renders a state the runtime spread flat onto itself', () => {
    // `okResult({ ...event })` is the other shape the runtime may produce; a blank
    // card after a successful getEvent would be worse than tolerating both.
    render(<EventDetail {...props({ ...EVENT, success: true })} />);

    expect(screen.getByText('季度评审')).toBeTruthy();
    expect(screen.getByText('2026-09-21 09:30 – 10:30')).toBeTruthy();
  });

  it('renders nothing when the state carries no event at all', () => {
    const { container } = render(<EventDetail {...props({ success: true })} />);

    expect(container.innerHTML).toBe('');
  });
});
