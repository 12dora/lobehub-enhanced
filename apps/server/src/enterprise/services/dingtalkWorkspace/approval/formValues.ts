import { DingtalkWorkspaceError } from '../errors';
import type {
  EncodedFormComponentValue,
  FormValueInput,
  TemplateField,
  TemplateSchema,
} from './types';

/** Controls that cannot be set through the create-instance API. */
const UNSETTABLE_TYPES = new Set(['CalculateField', 'DDBizSuite', 'TextNote', 'TextNoteField']);

const JSON_ARRAY_TYPES = new Set([
  'DDAttachment',
  'DDDateRangeField',
  'DDMultiSelectField',
  'DDPhotoField',
  'InnerContactField',
  'RelateField',
  'TableField',
]);

const SUITE_BIZ_TYPE = /attendance|alitrip|finance|hrm|legal|payroll|trip/i;
const SUITE_COMPONENT_TYPES = new Set(['DDHolidayField', 'HolidayField', 'LeaveField']);

export const isUnsettledField = (field: TemplateField): boolean =>
  UNSETTABLE_TYPES.has(field.componentType) || field.hidden === true;

export const isSuiteTemplate = (schema: TemplateSchema): boolean => {
  if (schema.bizType && SUITE_BIZ_TYPE.test(schema.bizType)) return true;
  return schema.fields.some((field) => SUITE_COMPONENT_TYPES.has(field.componentType));
};

const isEmptyValue = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const stringifyJson = (value: unknown): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return JSON.stringify([trimmed]);
    }
  }
  return JSON.stringify(value);
};

const toDateOnly = (value: string): string => {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? value.trim();
};

const encodeScalar = (field: TemplateField, raw: unknown): string => {
  if (raw == null) return '';
  if (field.componentType === 'DepartmentField') {
    if (Array.isArray(raw)) return raw.map(String).join(',');
    return String(raw);
  }
  if (field.componentType === 'DDDateField' || field.componentType === 'DateField') {
    return toDateOnly(String(raw));
  }
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  return JSON.stringify(raw);
};

const encodeRangeName = (field: TemplateField): string => {
  if (field.children && field.children.length >= 2) {
    return JSON.stringify(field.children.slice(0, 2).map((child) => child.label));
  }
  const trimmed = field.label.trim();
  if (trimmed.startsWith('[')) return trimmed;
  return JSON.stringify([field.label, field.label]);
};

const encodeLocationName = (field: TemplateField): string => {
  const trimmed = field.label.trim();
  if (trimmed.startsWith('[')) return trimmed;
  return JSON.stringify(['当前时间', '当前地点']);
};

const parseMultiSelectValues = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return [value];
  }
};

const resolveOptionValue = (field: TemplateField, token: string): string => {
  if (field.options?.includes(token)) return token;
  const keyed = field.optionItems?.find((item) => item.key === token);
  return keyed?.value ?? token;
};

export const encodeFieldValue = (field: TemplateField, raw: unknown): EncodedFormComponentValue => {
  let name = field.label;
  let value: string;

  if (field.componentType === 'DDDateRangeField') {
    name = encodeRangeName(field);
    value = stringifyJson(raw);
  } else if (field.componentType === 'DDLocationField' || field.componentType === 'LocationField') {
    name = encodeLocationName(field);
    value = stringifyJson(raw);
  } else if (JSON_ARRAY_TYPES.has(field.componentType)) {
    value = stringifyJson(raw);
  } else {
    value = encodeScalar(field, raw);
  }

  if (
    (field.componentType === 'DDSelectField' || field.componentType === 'SelectField') &&
    ((field.options && field.options.length > 0) ||
      (field.optionItems && field.optionItems.length > 0))
  ) {
    value = resolveOptionValue(field, value);
    if (value && field.options && field.options.length > 0 && !field.options.includes(value)) {
      throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    }
  }

  if (
    field.componentType === 'DDMultiSelectField' &&
    ((field.options && field.options.length > 0) ||
      (field.optionItems && field.optionItems.length > 0))
  ) {
    const selected = parseMultiSelectValues(value).map((item) => resolveOptionValue(field, item));
    if (
      field.options &&
      field.options.length > 0 &&
      selected.some((item) => !field.options!.includes(item))
    ) {
      throw new DingtalkWorkspaceError('DINGTALK_INVALID');
    }
    value = JSON.stringify(selected);
  }

  return {
    componentType: field.componentType,
    id: field.componentId,
    name,
    value,
  };
};

const matchField = (schema: TemplateSchema, input: FormValueInput): TemplateField => {
  const componentId = input.componentId?.trim();
  const label = input.label?.trim();
  if (componentId) {
    const byId = schema.fields.find((field) => field.componentId === componentId);
    if (byId) return byId;
  }
  if (label) {
    const matches = schema.fields.filter((field) => field.label === label);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new DingtalkWorkspaceError('DINGTALK_AMBIGUOUS');
  }
  throw new DingtalkWorkspaceError('DINGTALK_INVALID');
};

export const encodeFormValues = (
  schema: TemplateSchema,
  inputs: FormValueInput[],
): EncodedFormComponentValue[] => {
  if (isSuiteTemplate(schema)) {
    throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  }

  const encoded: EncodedFormComponentValue[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const field = matchField(schema, input);
    if (isUnsettledField(field)) continue;
    if (seen.has(field.componentId)) continue;
    seen.add(field.componentId);
    if (isEmptyValue(input.value)) {
      if (field.required) throw new DingtalkWorkspaceError('DINGTALK_INVALID');
      continue;
    }
    encoded.push(encodeFieldValue(field, input.value));
  }

  for (const field of schema.fields) {
    if (isUnsettledField(field) || !field.required || seen.has(field.componentId)) continue;
    throw new DingtalkWorkspaceError('DINGTALK_INVALID');
  }

  return encoded;
};

export const formSummary = (
  values: Array<{ name?: string; value?: string }>,
  limit = 6,
): Array<{ label: string; value: string }> =>
  values
    .filter((item) => item.name && item.value)
    .slice(0, limit)
    .map((item) => ({ label: item.name!, value: item.value! }));
