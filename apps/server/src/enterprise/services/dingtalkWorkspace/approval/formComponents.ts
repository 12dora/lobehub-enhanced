import { DingtalkFormInvalidError } from './formError';
import type { SaveTemplateFieldInput, TemplateFieldOption } from './types';

export const MAX_FORM_COMPONENTS = 200;

const DATE_DAY_FORMAT = 'yyyy-MM-dd';
const DATE_HOUR_FORMAT = 'yyyy-MM-dd HH:mm';
const DEFAULT_RANGE_LABELS = ['开始时间', '结束时间'] as const;
const DEFAULT_LOCATION_LABELS = ['当前时间', '当前地点'] as const;

const TYPE_ALIASES: Record<string, string> = {
  Attachment: 'DDAttachment',
  AttachmentField: 'DDAttachment',
  DateField: 'DDDateField',
  DateRangeField: 'DDDateRangeField',
  MultiSelectField: 'DDMultiSelectField',
  PhotoField: 'DDPhotoField',
  SelectField: 'DDSelectField',
  TextNoteField: 'TextNote',
};

const SUPPORTED_TYPES = new Set([
  'AddressField',
  'DDAttachment',
  'DDDateField',
  'DDDateRangeField',
  'DDMultiSelectField',
  'DDPhotoField',
  'DDSelectField',
  'DepartmentField',
  'InnerContactField',
  'MoneyField',
  'NumberField',
  'PhoneField',
  'RelateField',
  'StarRatingField',
  'TableField',
  'TextareaField',
  'TextField',
  'TextNote',
  'TimeAndLocationField',
]);

const SELECT_TYPES = new Set(['DDSelectField', 'DDMultiSelectField']);
const DATE_TYPES = new Set(['DDDateField', 'DDDateRangeField']);

export interface EncodedFormComponent {
  children?: EncodedFormComponent[];
  componentType: string;
  props: Record<string, unknown>;
}

export interface NormalizedTemplateFieldSummary {
  componentType: string;
  label: string;
  required: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const trimString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const compactProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.length === 0) continue;
    out[key] = value;
  }
  return out;
};

const resolveComponentType = (raw: string): string => {
  const trimmed = raw.trim();
  return TYPE_ALIASES[trimmed] ?? trimmed;
};

const nextComponentId = (
  componentType: string,
  provided: string | undefined,
  used: Set<string>,
) => {
  const trimmed = provided?.trim();
  if (trimmed && !used.has(trimmed)) {
    used.add(trimmed);
    return trimmed;
  }
  let index = 1;
  let id = `${componentType}_${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${componentType}_${index}`;
  }
  used.add(id);
  return id;
};

const encodeJsonStringArray = (value: unknown, fallback: readonly string[]): string => {
  if (Array.isArray(value)) {
    const parts = value.map((item) => String(item).trim()).filter(Boolean);
    if (parts.length >= 2) return JSON.stringify(parts.slice(0, 2));
    if (parts.length === 1) return JSON.stringify([parts[0], parts[0]]);
    return JSON.stringify([...fallback]);
  }
  const text = trimString(value);
  if (!text) return JSON.stringify([...fallback]);
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const parts = parsed.map((item) => String(item).trim()).filter(Boolean);
        if (parts.length >= 2) return JSON.stringify(parts.slice(0, 2));
        if (parts.length === 1) return JSON.stringify([parts[0], parts[0]]);
      }
    } catch {
      // Treat as a plain label below.
    }
  }
  return JSON.stringify([text, text]);
};

const requireLabel = (componentType: string, label: unknown): string => {
  if (componentType === 'DDDateRangeField') {
    return encodeJsonStringArray(label, DEFAULT_RANGE_LABELS);
  }
  if (componentType === 'TimeAndLocationField') {
    return encodeJsonStringArray(label, DEFAULT_LOCATION_LABELS);
  }
  if (Array.isArray(label)) {
    throw new DingtalkFormInvalidError(`${componentType}.label`);
  }
  const text = trimString(label);
  if (!text) throw new DingtalkFormInvalidError(`${componentType}.label`);
  return text;
};

