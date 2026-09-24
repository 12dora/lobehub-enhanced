import { APP_LINK_PATHS } from '@lobechat/utils/appLink';
import { describe, expect, it } from 'vitest';

import { dingtalkErrorGuidance, formatFormProblemLine } from './errors';

describe('formatFormProblemLine', () => {
  it('asks for a column when a detail table is empty', () => {
    const line = formatFormProblemLine({
      componentType: 'TableField',
      index: 0,
      issue: 'children',
      label: '费用明细',
      suggestion: 'provide at least one column',
    });
    expect(line).toBe('[0] 费用明细（TableField）：明细表至少需要一列；为明细表添加至少一个子控件');
    expect(line).not.toContain('不能包含子控件');
  });

  it('keeps nested-table and stray-children guidance consistent', () => {
    expect(
      formatFormProblemLine({
        componentType: 'TableField',
        index: 1,
        issue: 'children',
        label: '费用明细',
        suggestion: 'remove nested TableField',
      }),
    ).toContain('不能包含子控件；明细表不能再嵌套明细表');
    expect(
      formatFormProblemLine({
        componentType: 'TextField',
        index: 2,
        issue: 'children',
        label: '备注',
        suggestion: 'omit children on this type',
      }),
    ).toContain('不能包含子控件；请去掉 children');
  });

  it('translates CalculateField and RelateField suggestions into Chinese', () => {
    const calculate = formatFormProblemLine({
      componentType: 'CalculateField',
      index: 0,
      issue: 'unsupported',
      label: '合计',
      suggestion:
        'formulas are not available via API; use MoneyField or NumberField and set the formula in the DingTalk designer',
    });
    expect(calculate).toContain('不支持该控件');
    expect(calculate).toContain(
      '公式无法通过接口设置，请改用 MoneyField 或 NumberField，并在[钉钉管理后台](https://oa.dingtalk.com/)的审批设计器中设置公式',
    );
    expect(calculate).not.toContain('formulas are not available');

    const relate = formatFormProblemLine({
      componentType: 'RelateField',
      index: 1,
      issue: 'unsupported',
      label: '关联立项',
      suggestion:
        'not available via API; use a TextField "关联立项单号" and tell the user to switch it to 关联审批单 in the DingTalk designer',
    });
    expect(relate).toContain(
      '关联审批单无法通过接口创建，请改用 TextField「关联立项单号」，并告诉用户在[钉钉管理后台](https://oa.dingtalk.com/)的审批设计器中切换为关联审批单',
    );
    expect(relate).not.toContain('not available via API');
  });

  it('still translates option problems', () => {
    expect(
      formatFormProblemLine({
        componentType: 'DDSelectField',
        index: 1,
        issue: 'options',
        label: '转租类型',
        suggestion: 'provide at least 2 options',
      }),
    ).toContain('选项无效；请提供至少 2 个选项');
  });

  it('puts the empty-table wording in the model-facing error', () => {
    const content = dingtalkErrorGuidance('DINGTALK_INVALID', undefined, undefined, [
      {
        componentType: 'TableField',
        index: 0,
        issue: 'children',
        label: '费用明细',
        suggestion: 'provide at least one column',
      },
    ]);
    expect(content).toContain('明细表至少需要一列');
    expect(content).toContain('为明细表添加至少一个子控件');
  });

  it('puts a one-click link on every manual-action error', () => {
    const admin = `[IM 连接器设置](${APP_LINK_PATHS.adminImConnectors})`;
    const signIn = `[用钉钉登录](${APP_LINK_PATHS.dingtalkBinding})`;
    const oa = '[钉钉管理后台](https://oa.dingtalk.com/)';
    expect(dingtalkErrorGuidance('DINGTALK_NOT_CONFIGURED')).toContain('钉钉通知应用未配置');
    expect(dingtalkErrorGuidance('DINGTALK_NOT_CONFIGURED')).toContain('DINGTALK_NOT_CONFIGURED');
    expect(dingtalkErrorGuidance('DINGTALK_NOT_CONFIGURED')).toContain(admin);
    expect(dingtalkErrorGuidance('DINGTALK_FEATURE_DISABLED')).toContain(admin);
    expect(dingtalkErrorGuidance('DINGTALK_AUTOMATION_OFF')).toContain(admin);
    expect(dingtalkErrorGuidance('DINGTALK_IDENTITY_UNBOUND')).toContain(signIn);
    expect(dingtalkErrorGuidance('DINGTALK_IDENTITY_UNVERIFIED')).toContain('请先用钉钉登录本平台');
    expect(dingtalkErrorGuidance('DINGTALK_IDENTITY_INACTIVE')).toContain(oa);
    expect(dingtalkErrorGuidance('DINGTALK_NOT_APPROVAL_ADMIN')).toContain(
      '当前用户不是钉钉审批管理员',
    );
    expect(dingtalkErrorGuidance('DINGTALK_NOT_APPROVAL_ADMIN')).toContain(oa);
    expect(dingtalkErrorGuidance('DINGTALK_PREMIUM_REQUIRED')).toContain(oa);
    expect(dingtalkErrorGuidance('DINGTALK_RULE_LIMIT')).toContain(
      `[停用或删除现有规则](${APP_LINK_PATHS.approvalRules})`,
    );
    const dingtalk = dingtalkErrorGuidance(
      'DINGTALK_IDENTITY_UNBOUND',
      undefined,
      undefined,
      undefined,
      {
        platform: 'dingtalk',
        resolveLink: (path) =>
          `https://chat.example.com/dingtalk/sso?redirect=${encodeURIComponent(path)}`,
      },
    );
    expect(dingtalk).toContain('[用钉钉登录](https://chat.example.com/dingtalk/sso?redirect=%2F)');
    expect(dingtalk).not.toMatch(/\]\(<http/);
  });

  it('adds the DingTalk permission-apply link only for an open-dev URL', () => {
    const applyUrl = 'https://open-dev.dingtalk.com/appscope/apply?content=abc';
    const linked = dingtalkErrorGuidance(
      'DINGTALK_FORBIDDEN',
      undefined,
      undefined,
      undefined,
      undefined,
      applyUrl,
    );
    expect(linked).toContain(`[申请权限](${applyUrl})`);
    expect(dingtalkErrorGuidance('DINGTALK_FORBIDDEN')).toBe(
      '当前钉钉身份没有执行该操作的权限（DINGTALK_FORBIDDEN）。',
    );
    expect(
      dingtalkErrorGuidance(
        'DINGTALK_FORBIDDEN',
        undefined,
        undefined,
        undefined,
        undefined,
        'https://evil.example/phish',
      ),
    ).not.toContain('evil.example');
  });
});
