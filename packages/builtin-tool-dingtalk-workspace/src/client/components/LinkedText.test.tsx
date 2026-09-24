/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import LinkedText from './LinkedText';

afterEach(() => cleanup());

const NOTE_PREFIX = '授权「钉钉个人数据」后可查看你在钉钉客户端里的全部待办：';

describe('LinkedText', () => {
  it('renders plain text without any link', () => {
    const { container } = render(
      <LinkedText text={'已包含你在钉钉里的全部待办（经你授权读取）'} />,
    );

    expect(container.textContent).toBe('已包含你在钉钉里的全部待办（经你授权读取）');
    expect(container.querySelector('a')).toBeNull();
  });

  it('opens a link to another site in a new tab', () => {
    const href = 'https://aihub.other-host.example/settings/connector?dingtalkPersonal=authorize';
    const { container } = render(<LinkedText text={`${NOTE_PREFIX}[点此前往授权](${href})`} />);

    const link = screen.getByText('点此前往授权').closest('a');
    expect(link?.getAttribute('href')).toBe(href);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).toBe(`${NOTE_PREFIX}点此前往授权`);
  });

  it('navigates inside the SPA for a same-origin link', () => {
    const href = `${window.location.origin}/settings/connector?dingtalkPersonal=authorize`;
    render(
      <MemoryRouter>
        <LinkedText text={`${NOTE_PREFIX}[点此前往授权](${href})`} />
      </MemoryRouter>,
    );

    const link = screen.getByText('点此前往授权').closest('a');
    expect(link?.getAttribute('href')).toBe('/settings/connector?dingtalkPersonal=authorize');
    expect(link?.getAttribute('target')).toBeNull();
  });

  it('falls back to a plain same-tab link outside a router', () => {
    render(<LinkedText text={'去 [连接器](/settings/connector) 授权'} />);

    const link = screen.getByText('连接器').closest('a');
    expect(link?.getAttribute('href')).toBe('/settings/connector');
    expect(link?.getAttribute('target')).toBeNull();
  });

  it('never turns an unsafe target into a link', () => {
    const text = '点[这里](javascript:alert(1))';
    const { container } = render(<LinkedText text={text} />);

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe(text);
  });
});
