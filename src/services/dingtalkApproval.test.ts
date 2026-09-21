import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { dingtalkApprovalService } from './dingtalkApproval';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    dingtalkApproval: {
      addApprover: { mutate: vi.fn() },
      approveTask: { mutate: vi.fn() },
      commentApproval: { mutate: vi.fn() },
      createApprovalRule: { mutate: vi.fn() },
      deleteApprovalRule: { mutate: vi.fn() },
      deleteTemplate: { mutate: vi.fn() },
      getApprovalDetail: { query: vi.fn() },
      getTemplateSchema: { query: vi.fn() },
      listApprovalRules: { query: vi.fn() },
      listMyApplications: { query: vi.fn() },
      listPendingApprovals: { query: vi.fn() },
      listTemplates: { query: vi.fn() },
      preview: { mutate: vi.fn() },
      refuseTask: { mutate: vi.fn() },
      returnTask: { mutate: vi.fn() },
      saveTemplate: { mutate: vi.fn() },
      searchDirectory: { query: vi.fn() },
      submitApproval: { mutate: vi.fn() },
      transferTask: { mutate: vi.fn() },
      updateApprovalRule: { mutate: vi.fn() },
      withdrawApplication: { mutate: vi.fn() },
    },
  },
}));

const approval = (lambdaClient as any).dingtalkApproval;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dingtalkApprovalService', () => {
  it('list helpers default to an empty query object', async () => {
    approval.listTemplates.query.mockResolvedValueOnce([]);
    approval.listPendingApprovals.query.mockResolvedValueOnce([]);
    approval.listApprovalRules.query.mockResolvedValueOnce([]);
    await dingtalkApprovalService.listTemplates();
    await dingtalkApprovalService.listPendingApprovals();
    await dingtalkApprovalService.listApprovalRules();
    expect(approval.listTemplates.query).toHaveBeenCalledWith({});
    expect(approval.listPendingApprovals.query).toHaveBeenCalledWith({});
    expect(approval.listApprovalRules.query).toHaveBeenCalledWith({});
  });

  it('forwards write mutations and preview', async () => {
    approval.approveTask.mutate.mockResolvedValueOnce({ result: true });
    approval.preview.mutate.mockResolvedValueOnce({
      actingAs: { name: '陈柠' },
      danger: false,
      lines: [],
      title: '同意',
      warnings: [],
    });
    await dingtalkApprovalService.approveTask({
      processInstanceId: 'pi-1',
      taskId: 't-1',
    });
    await dingtalkApprovalService.preview({
      apiName: 'approveTask',
      args: { processInstanceId: 'pi-1', taskId: 't-1' },
    });
    expect(approval.approveTask.mutate).toHaveBeenCalledWith({
      processInstanceId: 'pi-1',
      taskId: 't-1',
    });
    expect(approval.preview.mutate).toHaveBeenCalledWith({
      apiName: 'approveTask',
      args: { processInstanceId: 'pi-1', taskId: 't-1' },
    });
  });

  it('forwards searchDirectory params', async () => {
    approval.searchDirectory.query.mockResolvedValueOnce({ users: [] });
    await dingtalkApprovalService.searchDirectory({ kind: 'user', q: '安环' });
    expect(approval.searchDirectory.query).toHaveBeenCalledWith({ kind: 'user', q: '安环' });
  });

  it('forwards saveTemplate format, unit, and bizAlias', async () => {
    approval.saveTemplate.mutate.mockResolvedValueOnce({ notes: [], processCode: 'PROC' });
    const params = {
      fields: [
        {
          bizAlias: 'startDate',
          componentType: 'DDDateField',
          format: 'yyyy-MM-dd',
          label: '开始日期',
          required: true,
        },
        { componentType: 'MoneyField', label: '金额', unit: '元' },
      ],
      name: '费用报销',
    };
    await dingtalkApprovalService.saveTemplate(params);
    expect(approval.saveTemplate.mutate).toHaveBeenCalledWith(params);
  });
});
