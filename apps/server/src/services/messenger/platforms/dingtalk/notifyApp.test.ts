// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();

vi.mock('@/config/messenger', () => ({
  getMessengerDingTalkConfig: vi.fn(),
}));

vi.mock('@/server/enterprise/services/branding/runtimeBranding', () => ({
  resolveServerRuntimeBranding: vi.fn(),
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
  })),
}));

const { getMessengerDingTalkConfig } = await import('@/config/messenger');
const { resolveServerRuntimeBranding } =
  await import('@/server/enterprise/services/branding/runtimeBranding');
const {
  buildDirectoryReplaceAllInput,
  buildOaWorkNoticePayload,
  DINGTALK_ASYNCSEND_V2_URL,
  DINGTALK_DEPT_GET_URL,
  DINGTALK_DEPT_LISTSUB_URL,
  DINGTALK_NOTIFY_TOKEN_REDIS_KEY,
  DINGTALK_OA_HEAD_BGCOLOR,
  DINGTALK_OA_HEAD_TEXT_FALLBACK,
  DINGTALK_OAPI_GETTOKEN_URL,
  DINGTALK_USER_LIST_URL,
  DINGTALK_WORK_NOTICE_USERID_CHUNK,
  DingTalkNotifyAppError,
  fetchDirectoryReplaceAllInput,
  getNotifyAppToken,
  listDepartments,
  listDeptUsers,
  probeNotifyAppToken,
  readNotifyAppFromMessengerConfig,
  readNotifyAppFromProviderRow,
  resetNotifyAppStateForTest,
  resolveWorkNoticeHeadText,
  sendWorkNotice,
} = await import('./notifyApp');

const NOTIFY_APP = {
  agentId: '4617854001',
  appKey: 'notify-key',
  appSecret: 'notify-secret',
};

const jsonResponse = (body: unknown, status = 200) =>
  ({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as const;

const tokenFetch = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
  jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 }),
);

beforeEach(() => {
  resetNotifyAppStateForTest();
  vi.mocked(getMessengerDingTalkConfig).mockResolvedValue({ notifyApp: NOTIFY_APP } as never);
  mockRedisGet.mockReset().mockResolvedValue(null);
  mockRedisSet.mockReset().mockResolvedValue('OK');
  tokenFetch
    .mockReset()
    .mockImplementation(async () =>
      jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 }),
    );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('readNotifyAppFromMessengerConfig', () => {
  it('returns null unless appKey, appSecret, and agentId are all present', () => {
    expect(readNotifyAppFromMessengerConfig(null)).toBeNull();
    expect(
      readNotifyAppFromMessengerConfig({ notifyApp: { appKey: 'a', appSecret: 's' } }),
    ).toBeNull();
    expect(readNotifyAppFromMessengerConfig({ notifyApp: NOTIFY_APP })).toEqual(NOTIFY_APP);
  });
});

describe('readNotifyAppFromProviderRow', () => {
  it('reads notifyAppKey / notifyAgentId / notifyAppSecret', () => {
    expect(
      readNotifyAppFromProviderRow({
        credentials: { notifyAppSecret: 'secret' },
        settings: { notifyAgentId: '9', notifyAppKey: 'key' },
      }),
    ).toEqual({ agentId: '9', appKey: 'key', appSecret: 'secret' });
  });
});

describe('getNotifyAppToken', () => {
  it('calls oapi /gettoken with the notify app key/secret and caches ~100 min', async () => {
    const token = await getNotifyAppToken({ fetchImpl: tokenFetch, now: 1_000 });
    expect(token).toBe('tok');
    expect(tokenFetch).toHaveBeenCalledTimes(1);
    const calledUrl = String(tokenFetch.mock.calls[0]?.[0]);
    expect(calledUrl.startsWith(DINGTALK_OAPI_GETTOKEN_URL)).toBe(true);
    expect(calledUrl).toContain('appkey=notify-key');
    expect(calledUrl).toContain('appsecret=notify-secret');
    expect(mockRedisSet).toHaveBeenCalledWith(
      DINGTALK_NOTIFY_TOKEN_REDIS_KEY,
      expect.stringContaining('"token":"tok"'),
      'EX',
      expect.any(Number),
    );

    const again = await getNotifyAppToken({ fetchImpl: tokenFetch, now: 2_000 });
    expect(again).toBe('tok');
    expect(tokenFetch).toHaveBeenCalledTimes(1);
  });

  it('reuses a still-valid Redis token without refetching', async () => {
    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({ appKey: NOTIFY_APP.appKey, expiresAt: 50_000, token: 'cached' }),
    );
    const token = await getNotifyAppToken({ fetchImpl: tokenFetch, now: 1_000 });
    expect(token).toBe('cached');
    expect(tokenFetch).not.toHaveBeenCalled();
  });

  it('throws with errcode/errmsg when gettoken fails', async () => {
    tokenFetch.mockResolvedValueOnce(
      jsonResponse({ errcode: 40001, errmsg: 'invalid secret' }, 200),
    );
    await expect(
      getNotifyAppToken({ fetchImpl: tokenFetch, skipCache: true }),
    ).rejects.toMatchObject({
      errcode: 40001,
      errmsg: 'invalid secret',
      name: 'DingTalkNotifyAppError',
    });
  });
});

