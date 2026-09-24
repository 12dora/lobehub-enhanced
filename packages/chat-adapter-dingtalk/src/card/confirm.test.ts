import { afterEach, describe, expect, it, vi } from 'vitest';

import { DingTalkApiClient, type DingTalkApiClient as DingTalkApiClientType } from '../api';
import {
  buildDingTalkConfirmCardParamMap,
  buildDingTalkConfirmCardUpdateParamMap,
  buildDingTalkConfirmDeliverBody,
  DINGTALK_CONFIRM_ASKER_NOTE,
  DINGTALK_CONFIRM_LAST_MESSAGE_PREFIX,
  DINGTALK_CONFIRM_OVERFLOW_LINE,
  DINGTALK_CONFIRM_STATUS_TEXT,
  fitDingTalkConfirmCardContent,
  formatDingTalkConfirmCreateTime,
  parseDingTalkConfirmAction,
  sendDingTalkStreamConfirmCard,
  truncateCardParam,
  updateDingTalkConfirmCard,
} from './confirm';

describe('parseDingTalkConfirmAction', () => {
  it('reads params.action from a stream card callback', () => {
    const content = JSON.stringify({
      cardPrivateData: { actionIds: ['1'], params: { action: 'agree' } },
    });
    expect(parseDingTalkConfirmAction(content)).toBe('approve');
    expect(
      parseDingTalkConfirmAction({
        cardPrivateData: { params: { action: 'reject' } },
      }),
    ).toBe('reject');
  });

  it('keeps accepting the legacy approve action', () => {
    expect(
      parseDingTalkConfirmAction({
        cardPrivateData: { params: { action: 'approve' } },
      }),
    ).toBe('approve');
  });

  it('accepts button ids and Chinese labels', () => {
    expect(parseDingTalkConfirmAction({ cardPrivateData: { actionIds: ['approve'] } })).toBe(
      'approve',
    );
    expect(parseDingTalkConfirmAction({ cardPrivateData: { params: { action: '拒绝' } } })).toBe(
      'reject',
    );
  });

  it('ignores unrelated callbacks', () => {
    expect(parseDingTalkConfirmAction({ cardPrivateData: { params: { action: 'open' } } })).toBe(
      undefined,
    );
    expect(parseDingTalkConfirmAction('not-json')).toBeUndefined();
  });
});

