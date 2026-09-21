// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();
const mockGet = vi.fn();
const mockList = vi.fn();
const mockListRuns = vi.fn();
const mockRemove = vi.fn();
const mockSetEnabled = vi.fn();
const mockUpdate = vi.fn();

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  readonly candidates?: unknown;
  constructor(code: string, extras?: { candidates?: unknown }) {
    super(code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
    this.candidates = extras?.candidates;
  }
}

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => ({})),
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/errors', () => ({
  DingtalkWorkspaceError,
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/approvalRules', () => ({
  DingtalkApprovalRuleService: vi.fn(() => ({
    create: mockCreate,
    get: mockGet,
    list: mockList,
    listRuns: mockListRuns,
    remove: mockRemove,
    setEnabled: mockSetEnabled,
    update: mockUpdate,
  })),
}));

const { dingtalkApprovalRuleRouter } = await import('../dingtalkApprovalRule');

const createCaller = () =>
  dingtalkApprovalRuleRouter.createCaller({ serverDB: {}, userId: 'user-1' } as never);

describe('dingtalkApprovalRuleRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards DINGTALK_AMBIGUOUS candidates without leaking upstream text', async () => {
    const candidates = [
      { deptPath: '安环部', name: '胡玉琴A', staffId: 's1' },
      { deptPath: '财务部', name: '胡玉琴A', staffId: 's2' },
    ];
    mockCreate.mockRejectedValueOnce(
      new DingtalkWorkspaceError('DINGTALK_AMBIGUOUS', { candidates }),
    );

    await expect(
      createCaller().create({
        action: 'agree',
        conditions: { match: 'all', originators: { staffIds: ['胡玉琴A'] } },
        name: '自动同意',
        processCode: 'PROC',
      }),
    ).rejects.toMatchObject({
      cause: { data: { candidates, code: 'DINGTALK_AMBIGUOUS' } },
      code: 'BAD_REQUEST',
      message: 'DINGTALK_AMBIGUOUS',
    });
  });
});