describe('probeNotifyAppToken', () => {
  it('returns ok when gettoken succeeds', async () => {
    const result = await probeNotifyAppToken({
      appKey: 'k',
      appSecret: 's',
      fetchImpl: tokenFetch,
    });
    expect(result).toMatchObject({ errorCode: null, ok: true, robotName: null });
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it('maps invalid secret to auth_failed', async () => {
    tokenFetch.mockResolvedValueOnce(
      jsonResponse({ errcode: 40001, errmsg: 'invalid appsecret' }, 200),
    );
    const result = await probeNotifyAppToken({
      appKey: 'bad',
      appSecret: 'bad',
      fetchImpl: tokenFetch,
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('auth_failed');
  });
});

describe('sendWorkNotice', () => {
  const fetchImpl = vi.fn();

  beforeEach(() => {
    fetchImpl.mockReset();
    fetchImpl.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      if (url.includes('/asyncsend_v2')) {
        return jsonResponse({ errcode: 0, errmsg: 'ok', task_id: 99_001 });
      }
      return jsonResponse({ errcode: 1, errmsg: 'unexpected' }, 400);
    });
  });

  it('sends action_card with single_url and records task_id', async () => {
    const result = await sendWorkNotice(
      {
        actionCard: {
          markdown: 'body',
          singleTitle: '打开',
          singleUrl: 'https://app.example.com/task/1',
          title: '提醒',
        },
        staffIds: ['staff_1'],
      },
      { fetchImpl },
    );

    expect(result).toEqual([{ taskId: '99001' }]);
    const call = fetchImpl.mock.calls.find((entry) => String(entry[0]).includes('/asyncsend_v2'));
    expect(String(call?.[0])).toContain(DINGTALK_ASYNCSEND_V2_URL);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      agent_id: 4_617_854_001,
      msg: {
        action_card: {
          markdown: 'body',
          single_title: '打开',
          single_url: 'https://app.example.com/task/1',
          title: '提醒',
        },
        msgtype: 'action_card',
      },
      userid_list: 'staff_1',
    });
  });

  it('sends markdown when there is no action card', async () => {
    await sendWorkNotice(
      { markdown: { text: 'body', title: '提醒' }, staffIds: ['staff_1'] },
      { fetchImpl },
    );
    const call = fetchImpl.mock.calls.find((entry) => String(entry[0]).includes('/asyncsend_v2'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      agent_id: 4_617_854_001,
      msg: { markdown: { text: 'body', title: '提醒' }, msgtype: 'markdown' },
      userid_list: 'staff_1',
    });
  });

  it('sends oa with head band, form, and optional message_url', async () => {
    const result = await sendWorkNotice(
      {
        oa: buildOaWorkNoticePayload({
          author: '张三',
          content: '交安全报告',
          form: [
            { key: '时间', value: '09:00' },
            { key: '来自', value: '张三' },
          ],
          headText: 'AI平台',
          title: '定时提醒',
        }),
        staffIds: ['staff_hyq'],
      },
      { fetchImpl },
    );

    expect(result).toEqual([{ taskId: '99001' }]);
    const call = fetchImpl.mock.calls.find((entry) => String(entry[0]).includes('/asyncsend_v2'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      agent_id: 4_617_854_001,
      msg: {
        msgtype: 'oa',
        oa: {
          body: {
            author: '张三',
            content: '交安全报告',
            form: [
              { key: '时间', value: '09:00' },
              { key: '来自', value: '张三' },
            ],
            title: '定时提醒',
          },
          head: { bgcolor: DINGTALK_OA_HEAD_BGCOLOR, text: 'AI平台' },
        },
      },
      userid_list: 'staff_hyq',
    });
  });

  it('includes message_url on oa for task-owner deep links', async () => {
    await sendWorkNotice(
      {
        oa: buildOaWorkNoticePayload({
          content: '运行完成',
          form: [
            { key: '任务', value: '报表' },
            { key: '时间', value: '09:00' },
          ],
          headText: 'AI 助手',
          messageUrl: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
          title: '任务已完成一次运行',
        }),
        staffIds: ['staff_1'],
      },
      { fetchImpl },
    );
    const call = fetchImpl.mock.calls.find((entry) => String(entry[0]).includes('/asyncsend_v2'));
    expect(JSON.parse(String(call?.[1]?.body)).msg).toEqual({
      msgtype: 'oa',
      oa: {
        body: {
          content: '运行完成',
          form: [
            { key: '任务', value: '报表' },
            { key: '时间', value: '09:00' },
          ],
          title: '任务已完成一次运行',
        },
        head: { bgcolor: DINGTALK_OA_HEAD_BGCOLOR, text: 'AI 助手' },
        message_url: 'https://app.example.com/dingtalk/sso?redirect=%2Ftask%2F1',
      },
    });
  });

  it(`chunks userid_list at ${DINGTALK_WORK_NOTICE_USERID_CHUNK}`, async () => {
    let task = 1;
    fetchImpl.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      task += 1;
      return jsonResponse({ errcode: 0, task_id: task });
    });
    const staffIds = Array.from({ length: 101 }, (_, index) => `u${index}`);
    const result = await sendWorkNotice(
      { markdown: { text: 'x', title: 't' }, staffIds },
      { fetchImpl },
    );
    const sendCalls = fetchImpl.mock.calls.filter((entry) =>
      String(entry[0]).includes('/asyncsend_v2'),
    );
    expect(sendCalls).toHaveLength(2);
    expect(JSON.parse(String(sendCalls[0]?.[1]?.body)).userid_list.split(',')).toHaveLength(100);
    expect(JSON.parse(String(sendCalls[1]?.[1]?.body)).userid_list.split(',')).toHaveLength(1);
    expect(result).toHaveLength(2);
  });

  it('throws with errcode/errmsg when a chunk fails', async () => {
    fetchImpl.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      return jsonResponse({ errcode: 88_001, errmsg: 'no permission' });
    });
    await expect(
      sendWorkNotice({ markdown: { text: 'x', title: 't' }, staffIds: ['a'] }, { fetchImpl }),
    ).rejects.toBeInstanceOf(DingTalkNotifyAppError);
    await expect(
      sendWorkNotice({ markdown: { text: 'x', title: 't' }, staffIds: ['a'] }, { fetchImpl }),
    ).rejects.toMatchObject({ errcode: 88_001, errmsg: 'no permission' });
  });
});

