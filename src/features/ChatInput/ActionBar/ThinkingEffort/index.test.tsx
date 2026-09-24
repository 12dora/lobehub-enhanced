/**
 * @vitest-environment happy-dom
 */
import type { EffortLevel } from '@lobechat/model-runtime';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import settingCopy from '@/locales/default/setting';

import ThinkingEffort from './index';

/** Shape of the menu items the component hands to `ActionDropdown`. */
interface MenuItemProbe {
  closeOnClick?: boolean;
  key: string;
  label?: ReactNode;
  onClick: () => void;
}

/**
 * The copy a level must render as. Read from the same source the component translates
 * through, so losing the `setting` namespace shows up as "raw key vs real copy".
 */
const label = (level: EffortLevel) => settingCopy[`serviceModel.reasoningEffort.options.${level}`];

const mocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  chatConfigByAgent: {} as Record<string, Record<string, unknown>>,
  effortSettings: undefined as { defaultEffortLevel?: string; effortLevels?: string[] } | undefined,
  extendParams: undefined as string[] | undefined,
  locale: 'en' as 'en' | 'zh',
  menuItems: [] as { closeOnClick?: boolean; key: string; label?: unknown; onClick: () => void }[],
  model: 'gpt-5.5',
  permission: { allowed: true, reason: undefined as string | undefined },
  provider: 'openai',
  updateAgentChatConfig: vi.fn(),
}));

/**
 * A miniature i18next over the REAL default dictionaries: it honours the requested
 * namespace and interpolates `{{vars}}`, falling back to the raw key on a miss. Echoing
 * keys back instead would have passed even if this component asked the wrong namespace or
 * dropped the tooltip interpolation, which is exactly what regressed here before.
 */
vi.mock('react-i18next', async () => {
  const chat = (await import('@/locales/default/chat')).default as Record<string, string>;
  const setting = (await import('@/locales/default/setting')).default as Record<string, string>;
  // What users actually see (zh-CN), for the Chinese assertions.
  const zhChat = await import('../../../../../locales/zh-CN/chat.json');
  const zhSetting = await import('../../../../../locales/zh-CN/setting.json');
  const byLocale: Record<'en' | 'zh', Record<string, Record<string, string> | undefined>> = {
    en: { chat, setting },
    zh: {
      chat: zhChat.default as Record<string, string>,
      setting: zhSetting.default as Record<string, string>,
    },
  };

  return {
    useTranslation: (ns?: string | string[]) => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const dictionaries = byLocale[mocks.locale];
        const namespaces = options?.ns ? [options.ns as string] : ([] as string[]).concat(ns ?? []);
        const template = namespaces.map((name) => dictionaries[name]?.[key]).find(Boolean);
        if (!template) return key;

        return template.replaceAll(/\{\{(\w+)\}\}/g, (_match, name: string) =>
          String(options?.[name] ?? ''),
        );
      },
    }),
  };
});

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => mocks.permission,
}));

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => mocks.agentId }));

vi.mock('../../hooks/useUpdateAgentConfig', () => ({
  useUpdateAgentConfig: () => ({ updateAgentChatConfig: mocks.updateAgentChatConfig }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentModelById: () => () => mocks.model,
    getAgentModelProviderById: () => () => mocks.provider,
  },
  chatConfigByIdSelectors: {
    // Keyed by agentId so an agent switch is observable through the pill.
    getChatConfigById: (agentId: string) => () => mocks.chatConfigByAgent[agentId] ?? {},
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    modelEffortSettings: () => () => mocks.effortSettings,
    modelExtendParams: () => () => mocks.extendParams,
  },
  useAiInfraStore: (selector: (state: unknown) => unknown) => selector({}),
}));

// Base UI + portals are out of scope here; capture the menu the component builds
// so the selection contract can be exercised directly.
vi.mock('../components/ActionDropdown', () => ({
  default: ({ children, menu }: { children?: ReactNode; menu?: { items?: unknown } }) => {
    mocks.menuItems = (menu?.items ?? []) as MenuItemProbe[];

    return <div data-testid="effort-dropdown">{children}</div>;
  },
}));

// The real Tooltip only paints its title on hover; render it inline so both the
// level tooltip and the permission-denial reason are assertable.
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

const menuItem = (level: string) => {
  const item = mocks.menuItems.find((entry) => entry.key === level);
  if (!item) throw new Error(`no menu item for level "${level}"`);

  return item;
};

