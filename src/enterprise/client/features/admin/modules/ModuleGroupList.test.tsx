import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ALL_MODULES_ENABLED,
  type PlatformModuleId,
  type PlatformModuleStateMap,
  resolveModuleTree,
} from '@/const/platform/modules';

import { moduleChildren } from './moduleDraft';
import ModuleGroupList from './ModuleGroupList';

/** base-ui's Switch needs a ConfigProvider no admin page mounts; the tree is what is under test. */
vi.mock('@lobehub/ui/base-ui', () => ({
  Switch: ({
    checked,
    disabled,
    onChange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onChange?: (next: boolean) => void;
  }) => (
    <button
      aria-checked={Boolean(checked)}
      disabled={disabled}
      role="switch"
      type="button"
      onClick={() => onChange?.(!checked)}
    />
  ),
}));

/** Render tooltip bodies inline, next to what they explain, so they are assertable per row. */
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Tooltip: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <span>
      {children}
      {title ? <span data-testid="tooltip">{title}</span> : null}
    </span>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const entries = Object.entries(options ?? {}).filter(([name]) => name !== 'defaultValue');
      if (entries.length === 0) return key;
      return `${key}(${entries.map(([name, value]) => `${name}=${String(value)}`).join(',')})`;
    },
  }),
}));

const withOff = (...ids: PlatformModuleId[]): PlatformModuleStateMap =>
  Object.freeze({
    ...ALL_MODULES_ENABLED,
    ...Object.fromEntries(ids.map((id) => [id, false])),
  }) as PlatformModuleStateMap;

const renderList = (
  draft: PlatformModuleStateMap = ALL_MODULES_ENABLED,
  overrides: {
    envDisabledBy?: Partial<Record<PlatformModuleId, string>>;
    onToggle?: (id: PlatformModuleId, next: boolean) => void;
    readOnly?: boolean;
  } = {},
) =>
  render(
    <ModuleGroupList
      draft={draft}
      effective={resolveModuleTree(draft)}
      envDisabledBy={overrides.envDisabledBy ?? {}}
      pendingRestart={[]}
      readOnly={overrides.readOnly ?? false}
      onToggle={overrides.onToggle ?? (() => {})}
    />,
  );

const row = (id: string) => document.querySelector(`[data-module="${id}"]`) as HTMLElement | null;
const moduleSwitch = (id: string) => row(id)!.querySelector('[role="switch"]') as HTMLElement;
const subtree = (id: string) => document.querySelector(`[data-children-of="${id}"]`);
const DINGTALK_CHILDREN = moduleChildren('dingtalk');

describe('ModuleGroupList layout', () => {
  it('renders the three groups in order: platform, integrations, application features', () => {
    renderList();

    const groups = [...document.querySelectorAll('[data-module-group]')].map((node) =>
      node.getAttribute('data-module-group'),
    );
    expect(groups).toEqual(['platform', 'integration', 'app']);
    expect(screen.getByText('modules.groups.platform')).toBeTruthy();
    expect(screen.getByText('modules.groups.integration')).toBeTruthy();
    expect(screen.getByText('modules.groups.app')).toBeTruthy();
  });

  it('nests every DingTalk capability under 钉钉 in the integrations card', () => {
    renderList();

    const integration = document.querySelector('[data-module-group="integration"]')!;
    expect(integration.querySelector('[data-module="dingtalk"]')).toBeTruthy();

    const children = subtree('dingtalk')!;
    expect(children).toBeTruthy();
    expect(integration.contains(children)).toBe(true);
    for (const id of DINGTALK_CHILDREN) {
      expect(children.querySelector(`[data-module="${id}"]`)).toBeTruthy();
    }
    // The subtree holds only children, never another top-level module.
    expect(children.querySelector('[data-module="bots"]')).toBeNull();
    expect(children.querySelector('[data-module="dingtalk"]')).toBeNull();
  });

  it('collapses and re-expands a subtree from the parent row', () => {
    renderList();

    const toggle = screen.getByRole('button', {
      name: new RegExp(`modules\\.children\\(n=${DINGTALK_CHILDREN.length}\\)`),
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(subtree('dingtalk')!.id);

    fireEvent.click(toggle);
    expect(subtree('dingtalk')).toBeNull();
    expect(row('dingtalkChat')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The parent itself stays.
    expect(row('dingtalk')).toBeTruthy();

    fireEvent.click(toggle);
    expect(row('dingtalkChat')).toBeTruthy();
  });

  it('puts 全部展开 / 全部收起 only on the card that has subtrees to fold', () => {
    renderList();

    const control = { name: /modules\.(expandAll|collapseAll)/ };
    const section = (group: string) =>
      document.querySelector(`[data-module-group="${group}"]`) as HTMLElement;

    // 钉钉 lives in 集成, so that is the only card with something to fold.
    expect(within(section('integration')).getByRole('button', control)).toBeTruthy();
    expect(within(section('platform')).queryByRole('button', control)).toBeNull();
    expect(within(section('app')).queryByRole('button', control)).toBeNull();
  });

  it('collapses and expands every subtree at once', () => {
    renderList();

    fireEvent.click(screen.getByRole('button', { name: 'modules.collapseAll' }));
    expect(document.querySelectorAll('[data-children-of]')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'modules.expandAll' }));
    expect(subtree('dingtalk')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'modules.collapseAll' })).toBeTruthy();
  });
});