const displayLabel = (componentType: string, label: string): string => {
  if (componentType !== 'DDDateRangeField' && componentType !== 'TimeAndLocationField')
    return label;
  try {
    const parsed = JSON.parse(label) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(String).join(' / ');
    }
  } catch {
    return label;
  }
  return label;
};

const resolveDateUnitAndFormat = (
  componentType: string,
  unit: string | undefined,
  format: string | undefined,
): { format: string; unit: '天' | '小时' } => {
  const raw = unit?.trim();
  let resolved: '天' | '小时';
  if (!raw || raw === '天' || /^(?:day|days|d)$/i.test(raw)) resolved = '天';
  else if (raw === '小时' || /^(?:hour|hours|h|hr)$/i.test(raw)) resolved = '小时';
  else throw new DingtalkFormInvalidError(`${componentType}.unit`);

  const fmt = format?.trim();
  if (resolved === '小时') {
    return { format: fmt?.includes('HH') ? fmt : DATE_HOUR_FORMAT, unit: resolved };
  }
  return {
    format: fmt && !fmt.includes('HH') ? fmt : DATE_DAY_FORMAT,
    unit: resolved,
  };
};

const encodeOptionItem = (item: unknown, index: number): TemplateFieldOption | undefined => {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return encodeOptionItem(JSON.parse(trimmed) as unknown, index);
      } catch {
        return { key: `option_${index}`, value: trimmed };
      }
    }
    return { key: `option_${index}`, value: trimmed };
  }
  const record = asRecord(item);
  if (!record) return undefined;
  const value = trimString(record.value) ?? trimString(record.label) ?? trimString(record.key);
  if (!value) return undefined;
  return { key: trimString(record.key) ?? `option_${index}`, value };
};

const encodeSelectOptions = (componentType: string, options: unknown): TemplateFieldOption[] => {
  let list: unknown[] | undefined;
  if (typeof options === 'string') {
    const trimmed = options.trim();
    if (!trimmed) throw new DingtalkFormInvalidError(`${componentType}.options`);
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      throw new DingtalkFormInvalidError(`${componentType}.options`);
    }
  } else if (Array.isArray(options)) {
    list = options;
  }
  if (!list || list.length === 0) throw new DingtalkFormInvalidError(`${componentType}.options`);
  const encoded = list
    .map((item, index) => encodeOptionItem(item, index))
    .filter((item): item is TemplateFieldOption => Boolean(item));
  if (encoded.length === 0) throw new DingtalkFormInvalidError(`${componentType}.options`);
  return encoded.map((item, index) => ({
    key: item.key || `option_${index}`,
    value: item.value,
  }));
};

const defaultPlaceholder = (componentType: string): string | undefined => {
  switch (componentType) {
    case 'DepartmentField':
    case 'DDDateField':
    case 'DDDateRangeField':
    case 'DDMultiSelectField':
    case 'DDSelectField':
    case 'InnerContactField':
    case 'RelateField': {
      return '请选择';
    }
    case 'MoneyField': {
      return '请输入金额';
    }
    case 'NumberField': {
      return '请输入数字';
    }
    case 'PhoneField':
    case 'TextareaField':
    case 'TextField': {
      return '请输入';
    }
    case 'StarRatingField': {
      return '请输入';
    }
    default: {
      return undefined;
    }
  }
};

type EncodeContext = {
  count: { value: number };
  usedIds: Set<string>;
};

const assertCapacity = (ctx: EncodeContext): void => {
  if (ctx.count.value >= MAX_FORM_COMPONENTS) {
    throw new DingtalkFormInvalidError('formComponents');
  }
};