describe('ThinkingEffort', () => {
  beforeEach(() => {
    mocks.agentId = 'agent-1';
    mocks.chatConfigByAgent = {};
    mocks.effortSettings = undefined;
    mocks.extendParams = undefined;
    mocks.locale = 'en';
    mocks.menuItems = [];
    mocks.model = 'gpt-5.5';
    mocks.permission = { allowed: true, reason: undefined };
    mocks.updateAgentChatConfig.mockClear();
  });

  describe('visibility', () => {
    it('renders nothing when the model declares no extend params', () => {
      const { container } = render(<ThinkingEffort />);

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when no declared extend param is an effort control', () => {
      mocks.extendParams = ['disableContextCaching', 'reasoningBudgetToken', 'urlContext'];

      const { container } = render(<ThinkingEffort />);

      expect(container).toBeEmptyDOMElement();
    });

    it('renders the model-specific default level when nothing is persisted', () => {
      mocks.extendParams = ['gpt5_2ReasoningEffort'];

      render(<ThinkingEffort />);

      expect(screen.getByText(label('medium'))).toBeInTheDocument();
    });

    it('renders the persisted level', () => {
      mocks.extendParams = ['gpt5_2ReasoningEffort'];
      mocks.chatConfigByAgent = { 'agent-1': { gpt5_2ReasoningEffort: 'xhigh' } };

      render(<ThinkingEffort />);

      expect(screen.getByText(label('xhigh'))).toBeInTheDocument();
    });

    it('prefers a real effort key over the tri-state thinking toggle', () => {
      mocks.extendParams = ['thinking', 'reasoningEffort'];

      render(<ThinkingEffort />);

      expect(screen.getByText(label('medium'))).toBeInTheDocument();
    });

    it('names the level through the shared setting namespace, never the raw level', () => {
      mocks.extendParams = ['gpt5_2ReasoningEffort'];
      mocks.chatConfigByAgent = { 'agent-1': { gpt5_2ReasoningEffort: 'xhigh' } };

      render(<ThinkingEffort />);

      expect(screen.queryByText('xhigh')).toBeNull();
    });

    it('renders the real localized copy, not a key and not the raw level', () => {
      mocks.extendParams = ['gpt5_2ReasoningEffort'];
      mocks.chatConfigByAgent = { 'agent-1': { gpt5_2ReasoningEffort: 'low' } };

      render(<ThinkingEffort />);

      expect(screen.getByText('Low')).toBeInTheDocument();
      expect(screen.queryByText('low')).toBeNull();
      expect(screen.queryByText(/serviceModel\./)).toBeNull();
    });

    it('renders a text-only trigger with no icon', () => {
      mocks.extendParams = ['reasoningEffort'];

      const { container } = render(<ThinkingEffort />);

      expect(container.querySelector('svg')).toBeNull();
    });
  });

  describe('selection', () => {
    it('offers every level the control declares, in registry order', () => {
      mocks.extendParams = ['gpt5_2ReasoningEffort'];

      render(<ThinkingEffort />);

      expect(mocks.menuItems.map((item) => item.key)).toEqual([
        'none',
        'low',
        'medium',
        'high',
        'xhigh',
      ]);
      expect(mocks.menuItems.every((item) => item.closeOnClick === true)).toBe(true);
    });

    it('labels every menu entry with the shared level key, keeping the raw level as the item key', () => {
      mocks.extendParams = ['gpt5_2ReasoningEffort'];

      render(<ThinkingEffort />);

      const rendered = mocks.menuItems.map((item) => {
        const { container } = render(<>{item.label as ReactNode}</>);
        return container.textContent;
      });

      expect(rendered).toEqual([
        label('none'),
        label('low'),
        label('medium'),
        label('high'),
        label('xhigh'),
      ]);
    });

    it('writes exactly the chosen level to the control config key', () => {
      mocks.extendParams = ['gpt5_2ReasoningEffort'];
      mocks.chatConfigByAgent = { 'agent-1': { gpt5_2ReasoningEffort: 'low' } };

      render(<ThinkingEffort />);
      menuItem('xhigh').onClick();

      expect(mocks.updateAgentChatConfig).toHaveBeenCalledTimes(1);
      expect(mocks.updateAgentChatConfig).toHaveBeenCalledWith({ gpt5_2ReasoningEffort: 'xhigh' });
    });

    it('writes to the key the model actually declares, not a sibling family key', () => {
      mocks.extendParams = ['grok4_3ReasoningEffort'];
      mocks.model = 'grok-4.3';

      render(<ThinkingEffort />);
      menuItem('high').onClick();

      expect(mocks.updateAgentChatConfig).toHaveBeenCalledWith({ grok4_3ReasoningEffort: 'high' });
    });

    it('does not write when the already-selected level is picked again', () => {
      mocks.extendParams = ['reasoningEffort'];
      mocks.chatConfigByAgent = { 'agent-1': { reasoningEffort: 'high' } };

      render(<ThinkingEffort />);
      menuItem('high').onClick();

      expect(mocks.updateAgentChatConfig).not.toHaveBeenCalled();
    });
  });

  describe('permission', () => {
    it('renders a tooltip with the level when content creation is allowed', () => {
      mocks.extendParams = ['reasoningEffort'];
      mocks.chatConfigByAgent = { 'agent-1': { reasoningEffort: 'low' } };

      render(<ThinkingEffort />);

      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-title', 'Thinking effort: Low');
    });

    it('drops the dropdown and shows the denial reason when create_content is denied', () => {
      mocks.extendParams = ['reasoningEffort'];
      mocks.permission = { allowed: false, reason: 'Your role cannot create content' };

      render(<ThinkingEffort />);

      expect(screen.queryByTestId('effort-dropdown')).toBeNull();
      expect(screen.getByTestId('tooltip')).toHaveAttribute(
        'data-title',
        'Your role cannot create content',
      );
      // The level is still readable, it just cannot be changed.
      expect(screen.getByText(label('medium'))).toBeInTheDocument();
    });
  });

  describe('per-model narrowing (collapsed Cursor card)', () => {
    const narrowCursorCard = () => {
      mocks.extendParams = ['cursorReasoningEffort'];
      mocks.model = 'grok-4.7';
      mocks.provider = 'cursor';
      mocks.effortSettings = {
        defaultEffortLevel: 'high',
        effortLevels: ['low', 'medium', 'high', 'xhigh'],
      };
    };

    afterEach(() => {
      mocks.provider = 'openai';
    });

    it('offers only the card levels and shows the card default', () => {
      narrowCursorCard();

      render(<ThinkingEffort />);

      expect(mocks.menuItems.map((item) => item.key)).toEqual(['low', 'medium', 'high', 'xhigh']);
      expect(screen.getByText(label('high'))).toBeInTheDocument();
    });

    it('shows 高 by default in Chinese', () => {
      narrowCursorCard();
      mocks.locale = 'zh';

      render(<ThinkingEffort />);

      expect(mocks.menuItems).toHaveLength(4);
      expect(screen.getByText('高')).toBeInTheDocument();
      expect(screen.getByTestId('tooltip')).toHaveAttribute('data-title', '思考强度：高');
    });

    it('shows a stored level the card lacks as the nearest offered level', () => {
      narrowCursorCard();
      mocks.chatConfigByAgent = { 'agent-1': { cursorReasoningEffort: 'max' } };

      render(<ThinkingEffort />);

      expect(screen.getByText(label('xhigh'))).toBeInTheDocument();
      expect(screen.queryByText(label('max'))).toBeNull();
    });

    it('still writes exactly the picked level to the control config key', () => {
      narrowCursorCard();

      render(<ThinkingEffort />);
      menuItem('low').onClick();

      expect(mocks.updateAgentChatConfig).toHaveBeenCalledWith({ cursorReasoningEffort: 'low' });
    });

    it('treats re-picking the shown nearest level as a no-op', () => {
      narrowCursorCard();
      mocks.chatConfigByAgent = { 'agent-1': { cursorReasoningEffort: 'max' } };

      render(<ThinkingEffort />);
      // `xhigh` is what the pill shows, so re-picking it is a no-op like any selected level.
      menuItem('xhigh').onClick();

      expect(mocks.updateAgentChatConfig).not.toHaveBeenCalled();
    });

    it('offers every registry level when the card does not narrow the control', () => {
      mocks.extendParams = ['cursorReasoningEffort'];
      mocks.model = 'grok-4.7';

      render(<ThinkingEffort />);

      expect(mocks.menuItems.map((item) => item.key)).toEqual([
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]);
      expect(screen.getByText(label('high'))).toBeInTheDocument();
    });

    it('narrows any effort control, not only the Cursor one', () => {
      mocks.extendParams = ['gpt5_2ReasoningEffort'];
      mocks.effortSettings = { effortLevels: ['low', 'high'] };

      render(<ThinkingEffort />);

      expect(mocks.menuItems.map((item) => item.key)).toEqual(['low', 'high']);
      // gpt-5.5 defaults to `medium`, which this card lacks: the tie resolves stronger.
      expect(screen.getByText(label('high'))).toBeInTheDocument();
    });
  });

  it('reflects the new agent after an agent switch', () => {
    mocks.extendParams = ['reasoningEffort'];
    mocks.chatConfigByAgent = {
      'agent-1': { reasoningEffort: 'low' },
      'agent-2': { reasoningEffort: 'high' },
    };

    // The component is `memo`'d with no props, so a plain rerender would bail out —
    // in the app the agentId change arrives through a store subscription. Keying the
    // element reproduces the same "new agent is active" observation.
    const { rerender } = render(<ThinkingEffort key={mocks.agentId} />);

    expect(screen.getByText(label('low'))).toBeInTheDocument();

    mocks.agentId = 'agent-2';
    rerender(<ThinkingEffort key={mocks.agentId} />);

    expect(screen.getByText(label('high'))).toBeInTheDocument();
    expect(screen.queryByText(label('low'))).toBeNull();
  });
});
