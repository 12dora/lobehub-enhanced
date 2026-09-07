/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SkillEnabledSwitch from './index';

const mocks = vi.hoisted(() => ({
  setSkillEnabled: vi.fn(),
  toolState: { disabledSkillIdentifiers: [] as string[] },
}));

vi.mock('@lobehub/ui', () => ({
  stopPropagation: () => {},
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: <T,>(selector: (state: any) => T): T =>
    selector({ ...mocks.toolState, setSkillEnabled: mocks.setSkillEnabled }),
}));

vi.mock('@/store/tool/selectors', () => ({
  builtinToolSelectors: {
    isSkillEnabled:
      (identifier: string) =>
      (state: typeof mocks.toolState): boolean =>
        !state.disabledSkillIdentifiers.includes(identifier),
  },
}));

describe('SkillEnabledSwitch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toolState.disabledSkillIdentifiers = [];
    mocks.setSkillEnabled.mockResolvedValue(undefined);
  });

  it('names the control after the skill so a list of switches is distinguishable', () => {
    render(<SkillEnabledSwitch identifier="my-skill" kind="skill" label="My Skill" />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAccessibleName('My Skill: tools.skillEnabled.on');
  });

  it('falls back to the state label when no skill name is given', () => {
    mocks.toolState.disabledSkillIdentifiers = ['my-skill'];

    render(<SkillEnabledSwitch identifier="my-skill" kind="skill" />);

    expect(screen.getByRole('switch')).toHaveAccessibleName('tools.skillEnabled.off');
  });

  it('writes through the store and reports the new value', async () => {
    const onChange = vi.fn();
    render(<SkillEnabledSwitch identifier="my-skill" kind="skill" onChange={onChange} />);

    await userEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(mocks.setSkillEnabled).toHaveBeenCalledWith({
        enabled: false,
        identifier: 'my-skill',
        kind: 'skill',
      });
    });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('leaves the busy state and stays interactive when the write is rejected', async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error('offline'));
    const onChange = vi.fn();

    render(
      <SkillEnabledSwitch
        checked
        identifier="my-skill"
        kind="skill"
        onChange={onChange}
        onToggle={onToggle}
      />,
    );

    const toggle = screen.getByRole('switch');
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(false);
    });
    // The rejection must not leave the switch spinning, and the controlled
    // value must stay whatever the write owner still holds.
    await waitFor(() => {
      expect(toggle).not.toBeDisabled();
    });
    expect(toggle).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never writes for a mandatory skill', async () => {
    render(<SkillEnabledSwitch mandatory identifier="my-skill" kind="skill" />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();

    await userEvent.click(toggle);
    expect(mocks.setSkillEnabled).not.toHaveBeenCalled();
  });
});
