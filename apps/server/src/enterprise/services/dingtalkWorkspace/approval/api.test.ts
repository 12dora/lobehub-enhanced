// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
  }
}

vi.mock('../client', () => ({
  dingtalkWorkspaceRequest: (...args: unknown[]) => mockRequest(...args),
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => null,
}));

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));

const {
  addCommentAs,
  countPendingTasks,
  executeTaskAs,
  getFormSchema,
  getInstanceDetail,
  listVisibleTemplates,
  listRunningInstanceIds,
  parseTemplateSchema,
  redirectTaskAs,
  remapPremiumError,
  resetApprovalApiPaceForTest,
  saveFormTemplate,
} = await import('./api');

describe('approval api wrappers', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    resetApprovalApiPaceForTest({ maxRps: Number.POSITIVE_INFINITY });
    vi.useRealTimers();
  });

  it('executeTaskAs posts actionerUserId from the given staff id', async () => {
    mockRequest.mockResolvedValueOnce({ result: true, success: true });
    await executeTaskAs('staff-1', {
      processInstanceId: 'inst-1',
      result: 'agree',
      taskId: '99',
    });
    expect(mockRequest).toHaveBeenCalledWith({
      api: 'v1',
      body: {
        actionerUserId: 'staff-1',
        processInstanceId: 'inst-1',
        remark: undefined,
        result: 'agree',
        taskId: 99,
      },
      method: 'POST',
      path: '/v1.0/workflow/processInstances/execute',
    });
  });

  it('redirectTaskAs posts operateUserId and toUserId', async () => {
    mockRequest.mockResolvedValueOnce({ result: true });
    await redirectTaskAs('staff-1', { taskId: 8, toUserId: 'staff-2' });
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          operateUserId: 'staff-1',
          taskId: 8,
          toUserId: 'staff-2',
        }),
        path: '/v1.0/workflow/tasks/redirect',
      }),
    );
  });

  it('addCommentAs posts commentUserId', async () => {
    mockRequest.mockResolvedValueOnce({ result: true, success: true });
    await addCommentAs('staff-1', { processInstanceId: 'inst-1', text: '看过' });
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          commentUserId: 'staff-1',
          processInstanceId: 'inst-1',
          text: '看过',
        },
        path: '/v1.0/workflow/processInstances/comments',
      }),
    );
  });

  it('getInstanceDetail normalizes tasks and form values', async () => {
    mockRequest.mockResolvedValueOnce({
      result: {
        formComponentValues: [{ name: '事由', value: '出差' }],
        originatorUserId: 'u1',
        status: 'RUNNING',
        tasks: [{ status: 'RUNNING', taskId: 12, userId: 'u1' }],
        title: '请假',
      },
    });
    const detail = await getInstanceDetail('inst-1');
    expect(detail).toMatchObject({
      originatorUserId: 'u1',
      processInstanceId: 'inst-1',
      tasks: [{ status: 'RUNNING', taskId: '12', userId: 'u1' }],
      title: '请假',
    });
  });

  it('listRunningInstanceIds pages until nextToken is empty', async () => {
    mockRequest
      .mockResolvedValueOnce({ result: { list: ['a', 'b'], nextToken: '20' } })
      .mockResolvedValueOnce({ result: { list: ['c'], nextToken: '' } });
    await expect(listRunningInstanceIds('PROC-1', 1)).resolves.toEqual(['a', 'b', 'c']);
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[0][0].body).toMatchObject({
      maxResults: 20,
      processCode: 'PROC-1',
      startTime: 1,
      statuses: ['RUNNING'],
    });
  });

  it('listRunningInstanceIds passes max down so paging stops early', async () => {
    mockRequest.mockImplementation(async (req: { body: { maxResults: number } }) => ({
      result: {
        list: Array.from({ length: req.body.maxResults }, (_, index) => `id-${index}`),
        nextToken: '20',
      },
    }));
    const ids = await listRunningInstanceIds('PROC-1', 1, 25);
    expect(ids).toHaveLength(25);
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[0][0].body.maxResults).toBe(20);
    expect(mockRequest.mock.calls[1][0].body.maxResults).toBe(5);
  });

  it('getFormSchema copies format, unit and bizAlias from field props', async () => {
    mockRequest.mockResolvedValueOnce({
      result: {
        name: '请假',
        schemaContent: {
          items: [
            {
              componentName: 'DDDateField',
              props: {
                bizAlias: 'start_date',
                format: 'yyyy-MM-dd',
                id: 'Date_1',
                label: '开始日期',
                required: true,
              },
            },
            {
              componentName: 'MoneyField',
              props: { id: 'Money_1', label: '金额', unit: '元' },
            },
          ],
        },
      },
    });
    await expect(getFormSchema('PROC-1')).resolves.toMatchObject({
      fields: [
        {
          bizAlias: 'start_date',
          componentId: 'Date_1',
          componentType: 'DDDateField',
          format: 'yyyy-MM-dd',
          label: '开始日期',
          required: true,
        },
        {
          componentId: 'Money_1',
          componentType: 'MoneyField',
          label: '金额',
          unit: '元',
        },
      ],
      name: '请假',
      processCode: 'PROC-1',
    });
  });

  it('remapPremiumError turns forbidden into premium required', () => {
    expect(() => remapPremiumError(new DingtalkWorkspaceError('DINGTALK_FORBIDDEN'))).toThrow(
      DingtalkWorkspaceError,
    );
    try {
      remapPremiumError(new DingtalkWorkspaceError('DINGTALK_FORBIDDEN'));
    } catch (error) {
      expect((error as DingtalkWorkspaceError).code).toBe('DINGTALK_PREMIUM_REQUIRED');
    }
  });

  it('parseTemplateSchema decodes JSON-string options to human-readable values', () => {
    const schema = parseTemplateSchema('PROC-1', {
      result: {
        name: '合同',
        schemaContent: {
          items: [
            {
              componentName: 'DDSelectField',
              props: {
                id: 'Select_1',
                label: '公司',
                options: [
                  '{"value":"浙江捷发科技股份有限公司","key":"option_0"}',
                  '{"value":"杭州分公司","key":"option_1"}',
                  'plain-option',
                  { key: 'option_2', value: 'already-object' },
                ],
              },
            },
            {
              children: [
                {
                  componentName: 'DDSelectField',
                  props: {
                    id: 'Select_row',
                    label: '明细公司',
                    options: ['{"value":"浙江捷发科技股份有限公司","key":"option_0"}'],
                  },
                },
              ],
              componentName: 'TableField',
              props: { id: 'Table_1', label: '明细' },
            },
          ],
        },
      },
    });
    expect(schema.fields[0]).toMatchObject({
      options: ['浙江捷发科技股份有限公司', '杭州分公司', 'plain-option', 'already-object'],
      optionItems: [
        { key: 'option_0', value: '浙江捷发科技股份有限公司' },
        { key: 'option_1', value: '杭州分公司' },
        { value: 'plain-option' },
        { key: 'option_2', value: 'already-object' },
      ],
    });
    expect(schema.fields[1]?.children?.[0]).toMatchObject({
      componentId: 'Select_row',
      options: ['浙江捷发科技股份有限公司'],
      optionItems: [{ key: 'option_0', value: '浙江捷发科技股份有限公司' }],
    });
  });

  it('listVisibleTemplates keeps modified time when the payload has it', async () => {
    mockRequest.mockResolvedValueOnce({
      result: {
        nextToken: '',
        processList: [
          {
            gmtModified: '2026-09-01 12:00:00',
            name: '请假',
            processCode: 'PROC-1',
          },
        ],
      },
    });
    await expect(listVisibleTemplates('staff-1')).resolves.toEqual([
      {
        iconUrl: undefined,
        modifiedAt: '2026-09-01 12:00:00',
        name: '请假',
        processCode: 'PROC-1',
      },
    ]);
  });

  it('getInstanceDetail retries DINGTALK_RATE_LIMITED with unref backoff', async () => {
    vi.useFakeTimers();
    resetApprovalApiPaceForTest({ maxRps: Number.POSITIVE_INFINITY });
    mockRequest
      .mockRejectedValueOnce(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'))
      .mockResolvedValueOnce({
        result: {
          formComponentValues: [],
          originatorUserId: 'u1',
          status: 'RUNNING',
          tasks: [],
          title: '请假',
        },
      });
    const pending = getInstanceDetail('inst-1');
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toMatchObject({ processInstanceId: 'inst-1', title: '请假' });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('countPendingTasks reads GET todoTasks/numbers', async () => {
    mockRequest.mockResolvedValueOnce({ result: 0 });
    await expect(countPendingTasks('staff-1')).resolves.toBe(0);
    expect(mockRequest).toHaveBeenCalledWith({
      api: 'v1',
      method: 'GET',
      path: '/v1.0/workflow/processes/todoTasks/numbers',
      query: { userId: 'staff-1' },
    });
  });

  it('saveFormTemplate attaches a safe hint on DINGTALK_INVALID', async () => {
    mockRequest.mockRejectedValueOnce(
      new DingtalkWorkspaceError(
        'DINGTALK_INVALID',
        'formschema.error: DDDateField props.unit error',
      ),
    );
    try {
      await saveFormTemplate({
        formComponents: [{ componentType: 'DDDateField', props: { label: '日期' } }],
        name: '请假',
      });
      throw new Error('expected throw');
    } catch (error) {
      expect((error as { code: string }).code).toBe('DINGTALK_INVALID');
      expect((error as { hint?: string }).hint).toBe('DDDateField.unit');
      expect((error as Error).message).toBe('DINGTALK_INVALID');
    }
  });

  it('getInstanceDetail throws after three rate-limit retries', async () => {
    vi.useFakeTimers();
    resetApprovalApiPaceForTest({ maxRps: Number.POSITIVE_INFINITY });
    mockRequest.mockRejectedValue(new DingtalkWorkspaceError('DINGTALK_RATE_LIMITED'));
    const pending = getInstanceDetail('inst-1');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'DINGTALK_RATE_LIMITED' });
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
    expect(mockRequest).toHaveBeenCalledTimes(4);
  });
});
