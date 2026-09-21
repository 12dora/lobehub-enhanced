import type { ApprovalRuleConditions, ApprovalRuleFieldOp } from '@lobechat/types';

/** Component types that accept numeric comparison ops. */
export const NUMERIC_COMPONENT_TYPES = new Set([
  'CalculateField',
  'MoneyField',
  'NumberField',
  'StarRatingField',
]);

/** Component types whose values are ISO / yyyy-MM-dd dates (or a date range). */
export const DATE_COMPONENT_TYPES = new Set(['DDDateField', 'DDDateRangeField']);

/** Text / select types that accept `contains` and `in`. */
export const TEXTUAL_COMPONENT_TYPES = new Set([
  'AddressField',
  'DDMultiSelectField',
  'DDSelectField',
  'DepartmentField',
  'InnerContactField',
  'PhoneField',
  'RelateField',
  'TextareaField',
  'TextField',
]);

const NUMERIC_OPS = new Set<ApprovalRuleFieldOp>(['gt', 'gte', 'lt', 'lte']);
const TEXTUAL_OPS = new Set<ApprovalRuleFieldOp>(['contains', 'in']);

export interface ApprovalMatchOriginator {
  /** Direct department ids plus ancestor ids (already expanded by the caller). */
  deptIds: string[];
  staffId: string;
}

export interface ApprovalMatchFormValue {
  componentId?: string;
  componentType?: string;
  label?: string;
  value?: string | null;
}

export interface ApprovalMatchInput {
  formValues: ApprovalMatchFormValue[];
  originator: ApprovalMatchOriginator;
}

/**
 * Whether `op` is valid for a template component type.
 * Numeric inequalities are NumberField / MoneyField / StarRatingField (and CalculateField).
 * Date inequalities are DDDateField / DDDateRangeField. `contains` / `in` are text and select.
 * `eq` / `ne` are accepted on every known type.
 */
export const fieldOpFitsComponentType = (
  op: ApprovalRuleFieldOp,
  componentType: string,
): boolean => {
  if (op === 'eq' || op === 'ne') return true;
  if (NUMERIC_OPS.has(op)) {
    return NUMERIC_COMPONENT_TYPES.has(componentType) || DATE_COMPONENT_TYPES.has(componentType);
  }
  if (TEXTUAL_OPS.has(op)) {
    return (
      TEXTUAL_COMPONENT_TYPES.has(componentType) ||
      NUMERIC_COMPONENT_TYPES.has(componentType) ||
      DATE_COMPONENT_TYPES.has(componentType)
    );
  }
  return false;
};

const asString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return JSON.stringify(value);
};

const looksJson = (raw: string): boolean => {
  const trimmed = raw.trim();
  return (
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  );
};

const tryParseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

/** Decode a DingTalk form value: JSON arrays/objects stay structured, otherwise the raw string. */
export const decodeFormValue = (raw: string | null | undefined): unknown => {
  if (raw === null || raw === undefined) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (!looksJson(trimmed)) return trimmed;
  return tryParseJson(trimmed);
};

const stripNumericNoise = (raw: string): string =>
  raw
    .trim()
    .replaceAll(',', '')
    .replace(/^[¥$€£￥]\s*/, '')
    .replace(/\s*(CNY|USD|EUR|GBP|RMB|元)$/i, '');

export const parseNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return parseNumberValue(value[0]);
  }
  if (typeof value === 'object') return null;
  const stripped = stripNumericNoise(String(value));
  if (!stripped) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(stripped)) return null;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
};

const toTime = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Date-only values compare as UTC midnight of that calendar day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const ms = Date.parse(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
};

export const parseDateValue = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return parseDateValue(value[0]);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (looksJson(trimmed)) {
    const decoded = tryParseJson(trimmed);
    if (decoded !== trimmed) return parseDateValue(decoded);
  }
  return toTime(trimmed);
};

