/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AdminAuditConversationMessage,
  AdminAuditConversationMessageAttachment,
} from '@/enterprise/client/services/adminAudit';

import AuditChatMessageList from './AuditChatMessageList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_, key) => String(key) }),
  cssVar: {},
  cx: (...names: unknown[]) => names.filter(Boolean).join(' '),
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  m: {
    div: ({ children, role }: { children?: ReactNode; role?: string }) => (
      <div role={role}>{children}</div>
    ),
  },
  useReducedMotion: () => true,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/features/Conversation/ChatItem/components/Avatar', () => ({
  default: ({ alt }: { alt?: string }) => <span data-testid="avatar">{alt}</span>,
}));

// The chat UI's MarkdownMessage wraps @lobehub/ui Markdown (react-markdown + remark-gfm). Stand in
// with the same engine so the redaction remark plugin, `components` and link props are exercised
// for real without the user store / highlighter.
vi.mock('@/features/Conversation/Markdown', async () => {
  const { default: ReactMarkdown } = await import('react-markdown');
  const { default: remarkGfm } = await import('remark-gfm');
  return {
    default: ({
      allowHtml,
      children,
      componentProps,
      components,
      remarkPlugins = [],
    }: {
      allowHtml?: boolean;
      children: string;
      componentProps?: { a?: Record<string, unknown> };
      components?: Record<string, unknown>;
      remarkPlugins?: unknown[];
    }) => (
      <div data-allow-html={String(allowHtml)} data-testid="markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, ...(remarkPlugins as never[])]}
          components={{
            ...(components as object),
            a: ({ children: text, href }: { children?: ReactNode; href?: string }) => (
              <a href={href} {...componentProps?.a} target="_blank">
                {text}
              </a>
            ),
          }}
        >
          {children}
        </ReactMarkdown>
      </div>
    ),
  };
});

vi.mock('./format', () => ({
  formatAdminDateTime: () => '2026-01-02 00:00',
}));

const attachment: AdminAuditConversationMessageAttachment = {
  fileId: 'f1',
  fileType: 'application/pdf',
  name: 'notes.pdf',
  size: 2048,
  url: '/f/f1',
};

const message = (patch: Record<string, unknown> = {}) =>
  ({
    content: 'hello',
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    hasContent: true,
    id: 'm1',
    model: null,
    provider: null,
    role: 'user',
    ...patch,
  }) as AdminAuditConversationMessage;

const renderList = (
  messages: AdminAuditConversationMessage[],
  extra: Partial<Parameters<typeof AuditChatMessageList>[0]> = {},
) => render(<AuditChatMessageList messages={messages} {...extra} />);

const placementOf = (id: string) =>
  document.querySelector(`[data-message-id="${id}"]`)?.getAttribute('data-placement');