describe('directory fetch', () => {
  const fetchImpl = vi.fn();

  beforeEach(() => {
    fetchImpl.mockReset();
    fetchImpl.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url.includes('/gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0, expires_in: 7200 });
      }
      if (url.startsWith(DINGTALK_DEPT_GET_URL)) {
        return jsonResponse({
          errcode: 0,
          result: { dept_id: 1, name: '捷发科技', order: 0, parent_id: 0 },
        });
      }
      if (url.startsWith(DINGTALK_DEPT_LISTSUB_URL)) {
        if (body.dept_id === 1) {
          return jsonResponse({
            errcode: 0,
            result: [{ dept_id: 2, name: '捷发', order: 1, parent_id: 1 }],
          });
        }
        if (body.dept_id === 2) {
          return jsonResponse({
            errcode: 0,
            result: [{ dept_id: 3, name: '安环部', order: 2, parent_id: 2 }],
          });
        }
        return jsonResponse({ errcode: 0, result: [] });
      }
      if (url.startsWith(DINGTALK_USER_LIST_URL)) {
        if (body.dept_id === 3 && body.cursor === 0) {
          return jsonResponse({
            errcode: 0,
            result: {
              has_more: true,
              list: [
                {
                  active: true,
                  avatar: 'https://img.example/a.png',
                  dept_id_list: [2, 3],
                  name: '胡玉琴A',
                  unionid: 'union-1',
                  userid: 'hyq',
                },
              ],
              next_cursor: 100,
            },
          });
        }
        if (body.dept_id === 3 && body.cursor === 100) {
          return jsonResponse({
            errcode: 0,
            result: {
              has_more: false,
              list: [{ active: false, dept_id_list: [3], name: '已离职', userid: 'left' }],
            },
          });
        }
        if (body.dept_id === 2) {
          return jsonResponse({
            errcode: 0,
            result: {
              has_more: false,
              list: [
                {
                  active: true,
                  dept_id_list: [2, 3],
                  name: '胡玉琴A',
                  unionid: 'union-1',
                  userid: 'hyq',
                },
              ],
            },
          });
        }
        return jsonResponse({ errcode: 0, result: { has_more: false, list: [] } });
      }
      return jsonResponse({ errcode: 1, errmsg: 'unexpected' }, 400);
    });
  });

  it('walks listsub from dept 1 and loads the root name via department/get', async () => {
    const depts = await listDepartments({ fetchImpl });
    expect(depts.map((dept) => dept.deptId)).toEqual(['1', '2', '3']);
    expect(depts[0]).toMatchObject({ name: '捷发科技', parentId: null });
    expect(depts[2]).toMatchObject({ name: '安环部', parentId: '2' });
  });

  it('pages listDeptUsers with size 100', async () => {
    const users = await listDeptUsers('3', { fetchImpl });
    expect(users.map((user) => user.staffId)).toEqual(['hyq', 'left']);
    expect(users[1]?.active).toBe(false);
    const userListCalls = fetchImpl.mock.calls.filter((entry) =>
      String(entry[0]).startsWith(DINGTALK_USER_LIST_URL),
    );
    expect(userListCalls).toHaveLength(2);
    expect(JSON.parse(String(userListCalls[0]?.[1]?.body))).toMatchObject({
      cursor: 0,
      size: 100,
    });
  });

  it('maps replaceAll input: pinyin, path_names (root 1 skipped), leaf dept = longest path', async () => {
    const snapshot = await fetchDirectoryReplaceAllInput({
      fetchImpl,
      now: new Date('2026-09-16T04:00:00.000Z'),
    });
    const anHuan = snapshot.departments.find((dept) => dept.deptId === '3');
    expect(anHuan).toMatchObject({
      name: '安环部',
      pathNames: '捷发 / 安环部',
    });
    expect(anHuan?.namePinyinFull).toBeTruthy();
    expect(anHuan?.namePinyinInitials).toBeTruthy();
    expect(snapshot.departments.find((dept) => dept.deptId === '1')?.pathNames).toBe('');

    const hyq = snapshot.users.find((user) => user.staffId === 'hyq');
    expect(hyq).toMatchObject({
      active: true,
      avatar: 'https://img.example/a.png',
      deptPath: '捷发 / 安环部',
      leafDeptId: '3',
      leafDeptName: '安环部',
      name: '胡玉琴A',
      unionId: 'union-1',
    });
    expect(snapshot.memberships).toEqual(
      expect.arrayContaining([
        { deptId: '2', staffId: 'hyq' },
        { deptId: '3', staffId: 'hyq' },
        { deptId: '3', staffId: 'left' },
      ]),
    );
  });
});

