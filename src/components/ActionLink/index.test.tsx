/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ActionLink, { resolveActionHref } from './index';

afterEach(() => cleanup());

describe('resolveActionHref', () => {
  it('keeps app paths in the app', () => {
    expect(resolveActionHref('/settings/messenger/dingtalk')).toEqual({
      external: false,
      href: '/settings/messenger/dingtalk',
    });
    expect(resolveActionHref(' /admin/system/general?tab=im-connectors ')).toEqual({
      external: false,
      href: '/admin/system/general?tab=im-connectors',
    });
  });

  it('opens https consoles outside the app', () => {
    expect(resolveActionHref('https://open-dev.dingtalk.com/fe/old#/developerSettings')).toEqual({
      external: true,
      href: 'https://open-dev.dingtalk.com/fe/old#/developerSettings',
    });
  });

  it('refuses anything that could leave the app unsafely', () => {
    for (const value of [
      undefined,
      null,
      42,
      '',
      '   ',
      '//evil.example.com',
      '/\\evil.example.com',
      'http://open-dev.dingtalk.com/',
      'javascript:alert(1)',
      'data:text/html,hi',
      'settings/connector',
      `https://example.com/${'a'.repeat(2100)}`,
    ])
      expect(resolveActionHref(value)).toBeUndefined();
  });

  it('refuses control characters the URL parser would strip into a protocol-relative URL', () => {
    for (const value of [
      '/\n/evil.example',
      '/\t/evil',
      '/\r/evil',
      '/\u0000/evil',
      '/\u001F/evil',
      '/\u007F/evil',
      '\n//evil.example',
      'https://open-dev.dingtalk.com/\n',
      '/settings/connector /evil',
    ])
      expect(resolveActionHref(value)).toBeUndefined();
  });

  it('refuses backslash variants that resolve to another host', () => {
    for (const value of ['/\\evil.example', '/\\\\evil.example', '\\\\evil.example', '/\\/evil'])
      expect(resolveActionHref(value)).toBeUndefined();
  });

  it('keeps a percent-encoded newline as an ordinary in-app path', () => {
    expect(resolveActionHref('/%0a/evil')).toEqual({ external: false, href: '/%0a/evil' });
  });
});

describe('ActionLink', () => {
  it('routes an app path inside the SPA', () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route
            element={<ActionLink href={'/settings/connector'}>设置 → 连接器</ActionLink>}
            path={'/chat'}
          />
          <Route element={<div>connector page</div>} path={'/settings/connector'} />
        </Routes>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: '设置 → 连接器' });
    expect(link.getAttribute('href')).toBe('/settings/connector');
    expect(link.getAttribute('target')).toBeNull();

    fireEvent.click(link);
    expect(screen.getByText('connector page')).toBeTruthy();
  });

  it('falls back to a plain anchor outside a router', () => {
    render(<ActionLink href={'/settings/messenger/dingtalk'}>去绑定钉钉</ActionLink>);

    expect(screen.getByRole('link', { name: '去绑定钉钉' }).getAttribute('href')).toBe(
      '/settings/messenger/dingtalk',
    );
  });

  it('opens an external console in a new tab without an opener', () => {
    const onClick = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const href = 'https://open-dev.dingtalk.com/fe/old#/developerSettings';
    render(
      <ActionLink href={href} onClick={onClick}>
        CLI 设置
      </ActionLink>,
    );

    const link = screen.getByRole('link', { name: 'CLI 设置' });
    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');

    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the words but drops the link for an unsafe target', () => {
    render(<ActionLink href={'http://example.com'}>去申请</ActionLink>);

    expect(screen.getByText('去申请')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
