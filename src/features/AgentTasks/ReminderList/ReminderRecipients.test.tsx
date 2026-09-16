/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import zhChat from '../../../../locales/zh-CN/chat.json';
import ReminderRecipients from './ReminderRecipients';
import type { ReminderRecipientView } from './types';

const dict = zhChat as Record<string, string>;

/** Real zh-CN copy so the chip format itself is under test. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN chat key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <span data-tooltip={String(title)}>{children}</span>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tag: ({ children }: { children?: ReactNode }) => <span data-testid="chip">{children}</span>,
}));

const user = (name: string, deptName?: string): ReminderRecipientView => ({
  deptName,
  displayName: name,
  kind: 'user',
  staffId: name,
});

const department = (name: string, memberCount: number): ReminderRecipientView => ({
  deptId: name,
  displayName: name,
  kind: 'department',
  memberCount,
});

describe('ReminderRecipients', () => {
  it('renders a user chip as `@name · dept`', () => {
    render(<ReminderRecipients recipients={[user('胡玉琴A', '安环部')]} />);

    expect(screen.getByTestId('chip')).toHaveTextContent('@胡玉琴A · 安环部');
  });

  it('drops the separator when the user has no department', () => {
    render(<ReminderRecipients recipients={[user('胡玉琴A')]} />);

    expect(screen.getByTestId('chip').textContent).toBe('@胡玉琴A');
  });

  it('renders a department chip with its member count', () => {
    render(<ReminderRecipients recipients={[department('安环部', 12)]} />);

    expect(screen.getByTestId('chip')).toHaveTextContent('@安环部 · 12 人');
  });

  it('collapses everything after the sixth chip into `+N`', () => {
    const recipients = Array.from({ length: 9 }, (_, index) => user(`员工${index}`, '安环部'));

    render(<ReminderRecipients recipients={recipients} />);

    const chips = screen.getAllByTestId('chip');
    expect(chips).toHaveLength(7);
    expect(chips.at(-1)?.textContent).toBe('+3');
    expect(chips[5]).toHaveTextContent('@员工5 · 安环部');
  });

  it('honours a custom chip limit', () => {
    const recipients = Array.from({ length: 4 }, (_, index) => user(`员工${index}`));

    render(<ReminderRecipients max={2} recipients={recipients} />);

    const chips = screen.getAllByTestId('chip');
    expect(chips).toHaveLength(3);
    expect(chips.at(-1)?.textContent).toBe('+2');
  });

  it('renders nothing without recipients', () => {
    const { container } = render(<ReminderRecipients recipients={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
