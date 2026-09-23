import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { AmbiguousCandidate, SaveTemplateFieldProblem } from '../types';

export const DINGTALK_INTERNAL_TOOL_CONTENT =
  '钉钉审批操作失败（内部错误），请稍后重试。不要向用户展示技术细节。';

export const DINGTALK_ERROR_CODES = [
  'DINGTALK_AMBIGUOUS',
  'DINGTALK_AUTOMATION_OFF',
  'DINGTALK_FEATURE_DISABLED',
  'DINGTALK_FORBIDDEN',
  'DINGTALK_IDENTITY_INACTIVE',
  'DINGTALK_IDENTITY_UNBOUND',
  'DINGTALK_IDENTITY_UNVERIFIED',
  'DINGTALK_INVALID',
  'DINGTALK_NOT_APPROVAL_ADMIN',
  'DINGTALK_NOT_CONFIGURED',
  'DINGTALK_NOT_FOUND',
  'DINGTALK_NOT_ORIGINATOR',
  'DINGTALK_NOT_TASK_OWNER',
  'DINGTALK_PREMIUM_REQUIRED',
  'DINGTALK_RATE_LIMITED',
  'DINGTALK_RULE_LIMIT',
  'DINGTALK_UNAVAILABLE',
] as const;

export type DingtalkToolErrorCode = (typeof DINGTALK_ERROR_CODES)[number];

const KNOWN_CODES = new Set<string>(DINGTALK_ERROR_CODES);

export interface DingtalkToolFailure {
  candidates?: AmbiguousCandidate[];
  code: string;
  hint?: string;
  message: string;
  problems?: SaveTemplateFieldProblem[];
}

const compactJson = (value: unknown): string => JSON.stringify(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

const asCandidates = (value: unknown): AmbiguousCandidate[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const candidates: AmbiguousCandidate[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== 'string') continue;
    const staffId =
      typeof item.staffId === 'string'
        ? item.staffId
        : typeof item.staffToken === 'string'
          ? item.staffToken
          : undefined;
    if (!staffId) continue;
    candidates.push({
      deptPath: typeof item.deptPath === 'string' ? item.deptPath : undefined,
      leafDeptName: typeof item.leafDeptName === 'string' ? item.leafDeptName : undefined,
      name: item.name,
      staffId,
    });
  }
  return candidates.length > 0 ? candidates : undefined;
};

const pickFromRecord = (record: Record<string, unknown>, key: string): unknown => record[key];

export const extractDingtalkErrorCode = (error: unknown): string | undefined => {
  if (!isRecord(error)) {
    if (typeof error === 'string') {
      const match = error.match(/DINGTALK_[A-Z_]+/);
      return match?.[0];
    }
    return undefined;
  }

  const direct = pickFromRecord(error, 'code');
  if (typeof direct === 'string' && direct.startsWith('DINGTALK_')) return direct;

  const data = pickFromRecord(error, 'data');
  if (isRecord(data)) {
    const errorData = pickFromRecord(data, 'errorData');
    if (
      isRecord(errorData) &&
      typeof errorData.code === 'string' &&
      errorData.code.startsWith('DINGTALK_')
    ) {
      return errorData.code;
    }
    if (typeof data.code === 'string' && data.code.startsWith('DINGTALK_')) return data.code;
  }

  const cause = pickFromRecord(error, 'cause');
  if (isRecord(cause)) {
    const causeData = pickFromRecord(cause, 'data');
    if (
      isRecord(causeData) &&
      typeof causeData.code === 'string' &&
      causeData.code.startsWith('DINGTALK_')
    ) {
      return causeData.code;
    }
  }

  if (typeof error.message === 'string') {
    const match = error.message.match(/DINGTALK_[A-Z_]+/);
    if (match) return match[0];
  }

  return undefined;
};

const HINT_MAX_LEN = 200;

