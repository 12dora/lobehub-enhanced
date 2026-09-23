import { DingtalkFormInvalidError, type FormComponentProblem, problemHint } from './formError';
import type { SaveTemplateFieldInput, TemplateFieldOption } from './types';

export const MAX_FORM_COMPONENTS = 200;
export const MAX_FIELD_LABEL_LENGTH = 50;
export const MIN_SELECT_OPTIONS = 2;

const DATE_DAY_FORMAT = 'yyyy-MM-dd';
const DATE_HOUR_FORMAT = 'yyyy-MM-dd HH:mm';
const DEFAULT_RANGE_LABELS = ['开始时间', '结束时间'] as const;

const TYPE_ALIASES: Record<string, string> = {
  Attachment: 'DDAttachment',
  AttachmentField: 'DDAttachment',
  DateField: 'DDDateField',
  DateRangeField: 'DDDateRangeField',
  MultiSelectField: 'DDMultiSelectField',
  PhotoField: 'DDPhotoField',
  SelectField: 'DDSelectField',
  SerialNumberField: 'SeqNumberField',
  SequenceNumberField: 'SeqNumberField',
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
  'IdCardField',
  'InnerContactField',
  'MoneyField',
  'NumberField',
  'PhoneField',
  'StarRatingField',
  'TableField',
  'TextareaField',
  'TextField',
  'TextNote',
]);

const SERIAL_TYPES = new Set(['SeqNumberField']);

const SERIAL_LABEL_RE = /^(?:流水号|编号|序号)$/u;

const CLOSEST_SUPPORTED: Record<string, string> = {
  CalculateField:
    'formulas are not available via API; use MoneyField or NumberField and set the formula in the DingTalk designer',
  RecipientAccountField: 'use TextField',
  RelateField:
    'not available via API; use a TextField "关联立项单号" and tell the user to switch it to 关联审批单 in the DingTalk designer',
  TimeAndLocationField: 'use DDDateField',
};

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
    if (parts.length === 1) return JSON.stringify([`${parts[0]}开始`, `${parts[0]}结束`]);
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
        if (parts.length === 1) return JSON.stringify([`${parts[0]}开始`, `${parts[0]}结束`]);
      }
    } catch {
      // Treat as a plain label below.
    }
  }
  return JSON.stringify([`${text}开始`, `${text}结束`]);
};

const labelPartsForLength = (componentType: string, label: unknown): string[] => {
  if (componentType === 'DDDateRangeField') {
    if (Array.isArray(label)) {
      return label.map((item) => String(item).trim()).filter(Boolean);
    }
    const text = trimString(label);
    if (!text) return [];
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {
        return [text];
      }
    }
    return [text];
  }
  if (Array.isArray(label)) return label.map((item) => String(item).trim()).filter(Boolean);
  const text = trimString(label);
  return text ? [text] : [];
};

const plainLabelText = (componentType: string, label: unknown): string =>
  labelPartsForLength(componentType, label).join(' / ');

const requireLabel = (componentType: string, label: unknown): string | undefined => {
  if (componentType === 'DDDateRangeField') {
    return encodeJsonStringArray(label, DEFAULT_RANGE_LABELS);
  }
  if (Array.isArray(label)) return undefined;
  return trimString(label);
};

const displayLabel = (componentType: string, label: string): string => {
  if (componentType !== 'DDDateRangeField') return label;
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
  unit: string | undefined,
  format: string | undefined,
): { format: string; unit: '天' | '小时' } | undefined => {
  const raw = unit?.trim();
  let resolved: '天' | '小时';
  if (!raw || raw === '天' || /^(?:day|days|d)$/i.test(raw)) resolved = '天';
  else if (raw === '小时' || /^(?:hour|hours|h|hr)$/i.test(raw)) resolved = '小时';
  else return undefined;

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

const encodeSelectOptions = (options: unknown): TemplateFieldOption[] | undefined => {
  let list: unknown[] | undefined;
  if (typeof options === 'string') {
    const trimmed = options.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return undefined;
    }
  } else if (Array.isArray(options)) {
    list = options;
  }
  if (!list || list.length === 0) return undefined;
  const encoded = list
    .map((item, index) => encodeOptionItem(item, index))
    .filter((item): item is TemplateFieldOption => Boolean(item));
  if (encoded.length === 0) return undefined;
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
    case 'InnerContactField': {
      return '请选择';
    }
    case 'MoneyField': {
      return '请输入金额';
    }
    case 'NumberField': {
      return '请输入数字';
    }
    case 'IdCardField':
    case 'PhoneField':
    case 'StarRatingField':
    case 'TextareaField':
    case 'TextField': {
      return '请输入';
    }
    default: {
      return undefined;
    }
  }
};