const encodeOne = (
  field: SaveTemplateFieldInput,
  ctx: EncodeContext,
  parentType?: string,
): { component: EncodedFormComponent; summary: NormalizedTemplateFieldSummary } => {
  assertCapacity(ctx);
  ctx.count.value += 1;

  const componentType = resolveComponentType(field.componentType);
  if (!SUPPORTED_TYPES.has(componentType)) {
    throw new DingtalkFormInvalidError(componentType || 'componentType');
  }
  if (parentType === 'TableField' && componentType === 'TableField') {
    throw new DingtalkFormInvalidError('TableField.children');
  }

  const required = field.required === true;
  const label =
    componentType === 'TextNote'
      ? (trimString(field.label) ?? '')
      : requireLabel(componentType, field.label);
  if (componentType !== 'TextNote' && !label) {
    throw new DingtalkFormInvalidError(`${componentType}.label`);
  }

  const componentId = nextComponentId(componentType, field.componentId, ctx.usedIds);
  const props: Record<string, unknown> = {
    bizAlias: trimString(field.bizAlias),
    componentId,
    label: componentType === 'TextNote' ? undefined : label,
    placeholder: trimString(field.placeholder) ?? defaultPlaceholder(componentType),
    required,
  };

  if (DATE_TYPES.has(componentType)) {
    const date = resolveDateUnitAndFormat(componentType, field.unit, field.format);
    props.unit = date.unit;
    props.format = date.format;
  } else {
    if (trimString(field.format)) props.format = field.format?.trim();
    if (trimString(field.unit)) props.unit = field.unit?.trim();
  }

  if (SELECT_TYPES.has(componentType)) {
    props.options = encodeSelectOptions(componentType, field.options);
  } else if (field.options != null && Array.isArray(field.options) && field.options.length > 0) {
    throw new DingtalkFormInvalidError(`${componentType}.options`);
  }

  if (componentType === 'MoneyField') {
    props.upper = '0';
  }
  if (componentType === 'InnerContactField') {
    props.choice = '0';
  }
  if (componentType === 'DepartmentField') {
    props.multiple = false;
  }
  if (componentType === 'PhoneField') {
    props.mode = 'phone';
  }
  if (componentType === 'AddressField') {
    props.addressModel = 'district';
  }
  if (componentType === 'StarRatingField') {
    props.limit = 5;
  }
  if (componentType === 'TableField') {
    props.tableViewMode = 'table';
  }
  if (componentType === 'TextNote') {
    const content = trimString(field.content) ?? trimString(field.label);
    if (!content) throw new DingtalkFormInvalidError('TextNote.content');
    props.content = content;
    delete props.required;
    delete props.placeholder;
  }

  let children: EncodedFormComponent[] | undefined;
  if (componentType === 'TableField') {
    const childInputs = field.children ?? [];
    if (childInputs.length === 0) throw new DingtalkFormInvalidError('TableField.children');
    children = childInputs.map((child) => encodeOne(child, ctx, componentType).component);
  } else if (field.children && field.children.length > 0) {
    throw new DingtalkFormInvalidError(`${componentType}.children`);
  }

  return {
    component: {
      children,
      componentType,
      props: compactProps(props),
    },
    summary: {
      componentType,
      label: displayLabel(componentType, label || trimString(field.content) || componentType),
      required,
    },
  };
};

export const encodeSaveTemplateFields = (
  fields: SaveTemplateFieldInput[],
): { components: EncodedFormComponent[]; fields: NormalizedTemplateFieldSummary[] } => {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new DingtalkFormInvalidError('formComponents');
  }
  const ctx: EncodeContext = { count: { value: 0 }, usedIds: new Set<string>() };
  const components: EncodedFormComponent[] = [];
  const summaries: NormalizedTemplateFieldSummary[] = [];
  for (const field of fields) {
    const encoded = encodeOne(field, ctx);
    components.push(encoded.component);
    summaries.push(encoded.summary);
  }
  return { components, fields: summaries };
};
