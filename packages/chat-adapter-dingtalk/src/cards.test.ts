import { describe, expect, it } from 'vitest';

import type { DingTalkApiClient } from './api';
import {
  buildActionCardParam,
  buildSampleActionCardParam,
  DingTalkAiCardStream,
  dtmdSendMessageUrl,
} from './cards';
import { DingTalkCardUnavailableError } from './types';

describe('buildSampleActionCardParam', () => {
  it('emits sampleActionCard with title, text, singleTitle, singleURL and no second button', () => {
    const result = buildSampleActionCardParam({
      singleTitle: '在AI平台中查看',
      singleURL: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
      text: 'body',
      title: '提醒',
    });
    expect(result.msgKey).toBe('sampleActionCard');
    expect(result.msgParam).toBe(
      JSON.stringify({
        title: '提醒',
        text: 'body',
        singleTitle: '在AI平台中查看',
        singleURL: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
      }),
    );
    const param = JSON.parse(result.msgParam) as Record<string, unknown>;
    expect(param).not.toHaveProperty('actionTitle2');
    expect(param).not.toHaveProperty('actionURL2');
    expect(param).not.toHaveProperty('actionTitle1');
  });
});

describe('buildActionCardParam', () => {
  it('uses dtmd sendMessage URLs and sampleActionCard for a single button', () => {
    const result = buildActionCardParam({
      buttons: [{ command: '/助手', label: 'Agents' }],
      text: 'pick one',
      title: 'Agents',
    });
    expect(result.msgKey).toBe('sampleActionCard');
    const param = JSON.parse(result.msgParam);
    expect(param.singleTitle).toBe('Agents');
    expect(param.singleURL).toBe(dtmdSendMessageUrl('/助手'));
    expect(param.singleURL).toContain('dtmd://dingtalkclient/sendMessage?content=');
    expect(param).not.toHaveProperty('actionTitle2');
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

  it('remembers outTrackId → asker/thread on create', async () => {
    const { clearDingTalkCards, getDingTalkCard } = await import('./threadId');
    clearDingTalkCards();
    const api = {
      createAndDeliverCard: async () => ({}),
    } as unknown as DingTalkApiClient;

    const stream = new DingTalkAiCardStream(api, {
      cardTemplateId: 'tpl',
      conversationId: 'cid_dm_1',
      outTrackId: 'out_fixed',
      robotCode: 'r',
      staffId: 'staff_1',
    });
    await stream.create();
    expect(getDingTalkCard('out_fixed')).toEqual({
      askerStaffId: 'staff_1',
      conversationId: 'cid_dm_1',
      conversationType: '1',
      threadId: 'dingtalk:cid_dm_1',
    });
  });

  it('does not remember a card when conversationId is empty even if openConversationId is set', async () => {
    const { clearDingTalkCards, getDingTalkCard } = await import('./threadId');
    clearDingTalkCards();
    const api = {
      createAndDeliverCard: async () => ({}),
    } as unknown as DingTalkApiClient;

    const stream = new DingTalkAiCardStream(api, {
      cardTemplateId: 'tpl',
      openConversationId: 'cid_open_group',
      outTrackId: 'out_open_only',
      robotCode: 'r',
      staffId: 'staff_1',
    });
    await stream.create();
    expect(getDingTalkCard('out_open_only')).toBeUndefined();
  });

  it('does not remember a card when staffId is empty', async () => {
    const { clearDingTalkCards, getDingTalkCard } = await import('./threadId');
    clearDingTalkCards();
    const api = {
      createAndDeliverCard: async () => ({}),
    } as unknown as DingTalkApiClient;

    const stream = new DingTalkAiCardStream(api, {
      cardTemplateId: 'tpl',
      conversationId: 'cid_dm_1',
      outTrackId: 'out_no_staff',
      robotCode: 'r',
      staffId: '',
    });
    await stream.create();
    expect(getDingTalkCard('out_no_staff')).toBeUndefined();
  });
});