const asStringList = (value: unknown): string[] => {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.map((item) => asString(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (looksJson(trimmed)) {
      const decoded = tryParseJson(trimmed);
      if (Array.isArray(decoded)) return asStringList(decoded);
    }
    return [trimmed];
  }
  return [asString(value).trim()].filter(Boolean);
};

const valuesEqual = (left: unknown, right: unknown): boolean => {
  const leftNumber = parseNumberValue(left);
  const rightNumber = parseNumberValue(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber;

  const leftDate = parseDateValue(left);
  const rightDate = parseDateValue(right);
  if (leftDate !== null && rightDate !== null) return leftDate === rightDate;

  const leftList = asStringList(left);
  const rightList = asStringList(right);
  if (leftList.length > 1 || rightList.length > 1 || Array.isArray(left) || Array.isArray(right)) {
    if (leftList.length !== rightList.length) return false;
    const rightSet = new Set(rightList);
    return leftList.every((item) => rightSet.has(item));
  }

  return asString(left).trim() === asString(right).trim();
};

const compareOrdered = (left: number, op: ApprovalRuleFieldOp, right: number): boolean => {
  switch (op) {
    case 'gt': {
      return left > right;
    }
    case 'gte': {
      return left >= right;
    }
    case 'lt': {
      return left < right;
    }
    case 'lte': {
      return left <= right;
    }
    default: {
      return false;
    }
  }
};

const matchFieldOp = (op: ApprovalRuleFieldOp, actual: unknown, expected: unknown): boolean => {
  switch (op) {
    case 'eq': {
      return valuesEqual(actual, expected);
    }
    case 'ne': {
      return !valuesEqual(actual, expected);
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const actualNumber = parseNumberValue(actual);
      const expectedNumber = parseNumberValue(expected);
      if (actualNumber !== null && expectedNumber !== null) {
        return compareOrdered(actualNumber, op, expectedNumber);
      }
      const actualDate = parseDateValue(actual);
      const expectedDate = parseDateValue(expected);
      if (actualDate === null || expectedDate === null) return false;
      return compareOrdered(actualDate, op, expectedDate);
    }
    case 'contains': {
      const needle = asString(expected).trim();
      if (!needle) return false;
      const list = asStringList(actual);
      if (list.length > 1 || Array.isArray(actual)) {
        return list.some((item) => item.includes(needle) || item === needle);
      }
      return asString(actual).includes(needle);
    }
    case 'in': {
      const expectedList = asStringList(expected);
      if (expectedList.length === 0) return false;
      const expectedSet = new Set(expectedList);
      const actualList = asStringList(actual);
      if (actualList.length === 0) return false;
      return actualList.some((item) => expectedSet.has(item));
    }
    default: {
      return false;
    }
  }
};

const findFormValue = (
  formValues: ApprovalMatchFormValue[],
  componentId: string,
  label: string,
): ApprovalMatchFormValue | undefined => {
  const byId = formValues.find((item) => item.componentId && item.componentId === componentId);
  if (byId) return byId;
  if (label) {
    const byLabel = formValues.find((item) => item.label && item.label === label);
    if (byLabel) return byLabel;
  }
  return undefined;
};

const originatorMatches = (
  conditions: ApprovalRuleConditions,
  originator: ApprovalMatchOriginator,
): boolean => {
  const staffIds = conditions.originators?.staffIds?.filter(Boolean) ?? [];
  const deptIds = conditions.originators?.deptIds?.filter(Boolean) ?? [];
  if (staffIds.length === 0 && deptIds.length === 0) return true;

  const staffHit = staffIds.length > 0 && staffIds.includes(originator.staffId);
  if (staffHit) return true;

  if (deptIds.length === 0) return false;
  const wanted = new Set(deptIds);
  return originator.deptIds.some((deptId) => wanted.has(deptId));
};

/**
 * Pure rule matcher. Unknown / unparseable fields fail closed (no match).
 * Originator department matching expects `originator.deptIds` to already include
 * ancestor departments (via `dingtalk_user_departments` + parent walk).
 */
export const matchApprovalRule = (
  conditions: ApprovalRuleConditions,
  input: ApprovalMatchInput,
): boolean => {
  if (conditions.match !== 'all') return false;
  if (!originatorMatches(conditions, input.originator)) return false;

  const fields = conditions.fields ?? [];
  for (const field of fields) {
    if (!field.componentId) return false;
    const formValue = findFormValue(input.formValues, field.componentId, field.label);
    if (!formValue) return false;
    const decoded = decodeFormValue(formValue.value);
    if (!matchFieldOp(field.op, decoded, field.value)) return false;
  }
  return true;
};
