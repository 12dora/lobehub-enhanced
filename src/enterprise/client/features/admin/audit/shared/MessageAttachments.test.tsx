/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AdminAuditConversationMessageAttachment } from '@/enterprise/client/services/adminAudit';

import { isImageFileType } from './auditMessageAttachments';
import { MessageAttachments } from './MessageAttachments';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: {},
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({
    'aria-label': ariaLabel,
    children,
    role,
  }: {
    'aria-label'?: string;
    'children'?: ReactNode;
    'role'?: string;
  }) => (
    <div aria-label={ariaLabel} role={role}>
      {children}
    </div>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

const pdf: AdminAuditConversationMessageAttachment = {
  fileId: 'file-pdf',
  fileType: 'application/pdf',
  name: 'report.pdf',
  size: 2048,
  url: '/f/file-pdf',
};

const photo: AdminAuditConversationMessageAttachment = {
  fileId: 'file-img',
  fileType: 'image/png',
  name: 'photo.png',
  size: 1024,
  url: '/f/file-img',
};

describe('isImageFileType', () => {
  it('matches image mime types case-insensitively', () => {
    expect(isImageFileType('image/png')).toBe(true);
    expect(isImageFileType('IMAGE/JPEG')).toBe(true);
    expect(isImageFileType('application/pdf')).toBe(false);
  });
});

describe('MessageAttachments', () => {
  it('renders nothing when the array is missing or empty', () => {
    const { container: missing } = render(<MessageAttachments />);
    expect(missing.querySelector('[aria-label]')).toBeNull();

    const { container: empty } = render(<MessageAttachments attachments={[]} />);
    expect(empty.querySelector('[aria-label]')).toBeNull();
  });

  it('renders a compact chip that opens the file in a new tab', () => {
    render(<MessageAttachments attachments={[pdf]} />);

    expect(screen.getByLabelText('audit.conversations.message.attachments')).toBeTruthy();
    const link = screen.getByRole('link', {
      name: 'audit.conversations.message.openAttachment: report.pdf',
    });
    expect(link.getAttribute('href')).toBe('/f/file-pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('title')).toBe('report.pdf');
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders image files as the same click-to-open chip, without an auto-loaded thumbnail', () => {
    render(<MessageAttachments attachments={[photo]} />);

    expect(screen.queryByRole('img')).toBeNull();
    const link = screen.getByRole('link', {
      name: 'audit.conversations.message.openAttachment: photo.png',
    });
    expect(link.getAttribute('href')).toBe('/f/file-img');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.querySelector('img')).toBeNull();
  });
});
