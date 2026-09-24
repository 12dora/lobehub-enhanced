/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import { DingtalkPersonalInspectors } from './index';
import Summary from './Summary';

const dict = zhPlugin as Record<string, string>;

/** Real zh-CN copy, so a renamed or missing key fails here instead of shipping. */
const translate = (key: string, options?: Record<string, unknown>) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
};

const zh = (key: string, options?: Record<string, unknown>) =>
  translate(`builtins.lobe-dingtalk-personal.${key}`, options);

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));

vi.mock('@/styles', () => ({
  inspectorTextStyles: { root: 'inspector' },
  shinyTextStyles: { shinyText: 'shiny' },
}));

afterEach(() => cleanup());

const renderText = (
  apiName: string,
  args: Record<string, unknown>,
  partialArgs?: Record<string, unknown>,
) =>
  render(
    <Summary
      apiName={apiName}
      args={args}
      identifier={'lobe-dingtalk-personal'}
      isArgumentsStreaming={!!partialArgs}
      partialArgs={partialArgs}
    />,
  ).container.textContent;

describe('DingtalkPersonalSummaryInspector', () => {
  it('is registered for the batch API', () => {
    expect(DingtalkPersonalInspectors.completeTodos).toBe(Summary);
  });

  it('says how many todos a batch call completes, never which ids', () => {
    const text = renderText('completeTodos', { taskIds: ['1001', '1002', '1003'] });

    expect(text).toBe(
      `${zh('render.domain.todo')} · ${zh('render.batch.action.completeTodos', { count: 3 })}`,
    );
    expect(text).not.toContain('1001');
  });

  it('counts while the arguments are still streaming', () => {
    expect(renderText('completeTodos', {}, { taskIds: ['1001', '10'] })).toBe(
      `${zh('render.domain.todo')} · ${zh('render.batch.action.completeTodos', { count: 2 })}`,
    );
  });

  it('falls back to the action name until the list arrives', () => {
    const expected = `${zh('render.domain.todo')} · ${zh('apiName.completeTodos')}`;

    expect(renderText('completeTodos', {})).toBe(expected);
    expect(renderText('completeTodos', {}, { taskIds: [] })).toBe(expected);
  });

  it('leaves a single-item call as it was', () => {
    expect(renderText('completeTodo', { taskId: '57475254077' })).toBe(
      `${zh('render.domain.todo')} · ${zh('apiName.completeTodo')}`,
    );
  });
});
