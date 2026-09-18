'use client';

import type { MarkdownProps } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import MarkdownMessage from '@/features/Conversation/Markdown';

import {
  AUDIT_REDACTED_TAG,
  createRemarkAuditRedaction,
  prepareRedactedMarkdown,
} from './auditRedactionMarkdown';

const styles = createStaticStyles(({ css }) => ({
  redacted: css`
    display: inline-block;

    padding-inline: 4px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: ${cssVar.borderRadiusSM};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 0.92em;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorWarningText};
    word-break: break-all;

    background: ${cssVar.colorWarningBg};
  `,
}));

/** Inline chip for one server-applied `[REDACTED …]` marker. */
export const RedactionChip = memo<{ children?: ReactNode }>(({ children }) => {
  const { t } = useTranslation('admin');
  return (
    <span className={styles.redacted} data-audit-redacted="" title={t('audit.chat.redacted')}>
      {children}
    </span>
  );
});

RedactionChip.displayName = 'AuditRedactionChip';

const LINK_PROPS = { rel: 'noopener noreferrer' } as NonNullable<
  MarkdownProps['componentProps']
>['a'];

const COMPONENTS = { [AUDIT_REDACTED_TAG]: RedactionChip } as MarkdownProps['components'];

export interface AuditMarkdownProps {
  content: string;
}

/**
 * The chat UI's own markdown renderer (same typography, code blocks, tables, user theme), minus
 * every chat-store-bound plugin, plus redaction chips. Raw HTML is disabled explicitly and shown as
 * literal text by the remark plugin,
 * and rendering is static — audit evidence never streams.
 */
const AuditMarkdown = memo<AuditMarkdownProps>(({ content }) => {
  const { markers, text } = useMemo(() => prepareRedactedMarkdown(content), [content]);
  const remarkPlugins = useMemo(() => [createRemarkAuditRedaction(markers)], [markers]);

  return (
    <MarkdownMessage
      allowHtml={false}
      componentProps={{ a: LINK_PROPS }}
      components={COMPONENTS}
      enableStream={false}
      remarkPlugins={remarkPlugins}
    >
      {text}
    </MarkdownMessage>
  );
});

AuditMarkdown.displayName = 'AuditMarkdown';

export default AuditMarkdown;
