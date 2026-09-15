import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendDingTalkAttachments } from './sendAttachments';

describe('sendDingTalkAttachments', () => {
  const uploadMedia = vi.fn();
  const sendOtoMessage = vi.fn();
  const sendGroupMessage = vi.fn();
  const sendBySessionWebhook = vi.fn();

  const api = {
    sendBySessionWebhook,
    sendGroupMessage,
    sendOtoMessage,
    uploadMedia,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadMedia.mockResolvedValue('media_1');
    sendOtoMessage.mockResolvedValue({});
    sendGroupMessage.mockResolvedValue({});
    sendBySessionWebhook.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads and sends an image to a DM user', async () => {
    const delivered = await sendDingTalkAttachments(api, { robotCode: 'r', userIds: ['staff_1'] }, [
      { data: Buffer.from('img').toString('base64'), name: 'pic.jpg', type: 'image' },
    ]);
    expect(delivered).toBe(1);
    expect(uploadMedia).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'pic.jpg', type: 'image' }),
    );
    expect(sendOtoMessage).toHaveBeenCalledWith(
      expect.objectContaining({ msgKey: 'sampleImageMsg', robotCode: 'r', userIds: ['staff_1'] }),
    );
  });
});