const isSafeHint = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > HINT_MAX_LEN) return false;
  if (/password|token=|secret|authorization|bearer\s|postgres:\/\//i.test(trimmed)) return false;
  if (/\bat\s+\S+\s+\(/.test(trimmed) || trimmed.includes('\n')) return false;
  return true;
};

const PROBLEM_ISSUE_ZH: Record<string, string> = {
  children: '不能包含子控件',
  content: '缺少说明文字',
  duplicate: '标签重复',
  formComponents: '表单控件数量不合法',
  label: '标签无效',
  labelLength: '标签超过 50 字',
  options: '选项无效',
  unit: '日期单位无效',
  unsupported: '不支持该控件',
};

const issueZh = (problem: SaveTemplateFieldProblem): string => {
  if (problem.issue === 'children' && problem.suggestion.startsWith('provide')) {
    return '明细表至少需要一列';
  }
  return PROBLEM_ISSUE_ZH[problem.issue] ?? problem.issue;
};

const suggestionZh = (problem: SaveTemplateFieldProblem): string => {
  if (problem.suggestion.startsWith('remove:')) return '请删除该控件，钉钉会自动生成流水号';
  if (problem.suggestion.startsWith('use ')) return `请改用 ${problem.suggestion.slice(4)}`;
  if (problem.suggestion.startsWith('split ')) return '请拆成独立控件';
  if (problem.issue === 'options') return '请提供至少 2 个选项';
  if (problem.issue === 'duplicate') return '请改用不同标签';
  if (problem.issue === 'labelLength') return '请将标签缩短到 50 字以内';
  if (problem.issue === 'formComponents') return '请将控件数量控制在 1–200';
  if (problem.issue === 'unit') return 'unit 只能是「天」或「小时」';
  if (problem.issue === 'content') return '请填写 content';
  if (problem.issue === 'label') return '请填写标签';
  if (problem.issue === 'children') {
    if (problem.suggestion.startsWith('omit')) return '请去掉 children';
    if (problem.suggestion.startsWith('remove nested')) return '明细表不能再嵌套明细表';
    if (problem.suggestion.startsWith('provide')) return '为明细表添加至少一个子控件';
    return problem.suggestion || '请去掉 children';
  }
  if (
    problem.componentType === 'CalculateField' ||
    problem.suggestion.startsWith('formulas are not available')
  ) {
    return '公式无法通过接口设置，请改用 MoneyField 或 NumberField，并在钉钉设计器中设置公式';
  }
  if (
    problem.componentType === 'RelateField' ||
    problem.suggestion.startsWith('not available via API')
  ) {
    return '关联审批单无法通过接口创建，请改用 TextField「关联立项单号」，并告诉用户在钉钉设计器中切换为关联审批单';
  }
  return problem.suggestion;
};

export const formatFormProblemLine = (problem: SaveTemplateFieldProblem): string => {
  const title = problem.label || problem.componentType || `字段${problem.index}`;
  const type = problem.componentType ? `（${problem.componentType}）` : '';
  const issue = issueZh(problem);
  const suggestion = suggestionZh(problem);
  return `[${problem.index}] ${title}${type}：${issue}；${suggestion}`;
};

const asProblem = (value: unknown): SaveTemplateFieldProblem | undefined => {
  if (!isRecord(value) || typeof value.index !== 'number' || !Number.isFinite(value.index)) {
    return undefined;
  }
  const issue = typeof value.issue === 'string' ? value.issue.trim() : '';
  if (!issue || !isSafeHint(issue)) return undefined;
  const suggestion = typeof value.suggestion === 'string' ? value.suggestion.trim() : '';
  if (suggestion && !isSafeHint(suggestion)) return undefined;
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  const componentType = typeof value.componentType === 'string' ? value.componentType.trim() : '';
  if (label && !isSafeHint(label)) return undefined;
  if (componentType && !isSafeHint(componentType)) return undefined;
  return {
    componentType,
    index: Math.trunc(value.index),
    issue,
    label,
    suggestion,
  };
};

const asProblems = (value: unknown): SaveTemplateFieldProblem[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const problems: SaveTemplateFieldProblem[] = [];
  for (const item of value) {
    const problem = asProblem(item);
    if (problem) problems.push(problem);
    if (problems.length >= 40) break;
  }
  return problems.length > 0 ? problems : undefined;
};

export const extractFormProblems = (error: unknown): SaveTemplateFieldProblem[] | undefined => {
  if (!isRecord(error)) return undefined;

  const direct = asProblems(error.problems);
  if (direct) return direct;

  const data = isRecord(error.data) ? error.data : undefined;
  if (data) {
    const fromErrorData = isRecord(data.errorData)
      ? asProblems(data.errorData.problems)
      : undefined;
    if (fromErrorData) return fromErrorData;
    const fromData = asProblems(data.problems);
    if (fromData) return fromData;
  }

  const cause = isRecord(error.cause) ? error.cause : undefined;
  if (cause && isRecord(cause.data)) {
    const fromCause = asProblems(cause.data.problems);
    if (fromCause) return fromCause;
  }

  return undefined;
};

export const extractInvalidHint = (error: unknown): string | undefined => {
  const take = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return isSafeHint(trimmed) ? trimmed : undefined;
  };

  if (!isRecord(error)) return undefined;

  const direct = take(error.hint);
  if (direct) return direct;

  const data = isRecord(error.data) ? error.data : undefined;
  if (data) {
    const fromErrorData = isRecord(data.errorData) ? take(data.errorData.hint) : undefined;
    if (fromErrorData) return fromErrorData;
    const fromData = take(data.hint);
    if (fromData) return fromData;
  }

  const cause = isRecord(error.cause) ? error.cause : undefined;
  if (cause && isRecord(cause.data)) {
    const fromCause = take(cause.data.hint);
    if (fromCause) return fromCause;
  }

  return undefined;
};

