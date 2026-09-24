import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { PlatformModuleId } from '@/const/platform/modules';

import ModuleRow from './ModuleRow';

/**
 * Real module ids, invented costs: the assertions are about which chips a given cost shape
 * earns, and pinning them to the measured constant table would turn a re-measurement into a
 * failing UI test.
 */
vi.mock('@/const/platform/modules', () => {
  const free = {
    backgroundJobs: 0,
    externalDeps: [] as string[],
    idleRssMb: 0 as number | null,
    loadKind: 'none',
    loadSensitive: false,
    subprocess: false,
  };

  return {
    PLATFORM_MODULES: {
      audit: { cost: { ...free, idleRssMb: null }, kind: 'hot' },
      bots: { cost: { ...free, idleRssMb: 22 }, kind: 'hot' },
      dingtalk: { cost: { ...free }, kind: 'restart' },
      dingtalkChat: { cost: { ...free }, kind: 'hot' },
      dingtalkWorkspace: { cost: { ...free }, kind: 'hot' },
      fileOrphanGc: { cost: { ...free }, kind: 'restart' },
      knowledgeBase: { cost: { ...free, externalDeps: ['s3'] }, kind: 'hot' },
      managedSkills: { cost: { ...free }, kind: 'hot' },
      memory: { cost: { ...free, loadKind: 'perMessage' }, kind: 'hot' },
      platformStats: { cost: { ...free, loadKind: 'onUse' }, kind: 'hot' },
      sandbox: { cost: { ...free }, kind: 'hot' },
    },
  };
});

/** base-ui's Switch needs a ConfigProvider no admin page mounts; the chips are what is under test. */
vi.mock('@lobehub/ui/base-ui', () => ({
  Switch: ({ checked, disabled }: { checked?: boolean; disabled?: boolean }) => (
    <button aria-checked={Boolean(checked)} disabled={disabled} role="switch" type="button" />
  ),
}));

/** Render tooltip bodies inline so the lock reason is assertable without hover timing. */
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

/** Blocks stacked in the row's text column: title, description, and the chip row when it exists. */
const blockCount = (container: HTMLElement) =>
  container.querySelector('[data-module]')!.firstElementChild!.children.length;

const renderRow = (id: string) =>
  render(
    <ModuleRow
      checked
      id={id as PlatformModuleId}
      pendingRestart={false}
      readOnly={false}
      onChange={() => {}}
    />,
  );

describe('ModuleRow cost chips', () => {
  it('renders no load chip for an on-demand module', () => {
    renderRow('platformStats');

    expect(screen.queryByText(/modules\.tags\.loadKind/)).toBeNull();
  });

  it('still renders the load chip for work that happens on every message', () => {
    renderRow('memory');

    expect(screen.getByText('modules.tags.loadKind.perMessage')).toBeTruthy();
  });

  it('hides the memory chip at zero and shows it above zero', () => {
    const { unmount } = renderRow('managedSkills');
    expect(screen.queryByText(/modules\.tags\.idleRss/)).toBeNull();
    unmount();

    renderRow('bots');
    expect(screen.getByText('modules.tags.idleRss(mb=22)')).toBeTruthy();
  });

  it('hides the memory chip when nothing was measured', () => {
    renderRow('audit');

    expect(screen.queryByText(/modules\.tags\.idleRss/)).toBeNull();
  });

  it('renders an external dependency as a requirement, not a bare noun', () => {
    renderRow('knowledgeBase');

    expect(screen.getByText('modules.tags.requires(dep=modules.deps.s3)')).toBeTruthy();
    expect(screen.queryByText('modules.deps.s3')).toBeNull();
  });

  it('drops the chip row entirely when the module costs nothing notable', () => {
    // The wrapper carries its own top margin, so an empty one would pad every free module.
    // Counted against a costed row so the check cannot pass just because the DOM moved.
    const costed = renderRow('bots');
    const withTags = blockCount(costed.container);
    costed.unmount();

    const { container } = renderRow('platformStats');

    expect(screen.queryAllByText(/modules\.tags\./)).toHaveLength(0);
    expect(blockCount(container)).toBe(withTags - 1);
  });
});