describe('AuditChatMessageList', () => {
  it('aligns user turns right, assistant turns left and system/tool turns center', () => {
    renderList([
      message({ id: 'u' }),
      message({ id: 'a', role: 'assistant' }),
      message({ id: 's', role: 'system' }),
      message({ id: 't', role: 'tool' }),
    ]);

    expect(placementOf('u')).toBe('right');
    expect(placementOf('a')).toBe('left');
    expect(placementOf('s')).toBe('center');
    expect(placementOf('t')).toBe('center');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('renders assistant markdown: tables, code blocks and lists', () => {
    renderList([
      message({
        content: [
          '# Title',
          '',
          '- one',
          '- two',
          '',
          '| a | b |',
          '| - | - |',
          '| 1 | 2 |',
          '',
          '```ts',
          'const x = 1;',
          '```',
        ].join('\n'),
        role: 'assistant',
      }),
    ]);

    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(document.querySelector('pre code')?.textContent).toContain('const x = 1;');
  });

  it('keeps [REDACTED] markers as chips, including where markdown would swallow them', () => {
    renderList([
      message({
        content:
          '[REDACTED email]: leaked\n\nSee [REDACTED](https://x.test) and **[REDACTED key]**',
        role: 'assistant',
      }),
    ]);

    const chips = [...document.querySelectorAll('[data-audit-redacted]')].map(
      (el) => el.textContent,
    );
    // A line-leading marker would otherwise parse as a link-reference definition and vanish.
    expect(chips).toEqual(['[REDACTED email]', '[REDACTED]', '[REDACTED key]']);
    expect(screen.getByText(/leaked/)).toBeTruthy();
  });

  it('never nests a chip inside an author-controlled link (href dropped, text kept)', () => {
    renderList([
      message({
        content: 'Click [See [REDACTED key]](https://evil.example) or [ok](https://fine.example)',
        role: 'assistant',
      }),
    ]);

    const chip = document.querySelector('[data-audit-redacted]');
    expect(chip?.textContent).toBe('[REDACTED key]');
    expect(chip?.closest('a')).toBeNull();
    expect(document.querySelector('a[href="https://evil.example"]')).toBeNull();
    expect(screen.getByText(/See/)).toBeTruthy();
    // Links without a marker are untouched.
    expect(screen.getByRole('link', { name: 'ok' }).getAttribute('href')).toBe(
      'https://fine.example',
    );
  });

  it('unwraps reference-style and autolinked URLs carrying a marker too', () => {
    renderList([
      message({
        content:
          '[a [REDACTED] b][ref] and https://x.example/[REDACTED]\n\n[ref]: https://evil.example',
        role: 'assistant',
      }),
    ]);

    for (const chip of document.querySelectorAll('[data-audit-redacted]')) {
      expect(chip.closest('a')).toBeNull();
    }
    expect(document.querySelectorAll('[data-audit-redacted]').length).toBeGreaterThan(0);
  });

  it('renders raw HTML as literal text, never as DOM', () => {
    renderList([
      message({
        content: 'hi <img src=x onerror=alert(1)> there\n\n<script>alert(2)</script>',
        role: 'assistant',
      }),
    ]);

    const md = screen.getByTestId('markdown');
    expect(md.getAttribute('data-allow-html')).toBe('false');
    expect(md.querySelector('img')).toBeNull();
    expect(md.querySelector('script')).toBeNull();
    expect(md.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(md.textContent).toContain('<script>alert(2)</script>');
  });

  it('restores markers literally inside code instead of chipping them', () => {
    renderList([message({ content: 'run `echo [REDACTED token]`', role: 'assistant' })]);

    expect(document.querySelector('code')?.textContent).toBe('echo [REDACTED token]');
    expect(document.querySelector('[data-audit-redacted]')).toBeNull();
  });

  it('opens http(s) links in a new tab without leaking the opener', () => {
    renderList([message({ content: 'See https://example.com/a' })]);

    const link = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(link.getAttribute('href')).toBe('https://example.com/a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('names assistant turns after the agent and falls back to the role label', () => {
    const { unmount } = renderList([message({ role: 'assistant' })], {
      assistantName: 'Research bot',
    });
    expect(document.querySelector('.name')?.textContent).toBe('Research bot');
    unmount();

    renderList([message({ role: 'assistant' })]);
    expect(document.querySelector('.name')?.textContent).toBe('assistant');
  });

  it('renders attachments under the body when the array is non-empty', () => {
    renderList([message({ attachments: [attachment] })]);

    const fileLink = screen.getByRole('link', {
      name: 'audit.conversations.message.openAttachment: notes.pdf',
    });
    expect(fileLink.getAttribute('href')).toBe('/f/f1');
  });

  it('shows the policy placeholder and no attachments when bodies are hidden', () => {
    renderList([message({ attachments: [attachment], content: null })], { bodyHidden: true });

    expect(screen.getByText('audit.live.message.bodyHidden')).toBeTruthy();
    expect(screen.queryByText('notes.pdf')).toBeNull();
    expect(screen.queryByTestId('markdown')).toBeNull();
  });

  it('shows "body not loaded" and hides attachments when the body exists but was not requested', () => {
    renderList([message({ attachments: [attachment], content: null })]);

    expect(screen.getByText('audit.conversations.topic.bodyNotLoaded')).toBeTruthy();
    expect(screen.queryByLabelText('audit.conversations.message.attachments')).toBeNull();
  });

  it('keeps attachments on file-only messages with no body text', () => {
    renderList([message({ attachments: [attachment], content: '', hasContent: false })]);

    expect(screen.getByText('—')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'audit.conversations.message.openAttachment: notes.pdf' }),
    ).toBeTruthy();
  });

  it('surfaces a persisted message error', () => {
    renderList([
      message({
        error: { message: 'quota exceeded', type: 'InsufficientQuota' },
        role: 'assistant',
      }),
    ]);

    expect(screen.getByRole('note').textContent).toBe(
      'audit.chat.messageError · InsufficientQuota: quota exceeded',
    );
  });

  it('collapses system turns by default and renders them verbatim (not markdown) when expanded', () => {
    renderList([message({ content: '**raw** [REDACTED x]', role: 'system' })]);

    expect(screen.queryByText(/\*\*raw\*\*/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'audit.live.message.expand' }));

    expect(screen.getByText(/\*\*raw\*\*/)).toBeTruthy();
    expect(screen.queryByTestId('markdown')).toBeNull();
    expect(document.querySelector('[data-audit-redacted]')?.textContent).toBe('[REDACTED x]');
  });
});