export const extractAmbiguousCandidates = (error: unknown): AmbiguousCandidate[] | undefined => {
  if (!isRecord(error)) return undefined;

  const direct = asCandidates(error.candidates);
  if (direct) return direct;

  const data = isRecord(error.data) ? error.data : undefined;
  if (data) {
    const fromErrorData = isRecord(data.errorData)
      ? asCandidates(data.errorData.candidates)
      : undefined;
    if (fromErrorData) return fromErrorData;
    const fromData = asCandidates(data.candidates);
    if (fromData) return fromData;
  }

  const cause = isRecord(error.cause) ? error.cause : undefined;
  if (cause && isRecord(cause.data)) {
    const fromCause = asCandidates(cause.data.candidates);
    if (fromCause) return fromCause;
  }

  return undefined;
};

const toStaffToken = (staffId: string): string =>
  staffId.startsWith('staff:') ? staffId : `staff:${staffId}`;

export const formatCandidateLabel = (candidate: AmbiguousCandidate): string => {
  const token = toStaffToken(candidate.staffId);
  const dept = candidate.leafDeptName || candidate.deptPath;
  return dept ? `${candidate.name} · ${dept}（${token}）` : `${candidate.name}（${token}）`;
};

const identityGuidance = '请让用户使用钉钉登录，或通过钉钉机器人完成绑定。管理员不能代为绑定。';

