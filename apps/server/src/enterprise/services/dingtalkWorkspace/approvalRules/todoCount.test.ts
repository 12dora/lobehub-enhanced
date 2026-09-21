// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

class DingtalkWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'DingtalkWorkspaceError';
    this.code = code;
  }
}

const mockRequest = vi.fn();

vi.mock('../errors', () => ({ DingtalkWorkspaceError }));
vi.mock('../client', () => ({
  dingtalkWorkspaceRequest: (...args: unknown[]) => mockRequest(...args),
}));

const { getPendingApprovalTaskCount, parsePendingApprovalTaskCount } = await import('./todoCount');

describe('parsePendingApprovalTaskCount', () => {
  it('reads the live { result: number } shape', () => {
    expect(parsePendingApprovalTaskCount({ result: 3 })).toBe(3);
    expect(parsePendingApprovalTaskCount({ result: 0 })).toBe(0);
    expect(parsePendingApprovalTaskCount({ result: '4' })).toBe(4);
  });

  it('rejects an unparseable body', () => {
    expect(() => parsePendingApprovalTaskCount({})).toThrowError(
      expect.objectContaining({ code: 'DINGTALK_UNAVAILABLE' }),
    );
  });
});

describe('getPendingApprovalTaskCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls GET /v1.0/workflow/processes/todoTasks/numbers', async () => {
    mockRequest.mockResolvedValueOnce({ result: 2 });
    await expect(getPendingApprovalTaskCount('276329315736818882')).resolves.toBe(2);
    expect(mockRequest).toHaveBeenCalledWith({
      api: 'v1',
      method: 'GET',
      path: '/v1.0/workflow/processes/todoTasks/numbers',
      query: { userId: '276329315736818882' },
    });
  });
});