describe('buildDingTalkConfirmDeliverBody', () => {
  it('uses STREAM callback and does not forward a group confirm card', () => {
    const body = buildDingTalkConfirmDeliverBody({
      card: { content: '创建模板「结案」', status: '待确认', title: '保存审批模板' },
      cardTemplateId: 'tpl-1',
      outTrackId: 'confirm-1',
      target: { openConversationId: 'cid', robotCode: 'robot', staffId: 'staff_1' },
    });
    expect(body.callbackType).toBe('STREAM');
    expect(body.cardTemplateId).toBe('tpl-1');
    expect(body.openSpaceId).toBe('dtv1.card//IM_GROUP.cid');
    expect(body.imGroupOpenSpaceModel).toEqual({ supportForward: false });
    expect(body.imRobotOpenDeliverModel).toBeUndefined();
  });

  it('delivers a 1:1 card to the requester', () => {
    const body = buildDingTalkConfirmDeliverBody({
      card: { content: 'x', status: '待确认', title: '操作' },
      cardTemplateId: 'tpl-1',
      outTrackId: 'confirm-1',
      target: { robotCode: 'robot', staffId: 'staff_1' },
    });
    expect(body.openSpaceId).toBe('dtv1.card//IM_ROBOT.staff_1');
    expect(body.imRobotOpenDeliverModel).toEqual({ robotCode: 'robot', spaceType: 'IM_ROBOT' });
  });

  it('truncates a card param under the DingTalk string limit', () => {
    expect(truncateCardParam('短')).toBe('短');
    expect([...truncateCardParam('字'.repeat(1000))].length).toBeLessThanOrEqual(900);
  });

  it('formats createTime as Asia/Shanghai YYYY-MM-DD HH:mm', () => {
    expect(formatDingTalkConfirmCreateTime(new Date('2026-09-24T00:30:00Z'))).toBe(
      '2026-09-24 08:30',
    );
    expect(formatDingTalkConfirmCreateTime(new Date('2026-09-23T16:00:00Z'))).toBe(
      '2026-09-24 00:00',
    );
  });

  it('fills the imported template variables and keeps 批准 available', () => {
    const map = buildDingTalkConfirmCardParamMap({
      content: '模板名称：结案',
      createTime: '2026-09-24 08:30',
      status: '待确认',
      title: '保存审批模板「项目结案申请」',
    });
    expect(map).toEqual({
      content: '模板名称：结案',
      createTime: '2026-09-24 08:30',
      lastMessage: `${DINGTALK_CONFIRM_LAST_MESSAGE_PREFIX}保存审批模板「项目结案申请」`,
      note: DINGTALK_CONFIRM_ASKER_NOTE,
      status: '',
      statusText: DINGTALK_CONFIRM_STATUS_TEXT.pending,
      title: '保存审批模板「项目结案申请」',
    });
    expect(map).not.toHaveProperty('allowApprove');
  });

  it('does not silently cut a long summary; the web line goes in note and 批准 stays ignored', () => {
    const link = 'https://chat.example.com/dingtalk/sso?redirect=%2Fagent%2Fagt%2Ftopic';
    const full = `选项：${'甲乙丙丁'.repeat(300)}`;
    const fitted = fitDingTalkConfirmCardContent(full, link);
    expect(fitted.allowApprove).toBe(false);
    expect(fitted.note).toBe(`${DINGTALK_CONFIRM_OVERFLOW_LINE}${link}`);
    expect(fitted.content).not.toContain(DINGTALK_CONFIRM_OVERFLOW_LINE);
    expect(fitted.content).toContain('甲乙丙丁');
    expect([...fitted.content].length).toBeLessThanOrEqual(900);
    expect(fitted.content).not.toMatch(/…$/);

    const map = buildDingTalkConfirmCardParamMap({
      content: full,
      createTime: '2026-09-24 08:30',
      status: '',
      title: '保存审批模板',
      webLink: link,
    });
    expect(map.allowApprove).toBeUndefined();
    expect(map.status).toBe('');
    expect(map.statusText).toBe(DINGTALK_CONFIRM_STATUS_TEXT.web);
    expect(map.note).toBe(`${DINGTALK_CONFIRM_OVERFLOW_LINE}${link}`);
    expect(map.content).not.toContain(DINGTALK_CONFIRM_OVERFLOW_LINE);
    expect(map.content).toContain('甲乙丙丁');
    expect([...map.content].length).toBeLessThanOrEqual(900);
  });

  it('maps terminal states onto agree/reject and updates only those keys', () => {
    expect(
      buildDingTalkConfirmCardUpdateParamMap({
        status: 'agree',
        statusText: DINGTALK_CONFIRM_STATUS_TEXT.approved,
      }),
    ).toEqual({
      status: 'agree',
      statusText: DINGTALK_CONFIRM_STATUS_TEXT.approved,
    });
    expect(
      buildDingTalkConfirmCardUpdateParamMap({
        status: '已失效',
        statusText: DINGTALK_CONFIRM_STATUS_TEXT.expired,
      }),
    ).toEqual({
      status: 'reject',
      statusText: DINGTALK_CONFIRM_STATUS_TEXT.expired,
    });
    expect(buildDingTalkConfirmCardUpdateParamMap({ status: 'rejected' })).toEqual({
      status: 'reject',
      statusText: DINGTALK_CONFIRM_STATUS_TEXT.rejected,
    });
    const expired = buildDingTalkConfirmCardUpdateParamMap({ status: 'expired' });
    expect(expired.status).toBe('reject');
    expect(expired.statusText).toBe(DINGTALK_CONFIRM_STATUS_TEXT.expired);
    expect(expired).not.toHaveProperty('content');
    expect(expired).not.toHaveProperty('title');
    expect(expired).not.toHaveProperty('lastMessage');
  });
});

const countingClient = () => {
  const seen: Array<{ method: string; url: string }> = [];
  const api = new DingTalkApiClient('app', 'secret', {
    onRequest: (info) => {
      seen.push(info);
    },
    tokenCache: {
      get: () => ({ expiresAt: Date.now() + 60_000, token: 'token' }),
      set: () => undefined,
    },
  });
  return { api, seen };
};

