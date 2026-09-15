import { describe, expect, it } from 'vitest';

import type { DingTalkApiClient } from './api';
import { buildActionCardParam, DingTalkAiCardStream, dtmdSendMessageUrl } from './cards';
import { DingTalkCardUnavailableError } from './types';

describe('buildActionCardParam', () => {
  it('uses dtmd sendMessage URLs and sampleActionCard for a single button', () => {
    const result = buildActionCardParam({
      buttons: [{ command: '/助手', label: 'Agents' }],
      text: 'pick one',
      title: 'Agents',
    });
    expect(result.msgKey).toBe('sampleActionCard');
    const param = JSON.parse(result.msgParam);
    expect(param.singleURL).toBe(dtmdSendMessageUrl('/助手'));
    expect(param.singleURL).toContain('dtmd://dingtalkclient/sendMessage?content=');
  });

  it('uses sampleActionCardN for 2–5 buttons', () => {
    const result = buildActionCardParam({
      buttons: [
        { command: '/use 1', label: '1' },
        { command: '/use 2', label: '2' },
      ],
      text: 't',
      title: 'T',
    });
    expect(result.msgKey).toBe('sampleActionCard2');
    const param = JSON.parse(result.msgParam);
    expect(param.actionURL1).toBe(dtmdSendMessageUrl('/use 1'));
    expect(param.actionURL2).toBe(dtmdSendMessageUrl('/use 2'));
  });
});

describe('DingTalkAiCardStream', () => {
  it('wraps API failures as DingTalkCardUnavailableError', async () => {
    const api = {
      createAndDeliverCard: async () => {
        throw new Error('network down');
      },
    } as unknown as DingTalkApiClient;

    const stream = new DingTalkAiCardStream(api, {
      cardTemplateId: 'tpl',
      robotCode: 'r',
      staffId: 's',
    });
    await expect(stream.create()).rejects.toBeInstanceOf(DingTalkCardUnavailableError);
  });
});
