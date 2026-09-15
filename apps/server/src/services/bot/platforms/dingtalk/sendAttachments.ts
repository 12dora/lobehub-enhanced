import type { DingTalkApiClient } from '@lobechat/chat-adapter-dingtalk';
import debug from 'debug';

import type { BotMessageAttachment } from '../types';

const log = debug('bot-platform:dingtalk:send-attachments');

const DINGTALK_IMAGE_SEND_FAILED = '图片发送失败';

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

const isHttpsPhotoUrl = (url: string | undefined): url is string => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
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

const sendRobotMessage = async (
  api: DingTalkApiClient,
  target: DingTalkSendTarget,
  msgKey: string,
  msgParam: string,
): Promise<void> => {
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

const sendImage = async (
  api: DingTalkApiClient,
  target: DingTalkSendTarget,
  mediaId: string,
  photoURL: string | undefined,
): Promise<boolean> => {
  if (target.sessionWebhook) {
    await api.sendBySessionWebhook(target.sessionWebhook, {
      image: { media_id: mediaId },
      msgtype: 'image',
    });
    return true;
  }
  if (isHttpsPhotoUrl(photoURL)) {
    await sendRobotMessage(api, target, 'sampleImageMsg', JSON.stringify({ photoURL }));
    return true;
  }
  console.error(
    'sendDingTalkAttachments: skipping image — robot API sampleImageMsg needs an https photoURL (have media_id only)',
  );
  await notifyImageSendFailed(api, target);
  return false;
};

const sendFile = async (
  api: DingTalkApiClient,
  target: DingTalkSendTarget,
  mediaId: string,
  fileName: string,
  fileType: string,
): Promise<boolean> => {
  if (target.sessionWebhook) {
    await api.sendBySessionWebhook(target.sessionWebhook, {
      file: { fileName, fileType, media_id: mediaId },
      msgtype: 'file',
    });
    return true;
  }
  await sendRobotMessage(
    api,
    target,
    'sampleFile',
    JSON.stringify({ fileName, fileType, mediaId }),
  );
  return true;
};

const notifyImageSendFailed = async (
  api: DingTalkApiClient,
  target: DingTalkSendTarget,
): Promise<void> => {
  try {
    await sendRobotMessage(
      api,
      target,
      'sampleText',
      JSON.stringify({ content: DINGTALK_IMAGE_SEND_FAILED }),
    );
  } catch (error) {
    console.error('sendDingTalkAttachments: failed to notify image send failure', error);
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
      if (att.type === 'image' && !target.sessionWebhook && !isHttpsPhotoUrl(att.fetchUrl)) {
        console.error(
          'sendDingTalkAttachments: cannot deliver image without session webhook or https photoURL',
        );
        await notifyImageSendFailed(api, target);
        continue;
      }
      const mediaType = att.type === 'image' ? 'image' : 'file';
      const mediaId = await api.uploadMedia({ buffer, filename, type: mediaType });

      const sent =
        att.type === 'image'
          ? await sendImage(api, target, mediaId, att.fetchUrl)
          : await sendFile(api, target, mediaId, filename, fileTypeFromName(filename));
      if (sent) delivered += 1;
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