export const dingtalkErrorGuidance = (
  code: string,
  candidates?: AmbiguousCandidate[],
  hint?: string,
  problems?: SaveTemplateFieldProblem[],
): string => {
  switch (code) {
    case 'DINGTALK_NOT_CONFIGURED': {
      return '钉钉服务号未配置，无法使用审批（DINGTALK_NOT_CONFIGURED）。请联系管理员完成钉钉连接配置。';
    }
    case 'DINGTALK_FEATURE_DISABLED': {
      return '钉钉审批能力未开启（DINGTALK_FEATURE_DISABLED）。请联系管理员在连接器中启用审批。';
    }
    case 'DINGTALK_FORBIDDEN': {
      return '当前钉钉身份没有执行该操作的权限（DINGTALK_FORBIDDEN）。';
    }
    case 'DINGTALK_PREMIUM_REQUIRED': {
      return '该操作需要 OA 审批高级版（DINGTALK_PREMIUM_REQUIRED），例如退回、加签。请向用户说明，并改用标准能力或请管理员开通高级版。';
    }
    case 'DINGTALK_NOT_FOUND': {
      return '未找到对应的审批单、任务或模板（DINGTALK_NOT_FOUND）。请先调用 listPendingApprovals / listMyApplications / listTemplates 确认标识后再试。';
    }
    case 'DINGTALK_INVALID': {
      if (problems && problems.length > 0) {
        const list = problems.map(formatFormProblemLine).join('\n');
        return `请求参数无效（DINGTALK_INVALID）。请一次性修正以下全部问题后重试一次，不要重新 listTemplates、getTemplateSchema，也不要更换模板名称或重复创建。\n${list}`;
      }
      if (hint) {
        return `请求参数无效（DINGTALK_INVALID）。字段提示：${hint}。请只修正该字段后重试一次，不要重新 listTemplates、getTemplateSchema，也不要更换模板名称或重复创建。`;
      }
      return '请求参数无效（DINGTALK_INVALID）。请核对必填表单字段、人员 token 与模板限制；套件类模板无法通过接口发起。不要编造必填值。修正后只重试一次。';
    }
    case 'DINGTALK_RATE_LIMITED': {
      return '钉钉接口限流（DINGTALK_RATE_LIMITED）。请稍后重试，不要并行放大请求。';
    }
    case 'DINGTALK_UNAVAILABLE': {
      return '钉钉服务暂时不可用（DINGTALK_UNAVAILABLE）。请稍后重试。不要向用户展示技术细节。';
    }
    case 'DINGTALK_IDENTITY_UNBOUND': {
      return `当前账号尚未绑定钉钉身份（DINGTALK_IDENTITY_UNBOUND）。${identityGuidance}`;
    }
    case 'DINGTALK_IDENTITY_UNVERIFIED': {
      return `当前钉钉身份未经验证（DINGTALK_IDENTITY_UNVERIFIED）。${identityGuidance}`;
    }
    case 'DINGTALK_IDENTITY_INACTIVE': {
      return '钉钉通讯录中该成员已停用（DINGTALK_IDENTITY_INACTIVE），无法代其操作审批。';
    }
    case 'DINGTALK_NOT_TASK_OWNER': {
      return '当前用户不是该待办任务的处理人（DINGTALK_NOT_TASK_OWNER），不能同意、拒绝或转交。';
    }
    case 'DINGTALK_NOT_ORIGINATOR': {
      return '当前用户不是该审批单的发起人（DINGTALK_NOT_ORIGINATOR），不能撤销。';
    }
    case 'DINGTALK_NOT_APPROVAL_ADMIN': {
      return '当前用户不是钉钉审批管理员（DINGTALK_NOT_APPROVAL_ADMIN），不能创建或删除模板。';
    }
    case 'DINGTALK_AUTOMATION_OFF': {
      return '自动审批已关闭（DINGTALK_AUTOMATION_OFF），无法创建或执行规则。请联系管理员调整档位。';
    }
    case 'DINGTALK_RULE_LIMIT': {
      return '已达到自动审批规则数量上限（DINGTALK_RULE_LIMIT）。请先停用或删除现有规则后再创建。';
    }
    case 'DINGTALK_AMBIGUOUS': {
      const listed = (candidates ?? []).map(formatCandidateLabel);
      const roster = listed.length > 0 ? `候选：${listed.join('、')}。` : '';
      return `人员无法唯一确定（DINGTALK_AMBIGUOUS）。${roster}请列出候选「姓名 · 部门」请用户选择后再重试，不要猜测。将选中的 staff:<id> token 原样填入参数。`;
    }
    default: {
      return DINGTALK_INTERNAL_TOOL_CONTENT;
    }
  }
};

export const sanitizeDingtalkFailure = (
  error: unknown,
): { content: string; error: DingtalkToolFailure } => {
  const code = extractDingtalkErrorCode(error);
  const candidates = extractAmbiguousCandidates(error);
  const hint = code === 'DINGTALK_INVALID' ? extractInvalidHint(error) : undefined;
  const problems = code === 'DINGTALK_INVALID' ? extractFormProblems(error) : undefined;

  if (code && KNOWN_CODES.has(code)) {
    const content = dingtalkErrorGuidance(code, candidates, hint, problems);
    return {
      content,
      error: {
        code,
        message: content,
        ...(candidates ? { candidates } : {}),
        ...(hint ? { hint } : {}),
        ...(problems ? { problems } : {}),
      },
    };
  }

  console.error('[lobe-dingtalk-approval] failed', error);
  return {
    content: DINGTALK_INTERNAL_TOOL_CONTENT,
    error: { code: 'DINGTALK_INTERNAL', message: DINGTALK_INTERNAL_TOOL_CONTENT },
  };
};

export const dingtalkFailureResult = (error: unknown): BuiltinServerRuntimeOutput => {
  const sanitized = sanitizeDingtalkFailure(error);
  const payload = {
    code: sanitized.error.code,
    ...(sanitized.error.candidates ? { candidates: sanitized.error.candidates } : {}),
    ...(sanitized.error.hint ? { hint: sanitized.error.hint } : {}),
    ...(sanitized.error.problems ? { problems: sanitized.error.problems } : {}),
  };
  return {
    content: `${sanitized.content}\n${compactJson(payload)}`,
    error: sanitized.error,
    success: false,
  };
};