describe('ModuleRow tree state', () => {
  it('locks and greys a child whose parent is off, keeps its choice, names the blocker', () => {
    const { container } = render(
      <ModuleRow
        checked
        blockedBy={['dingtalk']}
        id="dingtalkChat"
        pendingRestart={false}
        readOnly={false}
        onChange={() => {}}
      />,
    );

    const toggle = screen.getByRole('switch');
    // Own choice kept (still "on"), but it cannot run and cannot be flipped from here.
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('disabled')).not.toBeNull();
    const row = container.querySelector('[data-module="dingtalkChat"]')!;
    expect(row.getAttribute('data-blocked')).toBe('true');
    // What runs is what the status says — off, whatever the switch shows.
    expect(screen.getByText('modules.status.disabled')).toBeTruthy();
    expect(screen.queryByText('modules.status.running')).toBeNull();
    expect(screen.getByTestId('tooltip').textContent).toBe(
      'modules.blockedBy(modules=modules.quoted(name=modules.items.dingtalk.title))',
    );
  });

  it('runs normally with nothing blocking it', () => {
    const { container } = render(
      <ModuleRow
        checked
        blockedBy={[]}
        id="dingtalkChat"
        pendingRestart={false}
        readOnly={false}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole('switch').getAttribute('disabled')).toBeNull();
    expect(container.querySelector('[data-blocked="true"]')).toBeNull();
    expect(screen.getByText('modules.status.running')).toBeTruthy();
    expect(screen.queryByTestId('tooltip')).toBeNull();
  });

  it('explains an env pin before a blocked parent — only the container can undo it', () => {
    render(
      <ModuleRow
        blockedBy={['dingtalk']}
        checked={false}
        envDisabledBy="LOBE_MODULES_DISABLED"
        id="dingtalkChat"
        pendingRestart={false}
        readOnly={false}
        onChange={() => {}}
      />,
    );

    expect(screen.getByTestId('tooltip').textContent).toBe(
      'modules.envTooltip(variable=LOBE_MODULES_DISABLED)',
    );
  });

  it('gives a parent row an expand control carrying its child count', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ModuleRow
        checked
        expand={{ controls: 'children-dingtalk', count: 6, expanded: true, onToggle }}
        id="dingtalk"
        pendingRestart={false}
        readOnly={false}
        onChange={() => {}}
      />,
    );

    const button = screen.getByRole('button', { name: /modules\.children\(n=6\)/ });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe('children-dingtalk');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <ModuleRow
        checked
        expand={{ controls: 'children-dingtalk', count: 6, expanded: false, onToggle }}
        id="dingtalk"
        pendingRestart={false}
        readOnly={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the restart tag on restart-kind modules', () => {
    renderRow('dingtalk');

    expect(screen.getByText('modules.tags.restart')).toBeTruthy();
  });

  it('points at the env variable when the blocker is pinned off by the environment', () => {
    render(
      <ModuleRow
        checked
        blockedBy={['dingtalk']}
        blockerEnv={{ dingtalk: 'LOBE_MODULES_DISABLED' }}
        id="dingtalkChat"
        pendingRestart={false}
        readOnly={false}
        onChange={() => {}}
      />,
    );

    // "Turn 钉钉 on first" would send the operator to a switch this page cannot move.
    const tooltip = screen.getByTestId('tooltip').textContent;
    expect(tooltip).toBe(
      'modules.blockedByEnv(module=modules.quoted(name=modules.items.dingtalk.title),variable=LOBE_MODULES_DISABLED)',
    );
    expect(tooltip).not.toContain('modules.blockedBy(');
  });

  it('names env-pinned and switchable blockers separately when both apply', () => {
    render(
      <ModuleRow
        checked
        blockedBy={['dingtalk', 'dingtalkNotify']}
        blockerEnv={{ dingtalk: 'LOBE_MODULE_PRESET=standard' }}
        id="dingtalkWorkspace"
        pendingRestart={false}
        readOnly={false}
        onChange={() => {}}
      />,
    );

    const tooltip = screen.getByTestId('tooltip').textContent;
    expect(tooltip).toContain(
      'modules.blockedByEnv(module=modules.quoted(name=modules.items.dingtalk.title),variable=LOBE_MODULE_PRESET=standard)',
    );
    expect(tooltip).toContain(
      'modules.blockedBy(modules=modules.quoted(name=modules.items.dingtalkNotify.title))',
    );
    // The env-pinned one is not also offered as something to switch on here.
    expect(tooltip).not.toContain(
      'modules.blockedBy(modules=modules.quoted(name=modules.items.dingtalk.title)',
    );
  });

  it('renders its own env pin as locked and explained, e.g. GLOBAL_FILE_ORPHAN_GC=0', () => {
    const { container } = render(
      <ModuleRow
        checked={false}
        envDisabledBy="GLOBAL_FILE_ORPHAN_GC"
        id="fileOrphanGc"
        pendingRestart={false}
        readOnly={false}
        onChange={() => {}}
      />,
    );

    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('disabled')).not.toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('modules.status.env')).toBeTruthy();
    expect(screen.queryByText('modules.status.running')).toBeNull();
    expect(screen.getByTestId('tooltip').textContent).toBe(
      'modules.envTooltip(variable=GLOBAL_FILE_ORPHAN_GC)',
    );
    // An env pin is not a tree block: the row is not greyed as a blocked child.
    expect(container.querySelector('[data-blocked="true"]')).toBeNull();
  });
});

describe('ModuleRow long descriptions', () => {
  it('keeps the sandbox row to one line, with the setup detail behind a help button', () => {
    renderRow('sandbox');

    expect(
      screen.getByRole('button', { name: 'modules.helpFor(field=modules.items.sandbox.title)' }),
    ).toBeTruthy();
    expect(screen.getByTestId('tooltip').textContent).toBe('modules.items.sandbox.hint');
  });

  it('adds no help button to a row whose description fits', () => {
    renderRow('memory');

    expect(screen.queryByRole('button')).toBeNull();
  });
});
