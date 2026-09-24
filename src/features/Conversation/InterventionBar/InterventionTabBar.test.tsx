/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import InterventionTabBar from './InterventionTabBar';

const zhPlugin: Record<string, string> = {
  'builtins.lobe-dingtalk-personal.apiName.completeTodo': '完成待办',
  'builtins.lobe-dingtalk-workspace.apiName.deleteTodo': '删除待办',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { exists: (key: string) => key in zhPlugin },
    t: (key: string) => zhPlugin[key] ?? key,
  }),
}));

vi.mock('@/store/tool', () => ({
  pluginHelpers: { getPluginTitle: (meta?: { title?: string }) => meta?.title },
  useToolStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/tool/selectors', () => ({
  toolSelectors: { getMetaById: () => () => undefined },
}));

const pending = (
  toolMessageId: string,
  identifier: string,
  apiName: string,
): PendingIntervention => ({
  apiName,
  identifier,
  intervention: { kind: 'approval', status: 'pending' },
  requestArgs: '{}',
  toolCallId: `call_${toolMessageId}`,
  toolMessageId,
});

describe('InterventionTabBar', () => {
  it('labels tabs with the localized API name instead of the raw apiName', () => {
    const onTabChange = vi.fn();
    render(
      <InterventionTabBar
        activeIndex={0}
        interventions={[
          pending('t1', 'lobe-dingtalk-personal', 'completeTodo'),
          pending('t2', 'lobe-dingtalk-workspace', 'deleteTodo'),
        ]}
        onTabChange={onTabChange}
      />,
    );

    expect(screen.getByText(/完成待办/)).toBeInTheDocument();
    expect(screen.queryByText(/completeTodo/)).toBeNull();

    fireEvent.click(screen.getByText(/删除待办/));
    expect(onTabChange).toHaveBeenCalledWith(1);
  });
});
