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
  isModelCatalogReady: true,
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
  aiProviderSelectors: {
    isInitAiProviderRuntimeState: () => mocks.isModelCatalogReady,
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
    mocks.isModelCatalogReady = true;
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

  /**
   * The label lives in the send row of the home composer. Anything that changes its
   * measured width when the managed flag resolves (the inbox agent's config lands, or
   * the composer switches between a managed and a personal agent) slides the send
   * button sideways — the "input flickers when the conversation starts" report.
   */
  describe('stable box across the managed flag', () => {
    const chevronSlot = () => screen.getByTestId('model-label-chevron-slot');
    const shapeOf = (element: Element) =>
      [...element.children].map((child) => child.tagName).join(',');

    it('keeps the chevron slot, and only its content, when the flag flips', () => {
      mocks.displayName = 'GPT-5.5';
      mocks.isPlatformManaged = false;

      // `ModelLabel` is memoised and takes no props, so a `rerender` would bail out —
      // the flag has to be flipped across two mounts to be observed at all.
      const unmanaged = render(<ModelLabel />);
      const unmanagedSlot = chevronSlot();
      const unmanagedRow = unmanagedSlot.parentElement!;
      const unmanagedPill = unmanagedRow.parentElement!;
      const unmanagedSlotClass = unmanagedSlot.className;
      const unmanagedRowShape = shapeOf(unmanagedRow);
      const unmanagedPillStyle = unmanagedPill.getAttribute('style');

      expect(unmanagedSlot.querySelector('svg')).not.toBeNull();

      unmanaged.unmount();
      mocks.isPlatformManaged = true;
      render(<ModelLabel />);

      const managedSlot = chevronSlot();
      const managedRow = managedSlot.parentElement!;
      const managedPill = managedRow.parentElement!;

      // The chevron itself is gone — it promises a menu a managed model has none of…
      expect(managedSlot.querySelector('svg')).toBeNull();
      // …but its box, the row around it and the pill's own metrics are untouched, so
      // nothing in the send row re-flows.
      expect(managedSlot.className).toBe(unmanagedSlotClass);
      expect(shapeOf(managedRow)).toBe(unmanagedRowShape);
      expect(managedPill.getAttribute('style')).toBe(unmanagedPillStyle);
    });

    it('hides the chevron slot from assistive technology in both states', () => {
      mocks.isPlatformManaged = false;
      const unmanaged = render(<ModelLabel />);
      expect(chevronSlot()).toHaveAttribute('aria-hidden');

      unmanaged.unmount();
      mocks.isPlatformManaged = true;
      render(<ModelLabel />);
      expect(chevronSlot()).toHaveAttribute('aria-hidden');
    });
  });

  /**
   * The composer footer normally waits for the model catalogue too
   * (`useComposerFooterLoading`), but that wait is deadline-bounded — so the label still
   * has to behave when it is released before the catalogue lands.
   */
  describe('model catalogue not resolved yet', () => {
    beforeEach(() => {
      mocks.isModelCatalogReady = false;
      mocks.displayName = undefined;
    });

    it('holds a fixed-width placeholder instead of painting the raw model id', () => {
      const { container } = render(<ModelLabel />);

      expect(screen.queryByText('gpt-5.5')).toBeNull();
      expect(container.querySelector('[data-testid="model-label-chevron-slot"]')).not.toBeNull();
    });

    it('still names the managed label after the model for assistive technology', () => {
      mocks.isPlatformManaged = true;

      render(<ModelLabel />);

      expect(managedTrigger()).toHaveAttribute('aria-label', 'gpt-5.5');
    });

    it('falls back to the raw model id once the catalogue says it has no name', () => {
      mocks.isModelCatalogReady = true;

      render(<ModelLabel />);

      expect(screen.getByText('gpt-5.5')).toBeInTheDocument();
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
