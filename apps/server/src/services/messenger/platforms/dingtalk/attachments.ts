import type { Message } from 'chat';

export const isUnsupportedDingTalkMedia = (message: Message): boolean => {
  const raw = (message as { raw?: { msgtype?: string } }).raw;
  if (raw?.msgtype === 'audio' || raw?.msgtype === 'video') return true;
  const attachments = (message as { attachments?: Array<{ type?: string }> }).attachments;
  return Boolean(attachments?.some((item) => item.type === 'audio' || item.type === 'video'));
};

export interface DingTalkOutboundAttachment {
  data?: string;
  fetchUrl?: string;
  mimeType?: string;
  name?: string;
  type: 'audio' | 'file' | 'image' | 'video';
}

export const mapOutboundAttachments = (
  attachments:
    | Array<{
        data?: string;
        fetchUrl?: string;
        mimeType?: string;
        name?: string;
        type: 'audio' | 'file' | 'image' | 'video';
      }>
    | undefined,
): DingTalkOutboundAttachment[] => {
  if (!attachments?.length) return [];
  return attachments.filter((item) => item.type === 'image' || item.type === 'file');
};
