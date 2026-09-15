'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdminAuditConversationMessageAttachment } from '@/enterprise/client/services/adminAudit';
import { formatSize } from '@/utils/format';

import { isImageFileType } from './auditMessageAttachments';

const styles = createStaticStyles(({ css }) => ({
  list: css`
    margin-block-start: 8px;
  `,
  chip: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    max-width: 240px;
    padding-block: 6px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    color: inherit;
    text-decoration: none;

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  name: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export interface MessageAttachmentsProps {
  attachments?: AdminAuditConversationMessageAttachment[] | null;
}

interface AttachmentChipProps {
  file: AdminAuditConversationMessageAttachment;
  openLabel: string;
}

const AttachmentChip = memo<AttachmentChipProps>(({ file, openLabel }) => {
  const isImage = isImageFileType(file.fileType);
  const Icon = isImage ? ImageIcon : FileText;
  const sizeLabel = formatSize(file.size);

  return (
    <a
      aria-label={`${openLabel}: ${file.name}`}
      className={styles.chip}
      href={file.url}
      rel="noopener noreferrer"
      target="_blank"
      title={file.name}
    >
      <Icon aria-hidden size={16} style={{ flexShrink: 0 }} />
      <Text ellipsis as="span" className={styles.name}>
        {file.name}
      </Text>
      <Text as="span" style={{ flex: 'none', fontSize: 12, margin: 0 }} type="secondary">
        {sizeLabel}
      </Text>
    </a>
  );
});

AttachmentChip.displayName = 'AuditMessageAttachmentChip';

export const MessageAttachments = memo<MessageAttachmentsProps>(({ attachments }) => {
  const { t } = useTranslation('admin');
  const items = attachments ?? [];
  if (items.length === 0) return null;

  const openLabel = t('audit.conversations.message.openAttachment');

  return (
    <Flexbox
      horizontal
      aria-label={t('audit.conversations.message.attachments')}
      className={styles.list}
      gap={8}
      role="group"
      wrap="wrap"
    >
      {items.map((file) => (
        <AttachmentChip file={file} key={file.fileId} openLabel={openLabel} />
      ))}
    </Flexbox>
  );
});

MessageAttachments.displayName = 'AuditMessageAttachments';
