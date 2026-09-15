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

  it('sends session-webhook images as { msgtype: image, image: { media_id } }', async () => {
    const delivered = await sendDingTalkAttachments(
      api,
      {
        robotCode: 'r',
        sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
      },
      [{ data: Buffer.from('img').toString('base64'), name: 'pic.jpg', type: 'image' }],
    );
    expect(delivered).toBe(1);
    expect(sendBySessionWebhook).toHaveBeenCalledWith(
      'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
      { image: { media_id: 'media_1' }, msgtype: 'image' },
    );
    expect(sendOtoMessage).not.toHaveBeenCalled();
  });

  it('sends session-webhook files as { msgtype: file, file: { media_id, fileName, fileType } }', async () => {
    const delivered = await sendDingTalkAttachments(
      api,
      {
        robotCode: 'r',
        sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
      },
      [{ data: Buffer.from('pdf').toString('base64'), name: 'report.pdf', type: 'file' }],
    );
    expect(delivered).toBe(1);
    expect(sendBySessionWebhook).toHaveBeenCalledWith(
      'https://oapi.dingtalk.com/robot/sendBySession?session=abc',
      {
        file: { fileName: 'report.pdf', fileType: 'pdf', media_id: 'media_1' },
        msgtype: 'file',
      },
    );
  });

  it('uses sampleImageMsg only with a real https photoURL on the robot API', async () => {
    const delivered = await sendDingTalkAttachments(api, { robotCode: 'r', userIds: ['staff_1'] }, [
      {
        data: Buffer.from('img').toString('base64'),
        fetchUrl: 'https://cdn.example.com/pic.jpg',
        name: 'pic.jpg',
        type: 'image',
      },
    ]);
    expect(delivered).toBe(1);
    expect(sendOtoMessage).toHaveBeenCalledWith({
      msgKey: 'sampleImageMsg',
      msgParam: JSON.stringify({ photoURL: 'https://cdn.example.com/pic.jpg' }),
      robotCode: 'r',
      userIds: ['staff_1'],
    });
  });

  it('does not send sampleImageMsg when the only handle is media_id and notifies the user', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const delivered = await sendDingTalkAttachments(api, { robotCode: 'r', userIds: ['staff_1'] }, [
      { data: Buffer.from('img').toString('base64'), name: 'pic.jpg', type: 'image' },
    ]);
    expect(delivered).toBe(0);
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(sendOtoMessage).toHaveBeenCalledWith({
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: '图片发送失败' }),
      robotCode: 'r',
      userIds: ['staff_1'],
    });
    expect(sendBySessionWebhook).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('sends files via sampleFile { mediaId, fileName, fileType } on the robot API', async () => {
    const delivered = await sendDingTalkAttachments(api, { robotCode: 'r', userIds: ['staff_1'] }, [
      { data: Buffer.from('pdf').toString('base64'), name: 'report.pdf', type: 'file' },
    ]);
    expect(delivered).toBe(1);
    expect(sendOtoMessage).toHaveBeenCalledWith({
      msgKey: 'sampleFile',
      msgParam: JSON.stringify({ fileName: 'report.pdf', fileType: 'pdf', mediaId: 'media_1' }),
      robotCode: 'r',
      userIds: ['staff_1'],
    });
  });
});
