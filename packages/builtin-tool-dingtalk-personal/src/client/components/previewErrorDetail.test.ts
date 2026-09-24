import { describe, expect, it } from 'vitest';

import { PREVIEW_ERROR_DETAIL_LIMIT, resolvePreviewErrorDetail } from './previewErrorDetail';

/** What the lambda error formatter hands the client: `cause.data` lands in `data.errorData`. */
const trpcError = (message: unknown) =>
  Object.assign(new Error('DINGTALK_PERSONAL_INVALID_ARGS'), {
    data: {
      code: 'BAD_REQUEST',
      errorData: { code: 'DINGTALK_PERSONAL_INVALID_ARGS', details: { message } },
      httpStatus: 400,
    },
  });

describe('resolvePreviewErrorDetail', () => {
  it('reads the reason and drops the 「参数无效（CODE）：」 lead-in', () => {
    expect(
      resolvePreviewErrorDetail(
        trpcError(
          '参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：内容过大（约 80 KB），请分成多次写入，每次不超过约 50 KB',
        ),
      ),
    ).toBe('内容过大（约 80 KB），请分成多次写入，每次不超过约 50 KB');
    expect(
      resolvePreviewErrorDetail(
        trpcError('参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：字段「预算」不在该数据表中'),
      ),
    ).toBe('字段「预算」不在该数据表中');
    expect(resolvePreviewErrorDetail(trpcError('参数无效：无法确认文档标题，不能发起确认'))).toBe(
      '无法确认文档标题，不能发起确认',
    );
  });

  it('keeps a reason that has no lead-in, minus any code', () => {
    expect(
      resolvePreviewErrorDetail(
        trpcError('range 不是合法的 A1 范围（DINGTALK_PERSONAL_INVALID_ARGS）'),
      ),
    ).toBe('range 不是合法的 A1 范围');
    expect(resolvePreviewErrorDetail(trpcError('参数无效的日期格式'))).toBe('参数无效的日期格式');
  });

  it('finds the details wherever the transport nested them', () => {
    expect(
      resolvePreviewErrorDetail({ cause: { data: { details: { message: '缺少内容' } } } }),
    ).toBe('缺少内容');
    expect(resolvePreviewErrorDetail({ details: { message: '缺少内容' } })).toBe('缺少内容');
    expect(
      resolvePreviewErrorDetail({
        shape: { data: { errorData: { details: { message: '缺少内容' } } } },
      }),
    ).toBe('缺少内容');
  });

  it('caps a long reason', () => {
    const detail = resolvePreviewErrorDetail(trpcError(`参数无效：${'很长的原因'.repeat(100)}`));

    expect(detail).toHaveLength(PREVIEW_ERROR_DETAIL_LIMIT);
    expect(detail?.endsWith('…')).toBe(true);
  });

  it('returns undefined when the error carries no readable reason', () => {
    expect(resolvePreviewErrorDetail(new Error('DINGTALK_PERSONAL_INVALID_ARGS'))).toBeUndefined();
    expect(
      resolvePreviewErrorDetail(trpcError('参数无效（DINGTALK_PERSONAL_INVALID_ARGS）')),
    ).toBeUndefined();
    expect(resolvePreviewErrorDetail(trpcError('参数无效'))).toBeUndefined();
    expect(resolvePreviewErrorDetail(trpcError(42))).toBeUndefined();
    expect(resolvePreviewErrorDetail(undefined)).toBeUndefined();
  });

  it('tolerates circular errors', () => {
    const error: Record<string, unknown> = { message: 'DINGTALK_PERSONAL_INVALID_ARGS' };
    error.cause = error;

    expect(resolvePreviewErrorDetail(error)).toBeUndefined();
  });
});