const unsupportedSuggestion = (componentType: string): string => {
  if (SERIAL_TYPES.has(componentType)) return 'remove: DingTalk generates it';
  return CLOSEST_SUPPORTED[componentType] ?? 'use TextField';
};

type EncodeContext = {
  count: { value: number };
  overCapacity: boolean;
  problems: FormComponentProblem[];
  seenLabels: Map<string, number>;
  usedIds: Set<string>;
};

const recordProblem = (
  ctx: EncodeContext,
  index: number,
  componentType: string,
  label: string,
  issue: string,
  suggestion: string,
): void => {
  ctx.problems.push({
    componentType,
    index,
    issue,
    label,
    suggestion,
  });
};

const throwCollected: (problems: FormComponentProblem[]) => never = (problems) => {
  const first = problems[0];
  throw new DingtalkFormInvalidError(first ? problemHint(first) : 'formComponents', problems);
};

const encodeOne = (
  field: SaveTemplateFieldInput,
  ctx: EncodeContext,
  index: number,
  parentType?: string,
): { component: EncodedFormComponent; summary: NormalizedTemplateFieldSummary } | undefined => {
  ctx.count.value += 1;
  if (ctx.count.value > MAX_FORM_COMPONENTS && !ctx.overCapacity) {
    ctx.overCapacity = true;
    recordProblem(
      ctx,
      index,
      resolveComponentType(field.componentType),
      plainLabelText(resolveComponentType(field.componentType), field.label),
      'formComponents',
      'keep at most 200 components',
    );
  }

  const componentType = resolveComponentType(field.componentType);
  const previewLabel =
    plainLabelText(componentType, field.label) || trimString(field.content) || '';
  const isSerial = SERIAL_TYPES.has(componentType) || SERIAL_LABEL_RE.test(previewLabel);
  const supported = SUPPORTED_TYPES.has(componentType);

  if (isSerial) {
    recordProblem(
      ctx,
      index,
      componentType || 'SeqNumberField',
      previewLabel,
      'unsupported',
      'remove: DingTalk generates it',
    );
  } else if (!supported) {
    recordProblem(
      ctx,
      index,
      componentType || 'componentType',
      previewLabel,
      'unsupported',
      unsupportedSuggestion(componentType),
    );
  }

  if (parentType === 'TableField' && componentType === 'TableField') {
    recordProblem(ctx, index, componentType, previewLabel, 'children', 'remove nested TableField');
  }

  if (componentType !== 'TextNote') {
    for (const part of labelPartsForLength(componentType, field.label)) {
      if (part.length > MAX_FIELD_LABEL_LENGTH) {
        recordProblem(
          ctx,
          index,
          componentType,
          previewLabel.slice(0, MAX_FIELD_LABEL_LENGTH),
          'labelLength',
          'keep label ≤50 characters',
        );
        break;
      }
    }
  }

  if (previewLabel && componentType !== 'TextNote') {
    if (ctx.seenLabels.has(previewLabel)) {
      recordProblem(ctx, index, componentType, previewLabel, 'duplicate', 'use a distinct label');
    } else {
      ctx.seenLabels.set(previewLabel, index);
    }
  }

  const required = field.required === true;
  const label =
    componentType === 'TextNote'
      ? (trimString(field.label) ?? '')
      : requireLabel(componentType, field.label);
  if (componentType !== 'TextNote' && supported && !isSerial && !label) {
    recordProblem(ctx, index, componentType, previewLabel, 'label', 'provide a non-empty label');
  }

  if (SELECT_TYPES.has(componentType)) {
    const options = encodeSelectOptions(field.options);
    if (!options || options.length < MIN_SELECT_OPTIONS) {
      recordProblem(
        ctx,
        index,
        componentType,
        previewLabel,
        'options',
        'provide at least 2 options',
      );
    }
  } else if (field.options != null && Array.isArray(field.options) && field.options.length > 0) {
    recordProblem(ctx, index, componentType, previewLabel, 'options', 'omit options on this type');
  }

  if (DATE_TYPES.has(componentType)) {
    const date = resolveDateUnitAndFormat(field.unit, field.format);
    if (!date) {
      recordProblem(ctx, index, componentType, previewLabel, 'unit', 'use 天 or 小时');
    }
  }

  if (componentType === 'TextNote') {
    const content = trimString(field.content) ?? trimString(field.label);
    if (!content) {
      recordProblem(ctx, index, componentType, previewLabel, 'content', 'provide TextNote content');
    }
  }

  if (componentType === 'TableField') {
    const childInputs = field.children ?? [];
    if (childInputs.length === 0) {
      recordProblem(
        ctx,
        index,
        componentType,
        previewLabel,
        'children',
        'provide at least one column',
      );
    }
  } else if (field.children && field.children.length > 0) {
    recordProblem(
      ctx,
      index,
      componentType,
      previewLabel,
      'children',
      'omit children on this type',
    );
  }

  const skipEncode = isSerial || !supported;
  if (componentType === 'TableField' && field.children && field.children.length > 0) {
    const children: EncodedFormComponent[] = [];
    for (const child of field.children) {
      const encodedChild = encodeOne(child, ctx, index, componentType);
      if (encodedChild) children.push(encodedChild.component);
    }
    if (skipEncode) return undefined;
    const componentId = nextComponentId(componentType, field.componentId, ctx.usedIds);
    return {
      component: {
        children,
        componentType,
        props: compactProps({
          bizAlias: trimString(field.bizAlias),
          componentId,
          label,
          placeholder: trimString(field.placeholder) ?? defaultPlaceholder(componentType),
          required,
          tableViewMode: 'table',
        }),
      },
      summary: {
        componentType,
        label: displayLabel(componentType, label || previewLabel || componentType),
        required,
      },
    };
  }

  if (skipEncode) return undefined;

  const componentId = nextComponentId(componentType, field.componentId, ctx.usedIds);
  const props: Record<string, unknown> = {
    bizAlias: trimString(field.bizAlias),
    componentId,
    label: componentType === 'TextNote' ? undefined : label,
    placeholder: trimString(field.placeholder) ?? defaultPlaceholder(componentType),
    required,
  };

  if (DATE_TYPES.has(componentType)) {
    const date = resolveDateUnitAndFormat(field.unit, field.format) ?? {
      format: DATE_DAY_FORMAT,
      unit: '天' as const,
    };
    props.unit = date.unit;
    props.format = date.format;
  } else {
    if (trimString(field.format)) props.format = field.format?.trim();
    if (trimString(field.unit)) props.unit = field.unit?.trim();
  }

  if (SELECT_TYPES.has(componentType)) {
    const options = encodeSelectOptions(field.options);
    if (options && options.length >= MIN_SELECT_OPTIONS) props.options = options;
  }

  if (componentType === 'MoneyField') {
    props.upper = '0';
  }
  if (componentType === 'InnerContactField') {
    // DingTalk rejects numeric 0 ('Missingchoice'); string '0' = single, '1' = multiple.
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
  if (componentType === 'TextNote') {
    const content = trimString(field.content) ?? trimString(field.label);
    props.content = content;
    delete props.required;
    delete props.placeholder;
  }

  return {
    component: {
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
    return throwCollected([
      {
        componentType: '',
        index: 0,
        issue: 'formComponents',
        label: '',
        suggestion: 'provide at least one field',
      },
    ]);
  }
  const ctx: EncodeContext = {
    count: { value: 0 },
    overCapacity: false,
    problems: [],
    seenLabels: new Map<string, number>(),
    usedIds: new Set<string>(),
  };
  const components: EncodedFormComponent[] = [];
  const summaries: NormalizedTemplateFieldSummary[] = [];
  for (const [index, field] of fields.entries()) {
    const encoded = encodeOne(field, ctx, index);
    if (!encoded) continue;
    components.push(encoded.component);
    summaries.push(encoded.summary);
  }
  if (ctx.problems.length > 0) return throwCollected(ctx.problems);
  return { components, fields: summaries };
};
