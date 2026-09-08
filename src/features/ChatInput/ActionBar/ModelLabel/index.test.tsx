/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import chatCopy from '@/locales/default/chat';

import ModelLabel from './index';

const mocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  displayName: undefined as string | undefined,
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

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    getEnabledModelById: () => () =>
      mocks.displayName ? { displayName: mocks.displayName } : undefined,
  },
  useAiInfraStore: (selector: (state: unknown) => unknown) => selector({}),
}));

// The panel owns portals and the whole provider list; here only "is the label wrapped in a
// switcher at all, and with which model" matters.
vi.mock('@/features/ModelSwitchPanel', () => ({
  default: ({ children, model }: { children?: ReactNode; model?: string }) => (
    <div data-model={model} data-testid="model-switch-panel">
      {children}
    </div>
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

/** The managed label's focusable wrapper — the element a keyboard user lands on. */
const managedTrigger = () => screen.getByRole('button');

describe('ModelLabel', () => {
  beforeEach(() => {
    mocks.agentId = 'agent-1';
    mocks.displayName = undefined;
    mocks.isPlatformManaged = false;
    mocks.model = 'gpt-5.5';
    mocks.permission = { allowed: true, reason: undefined };
    mocks.updateAgentConfigById.mockClear();
  });

  describe('unmanaged agent', () => {
    it('wraps the label in the switch panel and keeps the chevron', () => {
      mocks.displayName = 'GPT-5.5';

      const { container } = render(<ModelLabel />);

      const panel = screen.getByTestId('model-switch-panel');
      expect(panel).toHaveAttribute('data-model', 'gpt-5.5');
      expect(screen.getByText('GPT-5.5')).toBeInTheDocument();
      expect(container.querySelector('svg')).not.toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      expect(container.querySelector('[aria-disabled]')).toBeNull();
      expect(container.querySelector('[tabindex]')).toBeNull();
    });
  });

  describe('platform-managed agent', () => {
    beforeEach(() => {
      mocks.isPlatformManaged = true;
    });

    it('drops the switch panel and the chevron, keeping the model name', () => {
      mocks.displayName = 'GPT-5.5';

      const { container } = render(<ModelLabel />);

      expect(screen.queryByTestId('model-switch-panel')).toBeNull();
      expect(screen.getByText('GPT-5.5')).toBeInTheDocument();
      expect(container.querySelector('svg')).toBeNull();
    });

    it('falls back to the raw model id when no display name is known', () => {
      mocks.model = 'claude-opus-4.5';

      render(<ModelLabel />);

      expect(screen.getByText('claude-opus-4.5')).toBeInTheDocument();
    });

    it('explains who owns the model through the chat namespace', () => {
      render(<ModelLabel />);

      expect(screen.getByTestId('tooltip')).toHaveAttribute(
        'data-title',
        chatCopy['modelSwitch.managedByAdmin'],
      );
      expect(chatCopy['modelSwitch.managedByAdmin']).not.toBe('modelSwitch.managedByAdmin');
    });

    it('marks the label as disabled for assistive technology and never writes the config', () => {
      render(<ModelLabel />);

      expect(managedTrigger()).toHaveAttribute('aria-disabled', 'true');
      expect(mocks.updateAgentConfigById).not.toHaveBeenCalled();
    });
  });

  describe('permission denial', () => {
    it('keeps the denial reason and drops the panel, managed or not', () => {
      mocks.isPlatformManaged = true;
      mocks.permission = { allowed: false, reason: 'Your role cannot create content' };

      render(<ModelLabel />);

      expect(screen.queryByTestId('model-switch-panel')).toBeNull();
      expect(screen.getByTestId('tooltip')).toHaveAttribute(
        'data-title',
        'Your role cannot create content',
      );
    });
  });
});
