import type { DingTalkApiClient } from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import type { BotMessageAttachment } from '../types';

const log = debug('bot-platform:dingtalk:send-attachments');

const fallbackFilename = (att: BotMessageAttachment, index: number): string => {
  if (att.name) return att.name;
  if (att.fetchUrl) {
    try {
      const base = new URL(att.fetchUrl).pathname.split('/').pop();
      if (base) return base;
    } catch {
      // fall through
    }
  }
  return `attachment-${index + 1}`;
};

const fileTypeFromName = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext && ext.length <= 8 ? ext : 'bin';
};

const loadAttachmentBuffer = async (
  attachment: BotMessageAttachment,
): Promise<Buffer | undefined> => {
  if (attachment.data) {
    try {
      return Buffer.from(attachment.data, 'base64');
    } catch (error) {
      log('loadAttachmentBuffer: failed to decode base64: %O', error);
    }
  }
  if (attachment.fetchUrl) {
    try {
      const response = await fetch(attachment.fetchUrl, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
      log('loadAttachmentBuffer: HTTP %d for %s', response.status, attachment.fetchUrl);
    } catch (error) {
      log('loadAttachmentBuffer: fetch failed for %s: %O', attachment.fetchUrl, error);
    }
  }
  return undefined;
};

export interface DingTalkSendTarget {
  openConversationId?: string;
  robotCode: string;
  sessionWebhook?: string;
  userIds?: string[];
}

const sendViaRobot = async (
  api: DingTalkApiClient,
  target: DingTalkSendTarget,
  msgKey: string,
  msgParam: string,
): Promise<void> => {
  if (target.sessionWebhook) {
    const parsed = JSON.parse(msgParam) as Record<string, unknown>;
    if (msgKey === 'sampleImageMsg') {
      await api.sendBySessionWebhook(target.sessionWebhook, {
        image: { photoURL: parsed.photoURL, mediaId: parsed.mediaId },
        msgtype: 'image',
      });
      return;
    }
    await api.sendBySessionWebhook(target.sessionWebhook, {
      file: parsed,
      msgtype: 'file',
    });
    return;
  }

  if (target.userIds?.length) {
    await api.sendOtoMessage({
      msgKey,
      msgParam,
      robotCode: target.robotCode,
      userIds: target.userIds,
    });
    return;
  }

  if (target.openConversationId) {
    await api.sendGroupMessage({
      msgKey,
      msgParam,
      openConversationId: target.openConversationId,
      robotCode: target.robotCode,
    });
  }
};

export const sendDingTalkAttachments = async (
  api: DingTalkApiClient,
  target: DingTalkSendTarget,
  attachments: BotMessageAttachment[],
): Promise<number> => {
  let delivered = 0;
  for (const [index, att] of attachments.entries()) {
    try {
      const buffer = await loadAttachmentBuffer(att);
      if (!buffer) {
        log('sendDingTalkAttachments: skipping attachment with no resolvable bytes');
        continue;
      }
      const filename = fallbackFilename(att, index);
      const mediaType = att.type === 'image' ? 'image' : 'file';
      const mediaId = await api.uploadMedia({ buffer, filename, type: mediaType });

      if (att.type === 'image') {
        await sendViaRobot(
          api,
          target,
          'sampleImageMsg',
          JSON.stringify({ mediaId, photoURL: att.fetchUrl ?? mediaId }),
        );
      } else {
        await sendViaRobot(
          api,
          target,
          'sampleFile',
          JSON.stringify({
            fileName: filename,
            fileType: fileTypeFromName(filename),
            mediaId,
          }),
        );
      }
      delivered += 1;
    } catch (error) {
      log(
        'sendDingTalkAttachments: failed to send %s "%s": %O',
        att.type,
        att.name ?? '(unnamed)',
        error,
      );
    }
  }
  return delivered;
};
