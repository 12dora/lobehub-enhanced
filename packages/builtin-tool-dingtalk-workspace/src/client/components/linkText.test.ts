import { describe, expect, it } from 'vitest';

import { splitMarkdownLinks, toInAppPath, toSafeLinkHref } from './linkText';

const AUTH_URL = 'https://chat.example.com/settings/connector?dingtalkPersonal=authorize';
const AUTH_NOTE = `授权「钉钉个人数据」后可查看你在钉钉客户端里的全部待办：[点此前往授权](${AUTH_URL})`;

describe('splitMarkdownLinks', () => {
  it('keeps plain text as one segment', () => {
    expect(splitMarkdownLinks('已包含你在钉钉里的全部待办（经你授权读取）')).toEqual([
      { text: '已包含你在钉钉里的全部待办（经你授权读取）', type: 'text' },
    ]);
    expect(splitMarkdownLinks('')).toEqual([]);
  });

  it('turns the authorize note link into a link segment', () => {
    expect(splitMarkdownLinks(AUTH_NOTE)).toEqual([
      { text: '授权「钉钉个人数据」后可查看你在钉钉客户端里的全部待办：', type: 'text' },
      { href: AUTH_URL, text: '点此前往授权', type: 'link' },
    ]);
  });

  it('handles several links and the text between them', () => {
    const text = '先[设置](/settings/connector)再[帮助](http://docs.example.com/a#b)。';

    expect(splitMarkdownLinks(text)).toEqual([
      { text: '先', type: 'text' },
      { href: '/settings/connector', text: '设置', type: 'link' },
      { text: '再', type: 'text' },
      { href: 'http://docs.example.com/a#b', text: '帮助', type: 'link' },
      { text: '。', type: 'text' },
    ]);
  });

  it('leaves unsafe or empty links in the text exactly as written', () => {
    const text = '点[这里](javascript:alert(1))或[那里](//evil.example.com)或[ ](/x)或[ok](/ok)';

    expect(splitMarkdownLinks(text)).toEqual([
      {
        text: '点[这里](javascript:alert(1))或[那里](//evil.example.com)或[ ](/x)或',
        type: 'text',
      },
      { href: '/ok', text: 'ok', type: 'link' },
    ]);
  });
});

describe('toSafeLinkHref', () => {
  it('accepts web addresses and root-relative paths only', () => {
    expect(toSafeLinkHref('https://chat.example.com/x')).toBe('https://chat.example.com/x');
    expect(toSafeLinkHref('HTTP://chat.example.com')).toBe('HTTP://chat.example.com');
    expect(toSafeLinkHref('/settings/connector')).toBe('/settings/connector');

    expect(toSafeLinkHref('javascript:alert(1)')).toBeUndefined();
    expect(toSafeLinkHref('data:text/html,hi')).toBeUndefined();
    expect(toSafeLinkHref('//evil.example.com')).toBeUndefined();
    expect(toSafeLinkHref('/\\evil.example.com')).toBeUndefined();
    expect(toSafeLinkHref('https://')).toBeUndefined();
    expect(toSafeLinkHref('settings/connector')).toBeUndefined();
    expect(toSafeLinkHref('dingtalk://dingtalkclient/page')).toBeUndefined();
  });
});

describe('toInAppPath', () => {
  const origin = 'https://chat.example.com';

  it('keeps a root-relative path', () => {
    expect(toInAppPath('/settings/connector', origin)).toBe('/settings/connector');
    expect(toInAppPath('/settings/connector')).toBe('/settings/connector');
  });

  it('turns a same-origin url into its path, query and hash', () => {
    expect(toInAppPath(`${origin}/settings/connector?dingtalkPersonal=authorize#top`, origin)).toBe(
      '/settings/connector?dingtalkPersonal=authorize#top',
    );
  });

  it('leaves other origins alone', () => {
    expect(toInAppPath('https://login.dingtalk.com/verify', origin)).toBeUndefined();
    expect(toInAppPath('http://chat.example.com/settings', origin)).toBeUndefined();
    expect(toInAppPath(`${origin}/settings`)).toBeUndefined();
  });
});
