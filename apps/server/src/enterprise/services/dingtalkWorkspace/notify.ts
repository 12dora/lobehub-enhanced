import debug from 'debug';

import { sendWorkNotice } from '@/server/services/messenger/platforms/dingtalk/notifyApp';

const log = debug('lobe-server:dingtalk-workspace:notify');

export interface DingtalkWorkNoticePayload {
  lines: string[];
  title: string;
}

/**
 * Best-effort DingTalk work notice. Failures are logged and swallowed.
 */
export const notifyUser = async (
  staffId: string,
  payload: DingtalkWorkNoticePayload,
): Promise<void> => {
  const id = staffId.trim();
  if (!id) return;
  const title = payload.title.trim();
  const text = payload.lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  if (!title && !text) return;

  try {
    await sendWorkNotice({
      markdown: { text: text || title, title: title || text.slice(0, 32) },
      staffIds: [id],
    });
  } catch (error) {
    console.error('[dingtalkWorkspace.notifyUser] failed', {
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    log('notifyUser failed: %O', error);
  }
};
