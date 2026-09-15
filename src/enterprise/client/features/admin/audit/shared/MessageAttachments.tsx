'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { formatSize } from '@/utils/format';

import type { AuditMessageAttachment } from './auditMessageAttachments';
import { isImageFileType } from './auditMessageAttachments';

const THUMB_MAX_PX = 120;

const styles = createStaticStyles(({ css }) => ({
  list: css`
    margin-block-start: 8px;
  `,
  chip: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 4px;

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
  meta: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
  `,
  name: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  thumb: css`
    display: block;

    max-width: ${THUMB_MAX_PX}px;
    max-height: ${THUMB_MAX_PX}px;
    border-radius: ${cssVar.borderRadiusSM};

    object-fit: contain;
  `,
}));

export interface MessageAttachmentsProps {
  attachments?: AuditMessageAttachment[] | null;
}

interface AttachmentChipProps {
  file: AuditMessageAttachment;
  openLabel: string;
}

const AttachmentChip = memo<AttachmentChipProps>(({ file, openLabel }) => {
  const isImage = isImageFileType(file.fileType);
  const sizeLabel = formatSize(file.size);

  return (
    <a
      aria-label={openLabel}
      className={styles.chip}
      href={file.url}
      rel="noopener noreferrer"
      target="_blank"
      title={file.name}
    >
      {isImage ? (
        <img alt={file.name} className={styles.thumb} loading="lazy" src={file.url} />
      ) : null}
      <span className={styles.meta}>
        {isImage ? null : <FileIcon fileName={file.name} fileType={file.fileType} size={16} />}
        <Text ellipsis className={styles.name}>
          {file.name}
        </Text>
        <Text style={{ flex: 'none', fontSize: 12, margin: 0 }} type="secondary">
          {sizeLabel}
        </Text>
      </span>
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
