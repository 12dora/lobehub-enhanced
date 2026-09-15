/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { linkifyText, splitHttpUrls } from './linkifyText';

describe('splitHttpUrls', () => {
  it('leaves plain text unchanged', () => {
    expect(splitHttpUrls('hello world')).toEqual([{ value: 'hello world' }]);
  });

  it('extracts absolute http and https URLs', () => {
    expect(splitHttpUrls('see https://example.com/a and http://localhost:3010/f')).toEqual([
      { value: 'see ' },
      { href: 'https://example.com/a', value: 'https://example.com/a' },
      { value: ' and ' },
      { href: 'http://localhost:3010/f', value: 'http://localhost:3010/f' },
    ]);
  });

  it('does not treat relative paths, ftp, or www-only hosts as links', () => {
    expect(splitHttpUrls('open /f/abc ftp://files.example www.example.com')).toEqual([
      { value: 'open /f/abc ftp://files.example www.example.com' },
    ]);
  });

  it('keeps trailing sentence punctuation outside the href', () => {
    expect(splitHttpUrls('Visit https://example.com.')).toEqual([
      { value: 'Visit ' },
      { href: 'https://example.com', value: 'https://example.com' },
      { value: '.' },
    ]);
  });

  it('keeps balanced parentheses inside Wikipedia-style paths', () => {
    expect(splitHttpUrls('see https://en.wikipedia.org/wiki/X_(y)')).toEqual([
      { value: 'see ' },
      {
        href: 'https://en.wikipedia.org/wiki/X_(y)',
        value: 'https://en.wikipedia.org/wiki/X_(y)',
      },
    ]);
  });

  it('strips an unbalanced trailing closing paren together with sentence punctuation', () => {
    expect(splitHttpUrls('See (https://example.com/foo).')).toEqual([
      { value: 'See (' },
      { href: 'https://example.com/foo', value: 'https://example.com/foo' },
      { value: ').' },
    ]);
  });
});

describe('linkifyText', () => {
  it('renders absolute URLs as new-tab links and leaves other text as text', () => {
    const { container } = render(<div>{linkifyText('go https://example.com/x now')}</div>);
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('https://example.com/x');
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).toBe('go https://example.com/x now');
  });

  it('does not wrap non-http text in an anchor', () => {
    const { container } = render(<div>{linkifyText('no links here')}</div>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('no links here');
  });
});