describe('ModuleGroupList tree state', () => {
  it('greys every child while the parent is off, keeping each own choice', () => {
    // Only 钉钉 is off in the draft; one child had already been switched off by hand.
    const draft = withOff('dingtalk', 'dingtalkDocs');
    renderList(draft);

    for (const id of DINGTALK_CHILDREN) {
      expect(row(id)!.getAttribute('data-blocked')).toBe('true');
      expect(moduleSwitch(id).getAttribute('disabled')).not.toBeNull();
      // Own choice shown as it is stored — not forced to "off" by the parent.
      expect(moduleSwitch(id).getAttribute('aria-checked')).toBe(String(draft[id]));
    }
    expect(moduleSwitch('dingtalkChat').getAttribute('aria-checked')).toBe('true');
    expect(moduleSwitch('dingtalkDocs').getAttribute('aria-checked')).toBe('false');

    // The parent is an ordinary switch the operator can turn back on.
    expect(row('dingtalk')!.getAttribute('data-blocked')).toBe('false');
    expect(moduleSwitch('dingtalk').getAttribute('disabled')).toBeNull();
  });

  it('names the parent in the tooltip of a blocked child', () => {
    renderList(withOff('dingtalk'));

    expect(row('dingtalkChat')!.querySelector('[data-testid="tooltip"]')!.textContent).toBe(
      'modules.blockedBy(modules=modules.quoted(name=modules.items.dingtalk.title))',
    );
    // Its dependency (工作通知与提醒) is still on by its own switch, so 钉钉 is the one fix.
    expect(row('dingtalkWorkspace')!.querySelector('[data-testid="tooltip"]')!.textContent).toBe(
      'modules.blockedBy(modules=modules.quoted(name=modules.items.dingtalk.title))',
    );
  });

  it('blocks a child on a hard dependency that is off, and only the dependants', () => {
    renderList(withOff('dingtalkNotify'));

    for (const id of ['dingtalkWorkspace', 'dingtalkApproval']) {
      expect(moduleSwitch(id).getAttribute('disabled')).not.toBeNull();
      expect(row(id)!.querySelector('[data-testid="tooltip"]')!.textContent).toBe(
        'modules.blockedBy(modules=modules.quoted(name=modules.items.dingtalkNotify.title))',
      );
    }
    // Siblings that do not need the notification app stay free.
    expect(moduleSwitch('dingtalkChat').getAttribute('disabled')).toBeNull();
    expect(moduleSwitch('dingtalkPersonal').getAttribute('disabled')).toBeNull();
  });

  it('says so when the blocking parent is pinned off by the environment', () => {
    renderList(withOff('dingtalk'), { envDisabledBy: { dingtalk: 'LOBE_MODULES_DISABLED' } });

    // The parent explains its own lock…
    expect(row('dingtalk')!.querySelector('[data-testid="tooltip"]')!.textContent).toBe(
      'modules.envTooltip(variable=LOBE_MODULES_DISABLED)',
    );
    // …and its children point at the variable, not at a switch this page cannot move.
    for (const id of ['dingtalkChat', 'dingtalkWorkspace']) {
      expect(row(id)!.querySelector('[data-testid="tooltip"]')!.textContent).toBe(
        'modules.blockedByEnv(module=modules.quoted(name=modules.items.dingtalk.title),variable=LOBE_MODULES_DISABLED)',
      );
    }
  });

  it('says so when a blocking dependency is pinned off by the environment', () => {
    renderList(withOff('dingtalkNotify'), {
      envDisabledBy: { dingtalkNotify: 'LOBE_MODULES_DISABLED' },
    });

    expect(row('dingtalkApproval')!.querySelector('[data-testid="tooltip"]')!.textContent).toBe(
      'modules.blockedByEnv(module=modules.quoted(name=modules.items.dingtalkNotify.title),variable=LOBE_MODULES_DISABLED)',
    );
    expect(row('dingtalkChat')!.querySelector('[data-testid="tooltip"]')).toBeNull();
  });

  it('hands a child toggle to the page as that child only', () => {
    const onToggle = vi.fn();
    renderList(ALL_MODULES_ENABLED, { onToggle });

    fireEvent.click(moduleSwitch('dingtalkDocs'));
    expect(onToggle).toHaveBeenCalledWith('dingtalkDocs', false);
  });

  it('locks every switch for a read-only admin, tree or not', () => {
    renderList(ALL_MODULES_ENABLED, { readOnly: true });

    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(DINGTALK_CHILDREN.length);
    expect(switches.every((node) => node.getAttribute('disabled') !== null)).toBe(true);
  });
});
