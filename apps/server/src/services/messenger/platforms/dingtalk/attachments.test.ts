import { describe, expect, it } from 'vitest';

import { isUnsupportedDingTalkMedia, mapOutboundAttachments } from './attachments';

describe('DingTalk attachment mapping', () => {
  it('rejects inbound audio and video', () => {
    expect(isUnsupportedDingTalkMedia({ raw: { msgtype: 'audio' }, text: '' } as any)).toBe(true);
    expect(isUnsupportedDingTalkMedia({ raw: { msgtype: 'video' }, text: '' } as any)).toBe(true);
    expect(isUnsupportedDingTalkMedia({ attachments: [{ type: 'audio' }], text: '' } as any)).toBe(
      true,
    );
    expect(isUnsupportedDingTalkMedia({ raw: { msgtype: 'picture' }, text: '' } as any)).toBe(
      false,
    );
  });

  it('keeps outbound images and files only', () => {
    expect(
      mapOutboundAttachments([
        { name: 'a.png', type: 'image' },
        { name: 'b.pdf', type: 'file' },
        { name: 'c.mp3', type: 'audio' },
      ]),
    ).toEqual([
      { name: 'a.png', type: 'image' },
      { name: 'b.pdf', type: 'file' },
    ]);
  });
});
