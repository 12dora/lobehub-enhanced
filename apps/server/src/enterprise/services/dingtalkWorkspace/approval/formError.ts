import { DingtalkWorkspaceError } from '../errors';

export interface FormComponentProblem {
  componentType: string;
  index: number;
  issue: string;
  label: string;
  suggestion: string;
}

/**
 * Forms-endpoint DINGTALK_INVALID with an optional self-correct hint
 * and the full pre-validation problem list. `hint` is only
 * `${ComponentType}.${prop}`, a component type, or a prop name — never
 * the raw DingTalk message.
 */
export class DingtalkFormInvalidError extends DingtalkWorkspaceError {
  readonly hint?: string;
  readonly problems?: FormComponentProblem[];

  constructor(hint?: string, problems?: readonly FormComponentProblem[]) {
    super('DINGTALK_INVALID');
    this.name = 'DingtalkFormInvalidError';
    if (hint) this.hint = hint;
    if (problems && problems.length > 0) this.problems = [...problems];
  }
}

const PROPS_ERROR_RE = /\b([A-Z][A-Z0-9]+)\s+props\.([A-Z][A-Z0-9]*)\s+error\b/i;
const MISSING_PROP_RE = /\bMissing\s*([A-Z][A-Z0-9]*)\b/i;
const RULE_ERROR_RE = /\b([A-Z][A-Z0-9]+Field)\s+rule error\b/i;

const toHint = (componentType: string | undefined, prop: string): string => {
  const trimmedProp = prop.trim();
  if (!trimmedProp) return componentType?.trim() || '';
  const normalizedProp = trimmedProp.charAt(0).toLowerCase() + trimmedProp.slice(1);
  const type = componentType?.trim();
  return type ? `${type}.${normalizedProp}` : normalizedProp;
};

export const problemHint = (problem: FormComponentProblem): string => {
  if (problem.issue === 'unsupported') return problem.componentType || 'componentType';
  if (problem.issue === 'formComponents') return 'formComponents';
  if (problem.componentType && problem.issue) return `${problem.componentType}.${problem.issue}`;
  return problem.issue || problem.componentType || 'formComponents';
};

/** Extract a safe forms hint from a DingTalk 400 message. Never returns the raw text. */
export const parseFormErrorHint = (text: unknown): string | undefined => {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const propsMatch = text.match(PROPS_ERROR_RE);
  if (propsMatch?.[1] && propsMatch[2]) return toHint(propsMatch[1], propsMatch[2]);
  const missingMatch = text.match(MISSING_PROP_RE);
  if (missingMatch?.[1]) return toHint(undefined, missingMatch[1]);
  const ruleMatch = text.match(RULE_ERROR_RE);
  if (ruleMatch?.[1]) return ruleMatch[1];
  return undefined;
};

const collectErrorText = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['message', 'upstreamCode', 'upstreamMessage', 'hint'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) parts.push(value);
  }
  const cause = record.cause;
  if (typeof cause === 'string' && cause.trim()) parts.push(cause);
  else if (cause instanceof Error && cause.message) parts.push(cause.message);
  return parts.join('\n');
};

export const remapFormsInvalidError: (error: unknown) => never = (error) => {
  if (error instanceof DingtalkFormInvalidError) throw error;
  if (error instanceof DingtalkWorkspaceError && error.code === 'DINGTALK_INVALID') {
    throw new DingtalkFormInvalidError(parseFormErrorHint(collectErrorText(error)));
  }
  throw error;
};
