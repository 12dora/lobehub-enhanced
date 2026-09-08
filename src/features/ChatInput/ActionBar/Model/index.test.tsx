/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import chatCopy from '@/locales/default/chat';

import ModelSwitch from './index';

const mocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  isPlatformManaged: false,
  model: 'gpt-5.5',
  permission: { allowed: true, reason: undefined as string | undefined },
  provider: 'openai',
  updateAgentConfigById: vi.fn(),
}));

/**
 * A miniature i18next over the REAL default dictionary, so a missing key or the wrong
 * namespace shows up as "raw key vs real copy" instead of silently passing.
 */
vi.mock('react-i18next', async () => {
  const chat = (await import('@/locales/default/chat')).default as Record<string, string>;
  const dictionaries: Record<string, Record<string, string> | undefined> = { chat };

  return {
    useTranslation: (ns?: string | string[]) => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const namespaces = options?.ns ? [options.ns as string] : ([] as string[]).concat(ns ?? []);

        return namespaces.map((name) => dictionaries[name]?.[key]).find(Boolean) ?? key;
      },
    }),
  };
});

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => mocks.permission,
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => mocks.agentId }));

vi.mock('@/business/client/hooks/useBusinessAgentMode', () => ({
  useBusinessModelModeConfig: () => (params: unknown) => params,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ updateAgentConfigById: mocks.updateAgentConfigById }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentModelById: () => () => mocks.model,
    getAgentModelProviderById: () => () => mocks.provider,
    isAgentPlatformManagedById: () => () => mocks.isPlatformManaged,
  },
}));

// The panel owns portals and the whole provider list; here only "is the pill wrapped in a
// switcher at all, and with which model" matters.
vi.mock('@/features/ModelSwitchPanel', () => ({
  default: ({ children, model }: { children?: ReactNode; model?: string }) => (
    <div data-model={model} data-testid="model-switch-panel">
      {children}
    </div>
  ),
}));

vi.mock('@lobehub/icons', () => ({
  ModelIcon: ({ model, size }: { model?: string; size?: number }) => (
    <svg data-model={model} data-size={size} data-testid="model-icon" />
  ),
}));

// The real Tooltip only paints its title on hover; render it inline so the managed copy
// and the permission-denial reason are both assertable.
vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    Tooltip: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
      <div data-testid="tooltip" data-title={String(title)}>
        {children}
      </div>
    ),
  };
});

/** The managed pill's focusable wrapper — the element a keyboard user lands on. */
const managedTrigger = () => screen.getByRole('button');

describe('ModelSwitch', () => {
  beforeEach(() => {
    mocks.agentId = 'agent-1';
    mocks.isPlatformManaged = false;
    mocks.model = 'gpt-5.5';
    mocks.permission = { allowed: true, reason: undefined };
    mocks.updateAgentConfigById.mockClear();
  });

  describe('unmanaged agent', () => {
    it('wraps the pill in the switch panel for the active model', () => {
      render(<ModelSwitch />);

      const panel = screen.getByTestId('model-switch-panel');
      expect(panel).toHaveAttribute('data-model', 'gpt-5.5');
      expect(panel).toContainElement(screen.getByTestId('model-icon'));
    });

    it('adds no managed tooltip, no aria-disabled and no extra tab stop', () => {
      render(<ModelSwitch />);

      expect(screen.queryByTestId('tooltip')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      expect(document.querySelector('[aria-disabled]')).toBeNull();
      expect(document.querySelector('[tabindex]')).toBeNull();
    });
  });

  describe('platform-managed agent', () => {
    beforeEach(() => {
      mocks.isPlatformManaged = true;
    });

    it('drops the switch panel so the model cannot be changed', () => {
      render(<ModelSwitch />);

      expect(screen.queryByTestId('model-switch-panel')).toBeNull();
    });

    it('still renders the model icon for the admin-set model', () => {
      mocks.model = 'claude-opus-4.5';

      render(<ModelSwitch />);

      expect(screen.getByTestId('model-icon')).toHaveAttribute('data-model', 'claude-opus-4.5');
    });

    it('explains who owns the model through the chat namespace', () => {
      render(<ModelSwitch />);

      expect(screen.getByTestId('tooltip')).toHaveAttribute(
        'data-title',
        chatCopy['modelSwitch.managedByAdmin'],
      );
      expect(chatCopy['modelSwitch.managedByAdmin']).not.toBe('modelSwitch.managedByAdmin');
    });

    it('marks the pill as disabled for assistive technology', () => {
      render(<ModelSwitch />);

      expect(managedTrigger()).toHaveAttribute('aria-disabled', 'true');
    });

    it('never writes the agent config', () => {
      render(<ModelSwitch />);

      expect(mocks.updateAgentConfigById).not.toHaveBeenCalled();
    });
  });

  /**
   * Sibling invariant to ModelLabel's: the managed state may drop affordances but must
   * never change the pill's metrics, or the action bar re-flows the moment the agent's
   * config resolves and marks it managed.
   */
  describe('stable box across the managed flag', () => {
    it('keeps the same pill metrics when the flag flips', () => {
      mocks.isPlatformManaged = false;

      // `ModelSwitch` is memoised and takes no props, so a `rerender` would bail out —
      // the flag has to be flipped across two mounts to be observed at all.
      const unmanaged = render(<ModelSwitch />);

      const unmanagedPill = screen.getByTestId('model-icon').parentElement!.parentElement!;
      const unmanagedStyle = unmanagedPill.getAttribute('style');
      const unmanagedTag = unmanagedPill.tagName;

      unmanaged.unmount();
      mocks.isPlatformManaged = true;
      render(<ModelSwitch />);

      const managedPill = screen.getByTestId('model-icon').parentElement!.parentElement!;

      expect(managedPill.tagName).toBe(unmanagedTag);
      expect(managedPill.getAttribute('style')).toBe(unmanagedStyle);
    });
  });

  describe('permission denial', () => {
    it('keeps the denial reason and drops the panel, managed or not', () => {
      mocks.isPlatformManaged = true;
      mocks.permission = { allowed: false, reason: 'Your role cannot create content' };

      render(<ModelSwitch />);

      expect(screen.queryByTestId('model-switch-panel')).toBeNull();
      expect(screen.getByTestId('tooltip')).toHaveAttribute(
        'data-title',
        'Your role cannot create content',
      );
    });
  });
});
