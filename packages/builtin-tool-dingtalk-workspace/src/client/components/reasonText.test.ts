import { describe, expect, it } from 'vitest';

import {
  BATCH_ACTION_LABEL_LIMIT,
  toBatchActionHref,
  toBatchActionLabel,
  toReaderReason,
} from './reasonText';

const AUTH_URL = 'https://aihub.example.com/settings/connector?dingtalkPersonal=authorize';

describe('toReaderReason', () => {
  it('leaves a short user-facing reason alone', () => {
    expect(toReaderReason('待办已被删除')).toBe('待办已被删除');
    expect(toReaderReason('  未执行 ')).toBe('未执行');
  });

  it('strips every error code, wherever it sits', () => {
    expect(toReaderReason('钉钉接口限流（DINGTALK_RATE_LIMITED），请稍后重试。')).toBe(
      '钉钉接口限流，请稍后重试。',
    );
    expect(toReaderReason('参数无效 (VALIDATION)：缺少 taskIds')).toBe('参数无效：缺少 taskIds');
    expect(toReaderReason('请调整时间后重试。（DINGTALK_ROOM_UNAVAILABLE）')).toBe(
      '请调整时间后重试。',
    );
  });

  it('keeps human parentheses', () => {
    expect(toReaderReason('内容过大（约 80 KB），请分成多次写入')).toBe(
      '内容过大（约 80 KB），请分成多次写入',
    );
    expect(toReaderReason('不支持该文件类型（PDF）')).toBe('不支持该文件类型（PDF）');
  });

  it('drops the sentences written for the model', () => {
    expect(
      toReaderReason(
        '未找到该待办或日程（DINGTALK_NOT_FOUND）。请先 listTodos / listEvents 确认 id，且只能操作通过本工具创建的待办。',
      ),
    ).toBe('未找到该待办或日程。');
    expect(toReaderReason('操作失败（内部错误），请稍后重试。不要向用户展示技术细节。')).toBe(
      '操作失败（内部错误），请稍后重试。',
    );
  });

  it('keeps the link of a dropped sentence: it is the way out', () => {
    const legacy = `你还没有授权 AI 助手读取你的钉钉个人数据。请点击下方卡片的「授权」按钮，或打开： [点此前往授权](${AUTH_URL}) 授权后再问我一次即可。`;

    expect(toReaderReason(legacy)).toBe(
      `你还没有授权 AI 助手读取你的钉钉个人数据。[点此前往授权](${AUTH_URL})`,
    );
  });

  it('keeps a legacy link to the permission page next to a readable reason', () => {
    const href = 'https://open-dev.dingtalk.com/fe/app?corp=1#/corp/app/1/permission';
    const text = `没有权限执行该操作（DINGTALK_FORBIDDEN）。请联系管理员申请权限：[申请权限](${href})。`;

    expect(toReaderReason(text)).toBe(
      `没有权限执行该操作。请联系管理员申请权限：[申请权限](${href})。`,
    );
  });

  it('keeps every link of a dropped sentence, query strings included', () => {
    const other = 'https://aihub.example.com/settings/profile?tab=dingtalk&from=chat';
    const text = `请点击下方卡片的按钮，或打开 [去授权](${AUTH_URL}) 或 [去绑定](${other})！`;

    expect(toReaderReason(text)).toBe(`[去授权](${AUTH_URL}) [去绑定](${other})`);
  });

  it('returns undefined when nothing readable is left', () => {
    expect(toReaderReason('不要向用户展示技术细节。')).toBeUndefined();
    expect(toReaderReason('（DINGTALK_UNAVAILABLE）')).toBeUndefined();
    expect(toReaderReason('   ')).toBeUndefined();
    expect(toReaderReason(42)).toBeUndefined();
    expect(toReaderReason(undefined)).toBeUndefined();
  });
});

describe('toBatchActionHref', () => {
  it('accepts an absolute https URL', () => {
    const href = 'https://open-dev.dingtalk.com/fe/app#/corp/app/123/permission';

    expect(toBatchActionHref(href)).toBe(href);
    expect(toBatchActionHref(` ${AUTH_URL} `)).toBe(AUTH_URL);
  });

  it('accepts an allow-listed in-app path', () => {
    expect(toBatchActionHref('/settings/connector')).toBe('/settings/connector');
  });

  it.each([
    'http://open-dev.dingtalk.com/permission',
    'javascript:alert(1)',
    'data:text/html,hi',
    '//evil.example/path',
    'https://evil.example/a b',
    'https://evil.example/\n/x',
    '',
    undefined,
    123,
  ])('refuses %j', (value) => {
    expect(toBatchActionHref(value)).toBeUndefined();
  });
});

describe('toBatchActionLabel', () => {
  it('trims to one short line', () => {
    expect(toBatchActionLabel('  申请\n权限 ')).toBe('申请 权限');
    expect(toBatchActionLabel('去'.repeat(50))).toHaveLength(BATCH_ACTION_LABEL_LIMIT);
  });

  it('returns undefined for an empty or non-string label', () => {
    expect(toBatchActionLabel('  ')).toBeUndefined();
    expect(toBatchActionLabel(null)).toBeUndefined();
  });
});
