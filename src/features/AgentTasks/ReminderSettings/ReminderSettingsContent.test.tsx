/**
 * @vitest-environment happy-dom
 */
import { DEFAULT_SETTINGS } from '@lobechat/config';
import type { NotificationSettings } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ReminderSettingsContent from './ReminderSettingsContent';

const mocks = vi.hoisted(() => ({
  dingtalkAvailable: true,
  setSettings: vi.fn(),
  settings: {} as { notification?: NotificationSettings },
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('./useDingTalkPushAvailable', () => ({
  useDingTalkPushAvailable: () => ({ available: mocks.dingtalkAvailable, isLoading: false }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({
      defaultSettings: DEFAULT_SETTINGS,
      setSettings: mocks.setSettings,
      settings: mocks.settings,
    }),
}));

/** Only `toast` needs to be observable; the layout primitives are plain wrappers. */
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  toast: mocks.toast,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, disabled, loading, onClick }: any) => (
    <button disabled={disabled || loading} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Switch: ({ checked, disabled, onChange, 'aria-label': label }: any) => (
    <button
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      role="switch"
      type="button"
      onClick={() => onChange?.(!checked)}
    />
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  useModalContext: () => ({ close: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const switchFor = (label: string) => screen.getByRole('switch', { name: label });
const checkedOf = (label: string) => switchFor(label).getAttribute('aria-checked');

beforeEach(() => {
  mocks.dingtalkAvailable = true;
  mocks.settings = {};
  mocks.setSettings.mockReset();
  mocks.setSettings.mockResolvedValue(undefined);
  mocks.toast.error.mockReset();
  mocks.toast.success.mockReset();
});

describe('ReminderSettingsContent', () => {
  it('renders both channels and the full event matrix from the all-on defaults', () => {
    render(<ReminderSettingsContent />);

    expect(checkedOf('task.reminder.channel.inbox')).toBe('true');
    expect(checkedOf('task.reminder.channel.dingtalk')).toBe('true');
    // 4 event rows x 2 channels + 2 channel switches
    expect(screen.getAllByRole('switch')).toHaveLength(10);
  });

  it('reflects a stored opt-out instead of the default', () => {
    mocks.settings = {
      notification: { inbox: { items: { task: { task_run_failed: false } } } },
    };

    render(<ReminderSettingsContent />);

    expect(checkedOf('task.reminder.channel.inbox task.event.task_run_failed')).toBe('false');
    expect(checkedOf('task.reminder.channel.inbox task.event.task_run_completed')).toBe('true');
  });

  it('keeps the draft local until save, then writes the merged settings', async () => {
    mocks.settings = {
      notification: { inbox: { items: { generation: { image_generation_completed: false } } } },
    };

    render(<ReminderSettingsContent />);

    fireEvent.click(switchFor('task.reminder.channel.inbox task.event.task_completed'));
    fireEvent.click(switchFor('task.reminder.channel.dingtalk'));

    // Nothing persisted while the user is still editing.
    expect(mocks.setSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'task.reminder.save' }));

    await waitFor(() => expect(mocks.setSettings).toHaveBeenCalledTimes(1));
    expect(mocks.setSettings).toHaveBeenCalledWith({
      notification: {
        dingtalk: {
          enabled: false,
          items: {
            task: {
              task_completed: true,
              task_run_completed: true,
              task_run_failed: true,
              task_waiting_for_user: true,
            },
          },
        },
        email: DEFAULT_SETTINGS.notification!.email,
        inbox: {
          enabled: true,
          items: {
            // The unrelated category survives the reminder write.
            generation: {
              image_generation_completed: false,
              video_generation_completed: true,
            },
            task: {
              task_completed: false,
              task_run_completed: true,
              task_run_failed: true,
              task_waiting_for_user: true,
            },
          },
        },
      },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith('task.reminder.saved');
  });

  it('drops a disabled channel out of the event matrix', () => {
    render(<ReminderSettingsContent />);

    fireEvent.click(switchFor('task.reminder.channel.dingtalk'));

    expect(screen.queryByRole('switch', { name: /dingtalk task\.event/ })).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(6);
  });

  it('disables the DingTalk row and explains why when the platform is not provisioned', () => {
    mocks.dingtalkAvailable = false;

    render(<ReminderSettingsContent />);

    expect(switchFor('task.reminder.channel.dingtalk')).toHaveProperty('disabled', true);
    expect(checkedOf('task.reminder.channel.dingtalk')).toBe('false');
    expect(screen.getByText('task.reminder.channel.dingtalkUnavailable')).toBeTruthy();
    // DingTalk contributes no column to the matrix.
    expect(screen.getAllByRole('switch')).toHaveLength(6);
  });

  it('restores the shipped defaults without persisting until save', () => {
    mocks.settings = { notification: { inbox: { enabled: false } } };

    render(<ReminderSettingsContent />);

    expect(checkedOf('task.reminder.channel.inbox')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'task.reminder.reset' }));

    expect(checkedOf('task.reminder.channel.inbox')).toBe('true');
    expect(mocks.setSettings).not.toHaveBeenCalled();
  });

  it('surfaces a failed save instead of closing silently', async () => {
    mocks.setSettings.mockRejectedValue(new Error('offline'));

    render(<ReminderSettingsContent />);
    fireEvent.click(screen.getByRole('button', { name: 'task.reminder.save' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('task.reminder.saveFailed'));
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});