describe('sendDingTalkStreamConfirmCard', () => {
  const previous = process.env.DINGTALK_CONFIRM_CARD_TEMPLATE_ID;

  afterEach(() => {
    process.env.DINGTALK_CONFIRM_CARD_TEMPLATE_ID = previous;
    vi.restoreAllMocks();
  });

  it('does not call DingTalk when no template id is configured', async () => {
    delete process.env.DINGTALK_CONFIRM_CARD_TEMPLATE_ID;
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const api = {
      countedRequest: vi.fn(),
      getAccessToken: vi.fn(),
    } as unknown as DingTalkApiClientType;
    await expect(
      sendDingTalkStreamConfirmCard(api, {
        card: { content: '正文', status: '待确认', title: '标题' },
        outTrackId: 'confirm-1',
        target: { robotCode: 'robot', staffId: 'staff_1' },
      }),
    ).rejects.toThrow(/DINGTALK_CONFIRM_CARD_TEMPLATE_ID/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(api.countedRequest).not.toHaveBeenCalled();
    expect(api.getAccessToken).not.toHaveBeenCalled();
  });

  it('uses the env template when cardTemplateId is omitted or blank', async () => {
    process.env.DINGTALK_CONFIRM_CARD_TEMPLATE_ID = '  env-tpl  ';
    // A shared Response is consumed by the first call; the second send needs a fresh body.
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
    const { api } = countingClient();
    const card = { content: '正文', status: '待确认', title: '标题' };
    const target = { robotCode: 'robot', staffId: 'staff_1' };

    await sendDingTalkStreamConfirmCard(api, {
      card,
      outTrackId: 'confirm-env',
      target,
    });
    await sendDingTalkStreamConfirmCard(api, {
      card,
      cardTemplateId: '   ',
      outTrackId: 'confirm-blank',
      target,
    });

    const ids = fetchMock.mock.calls.map((call) => {
      const init = call[1];
      return (JSON.parse(String(init?.body)) as { cardTemplateId: string }).cardTemplateId;
    });
    expect(ids).toEqual(['env-tpl', 'env-tpl']);
  });

  it('prefers cardTemplateId over the env template', async () => {
    process.env.DINGTALK_CONFIRM_CARD_TEMPLATE_ID = 'env-tpl';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const { api } = countingClient();
    await sendDingTalkStreamConfirmCard(api, {
      card: { content: '正文', status: '待确认', title: '标题' },
      cardTemplateId: ' setting-tpl ',
      outTrackId: 'confirm-1',
      target: { robotCode: 'robot', staffId: 'staff_1' },
    });
    const init = fetchMock.mock.calls[0]?.[1];
    expect((JSON.parse(String(init?.body)) as { cardTemplateId: string }).cardTemplateId).toBe(
      'setting-tpl',
    );
  });

  it('posts one createAndDeliver with callbackType STREAM', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const { api, seen } = countingClient();
    await sendDingTalkStreamConfirmCard(api, {
      card: { content: '正文', status: '待确认', title: '标题' },
      cardTemplateId: 'tpl-1',
      outTrackId: 'confirm-1',
      target: { robotCode: 'robot', staffId: 'staff_1' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/v1.0/card/instances/createAndDeliver');
    expect(seen).toEqual([
      { method: 'POST', url: 'https://api.dingtalk.com/v1.0/card/instances/createAndDeliver' },
    ]);
    const body = JSON.parse(String(init?.body)) as {
      callbackType: string;
      cardData: { cardParamMap: Record<string, string> };
    };
    expect(body.callbackType).toBe('STREAM');
    expect(body.cardData.cardParamMap.status).toBe('');
    expect(body.cardData.cardParamMap.statusText).toBe(DINGTALK_CONFIRM_STATUS_TEXT.pending);
    expect(body.cardData.cardParamMap.note).toBe(DINGTALK_CONFIRM_ASKER_NOTE);
    expect(body.cardData.cardParamMap.lastMessage).toBe(
      `${DINGTALK_CONFIRM_LAST_MESSAGE_PREFIX}标题`,
    );
    expect(body.cardData.cardParamMap).not.toHaveProperty('allowApprove');
  });
});

describe('updateDingTalkConfirmCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('puts only the changed keys and sets updateCardDataByKey', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const { api, seen } = countingClient();
    await updateDingTalkConfirmCard(api, 'confirm-1', {
      status: 'agree',
      statusText: DINGTALK_CONFIRM_STATUS_TEXT.approved,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.dingtalk.com/v1.0/card/instances');
    expect(seen).toEqual([{ method: 'PUT', url: 'https://api.dingtalk.com/v1.0/card/instances' }]);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({
      cardData: {
        cardParamMap: {
          status: 'agree',
          statusText: DINGTALK_CONFIRM_STATUS_TEXT.approved,
        },
      },
      cardUpdateOptions: { updateCardDataByKey: true },
      outTrackId: 'confirm-1',
    });
  });
});