describe('buildDirectoryReplaceAllInput', () => {
  it('picks the membership with the longest path as the leaf department', () => {
    const input = buildDirectoryReplaceAllInput({
      departments: [
        { deptId: '1', name: 'Root', parentId: null, sortOrder: 0 },
        { deptId: '2', name: '捷发', parentId: '1', sortOrder: 1 },
        { deptId: '3', name: '安环部', parentId: '2', sortOrder: 2 },
      ],
      now: new Date('2026-09-16T00:00:00.000Z'),
      usersByDept: [
        {
          deptId: '3',
          users: [
            {
              active: true,
              avatar: null,
              deptIds: ['2', '3'],
              name: '胡玉琴A',
              staffId: 'hyq',
              unionId: null,
            },
          ],
        },
      ],
    });
    expect(input.users[0]).toMatchObject({
      deptPath: '捷发 / 安环部',
      leafDeptId: '3',
      leafDeptName: '安环部',
    });
  });
});

describe('resolveWorkNoticeHeadText', () => {
  it('uses the published site title when it is set', async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: 'AI平台' } as never);
    expect(await resolveWorkNoticeHeadText()).toBe('AI平台');
  });

  it(`falls back to ${DINGTALK_OA_HEAD_TEXT_FALLBACK} when the site title is empty`, async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: '  ' } as never);
    expect(await resolveWorkNoticeHeadText()).toBe(DINGTALK_OA_HEAD_TEXT_FALLBACK);
  });

  it(`falls back to ${DINGTALK_OA_HEAD_TEXT_FALLBACK} when the name is the Latin AIHub brand`, async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: 'AIHub' } as never);
    expect(await resolveWorkNoticeHeadText()).toBe(DINGTALK_OA_HEAD_TEXT_FALLBACK);
  });

  it(`falls back to ${DINGTALK_OA_HEAD_TEXT_FALLBACK} when branding resolution throws`, async () => {
    vi.mocked(resolveServerRuntimeBranding).mockRejectedValueOnce(new Error('offline'));
    expect(await resolveWorkNoticeHeadText()).toBe(DINGTALK_OA_HEAD_TEXT_FALLBACK);
  });
});
