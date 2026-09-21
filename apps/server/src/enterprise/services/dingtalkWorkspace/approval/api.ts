import { dingtalkWorkspaceRequest } from '../client';
import { DingtalkWorkspaceError } from '../errors';
import {
  type EncodedFormComponentValue,
  type ForecastActivityRule,
  INSTANCE_ID_HARD_CAP,
  INSTANCE_ID_PAGE_SIZE,
  PENDING_INSTANCE_CAP,
  PREMIUM_TODO_MAX_PAGE,
  PREMIUM_TODO_PAGE_SIZE,
  type ProcessForecastResult,
  type ProcessInstanceDetail,
  type ProcessInstanceFormValue,
  type ProcessInstanceOperationRecord,
  type ProcessInstanceTask,
  type TemplateField,
  type TemplateSchema,
  type VisibleTemplate,
} from './types';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const asBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter((item): item is string => Boolean(item));
};

const unwrapResult = (body: unknown): unknown => {
  const record = asRecord(body);
  if (record && 'result' in record) return record.result;
  return body;
};

const isWorkspaceError = (error: unknown): error is DingtalkWorkspaceError =>
  error instanceof DingtalkWorkspaceError;

export const isPremiumUnavailable = (error: unknown): boolean =>
  isWorkspaceError(error) &&
  (error.code === 'DINGTALK_FORBIDDEN' || error.code === 'DINGTALK_PREMIUM_REQUIRED');

export const remapPremiumError = (error: unknown): never => {
  if (isWorkspaceError(error) && error.code === 'DINGTALK_FORBIDDEN') {
    throw new DingtalkWorkspaceError('DINGTALK_PREMIUM_REQUIRED');
  }
  throw error;
};

const parseTask = (raw: unknown, processInstanceId?: string): ProcessInstanceTask | undefined => {
  const record = asRecord(raw);
  if (!record) return undefined;
  const taskId = asString(record.taskId);
  const userId = asString(record.userId);
  const status = asString(record.status);
  if (!taskId || !userId || !status) return undefined;
  return {
    activityId: asString(record.activityId),
    createTime: asString(record.createTime),
    finishTime: asString(record.finishTime),
    processInstanceId: asString(record.processInstanceId) ?? processInstanceId,
    result: asString(record.result),
    status,
    taskId,
    userId,
  };
};

const parseFormValue = (raw: unknown): ProcessInstanceFormValue | undefined => {
  const record = asRecord(raw);
  if (!record) return undefined;
  return {
    bizAlias: asString(record.bizAlias),
    componentType: asString(record.componentType),
    extValue: asString(record.extValue),
    id: asString(record.id),
    name: asString(record.name),
    value: typeof record.value === 'string' ? record.value : asString(record.value),
  };
};

const parseOperation = (raw: unknown): ProcessInstanceOperationRecord | undefined => {
  const record = asRecord(raw);
  if (!record) return undefined;
  return {
    activityId: asString(record.activityId),
    ccUserIds: asStringArray(record.ccUserIds),
    date: asString(record.date),
    remark: asString(record.remark),
    result: asString(record.result),
    showName: asString(record.showName),
    type: asString(record.type),
    userId: asString(record.userId),
  };
};

export const parseInstanceDetail = (
  processInstanceId: string,
  body: unknown,
): ProcessInstanceDetail => {
  const result = asRecord(unwrapResult(body)) ?? asRecord(body);
  if (!result) throw new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
  const originatorUserId = asString(result.originatorUserId);
  if (!originatorUserId) throw new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
  return {
    businessId: asString(result.businessId),
    ccUserIds: asStringArray(result.ccUserIds),
    createTime: asString(result.createTime),
    finishTime: asString(result.finishTime),
    formComponentValues: Array.isArray(result.formComponentValues)
      ? result.formComponentValues
          .map((item) => parseFormValue(item))
          .filter((item): item is ProcessInstanceFormValue => Boolean(item))
      : [],
    operationRecords: Array.isArray(result.operationRecords)
      ? result.operationRecords
          .map((item) => parseOperation(item))
          .filter((item): item is ProcessInstanceOperationRecord => Boolean(item))
      : [],
    originatorDeptId: asString(result.originatorDeptId),
    originatorDeptName: asString(result.originatorDeptName),
    originatorUserId,
    processInstanceId,
    result: asString(result.result),
    status: asString(result.status),
    tasks: Array.isArray(result.tasks)
      ? result.tasks
          .map((item) => parseTask(item, processInstanceId))
          .filter((item): item is ProcessInstanceTask => Boolean(item))
      : [],
    title: asString(result.title) ?? '',
  };
};

const parseOptions = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const options = value
    .map((item) => {
      if (typeof item === 'string') return item;
      const record = asRecord(item);
      return asString(record?.value) ?? asString(record?.key) ?? asString(record?.label);
    })
    .filter((item): item is string => Boolean(item));
  return options.length > 0 ? options : undefined;
};

const parseSchemaField = (raw: unknown): TemplateField | undefined => {
  const record = asRecord(raw);
  if (!record) return undefined;
  const props = asRecord(record.props) ?? {};
  const componentType = asString(record.componentName) ?? asString(record.componentType);
  const componentId = asString(props.id) ?? asString(props.componentId) ?? asString(record.id);
  const label = asString(props.label) ?? asString(record.label) ?? '';
  if (!componentType || !componentId) return undefined;
  const children = Array.isArray(record.children)
    ? record.children
        .map((child) => parseSchemaField(child))
        .filter((child): child is TemplateField => Boolean(child))
    : undefined;
  return {
    bizAlias: asString(props.bizAlias) ?? asString(record.bizAlias),
    children: children && children.length > 0 ? children : undefined,
    componentId,
    componentType,
    format: asString(props.format) ?? asString(record.format),
    hidden: asBoolean(props.hidden) === true || asBoolean(props.invisible) === true,
    label,
    options: parseOptions(props.options) ?? parseOptions(props.objOptions),
    required: asBoolean(props.required) === true,
    unit: asString(props.unit) ?? asString(record.unit),
  };
};

export const parseTemplateSchema = (processCode: string, body: unknown): TemplateSchema => {
  const result = asRecord(unwrapResult(body)) ?? asRecord(body);
  if (!result) throw new DingtalkWorkspaceError('DINGTALK_NOT_FOUND');
  const schemaContent = asRecord(result.schemaContent);
  const items = Array.isArray(schemaContent?.items) ? schemaContent.items : [];
  return {
    bizType: asString(result.bizType),
    fields: items
      .map((item) => parseSchemaField(item))
      .filter((item): item is TemplateField => Boolean(item)),
    name: asString(result.name) ?? asString(schemaContent?.title) ?? processCode,
    processCode,
  };
};

export const getInstanceDetail = async (
  processInstanceId: string,
): Promise<ProcessInstanceDetail> => {
  const body = await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    method: 'GET',
    path: '/v1.0/workflow/processInstances',
    query: { processInstanceId },
  });
  return parseInstanceDetail(processInstanceId, body);
};

export const listInstanceIds = async (input: {
  max?: number;
  processCode: string;
  startTime: number;
  statuses?: string[];
  userIds?: string[];
}): Promise<{ ids: string[]; truncated: boolean }> => {
  const cap = Math.min(Math.max(1, input.max ?? INSTANCE_ID_HARD_CAP), INSTANCE_ID_HARD_CAP);
  const ids: string[] = [];
  let nextToken: string | number = 0;
  let truncated = false;

  for (;;) {
    const remaining = cap - ids.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const body = await dingtalkWorkspaceRequest<unknown>({
      api: 'v1',
      body: {
        maxResults: Math.min(INSTANCE_ID_PAGE_SIZE, remaining),
        nextToken,
        processCode: input.processCode,
        startTime: input.startTime,
        statuses: input.statuses,
        userIds: input.userIds,
      },
      method: 'POST',
      path: '/v1.0/workflow/processes/instanceIds/query',
    });
    const result = asRecord(unwrapResult(body)) ?? asRecord(body);
    const page = asStringArray(result?.list);
    ids.push(...page.slice(0, remaining));
    const token = asString(result?.nextToken);
    if (!token || page.length === 0) break;
    nextToken = /^\d+$/.test(token) ? Number(token) : token;
    if (ids.length >= cap && token) {
      truncated = true;
      break;
    }
  }

  return { ids, truncated };
};

export const listRunningInstanceIds = async (
  processCode: string,
  sinceMs: number,
  max = PENDING_INSTANCE_CAP,
): Promise<string[]> => {
  const { ids } = await listInstanceIds({
    max,
    processCode,
    startTime: sinceMs,
    statuses: ['RUNNING'],
  });
  return ids;
};

export const listVisibleTemplates = async (staffId: string): Promise<VisibleTemplate[]> => {
  const templates: VisibleTemplate[] = [];
  let nextToken: string | number = 0;

  for (;;) {
    const body = await dingtalkWorkspaceRequest<unknown>({
      api: 'v1',
      method: 'GET',
      path: '/v1.0/workflow/processes/userVisibilities/templates',
      query: { maxResults: 100, nextToken, userId: staffId },
    });
    const result = asRecord(unwrapResult(body)) ?? asRecord(body);
    const processList = Array.isArray(result?.processList) ? result.processList : [];
    for (const item of processList) {
      const record = asRecord(item);
      const processCode = asString(record?.processCode);
      const name = asString(record?.name);
      if (!processCode || !name) continue;
      templates.push({ iconUrl: asString(record?.iconUrl), name, processCode });
    }
    const token = asString(result?.nextToken);
    if (!token || processList.length === 0) break;
    nextToken = /^\d+$/.test(token) ? Number(token) : token;
  }

  return templates;
};

export const getFormSchema = async (processCode: string): Promise<TemplateSchema> => {
  const body = await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    method: 'GET',
    path: '/v1.0/workflow/forms/schemas/processCodes',
    query: { processCode },
  });
  return parseTemplateSchema(processCode, body);
};

export const forecastProcess = async (input: {
  deptId: number;
  formComponentValues: EncodedFormComponentValue[];
  processCode: string;
  userId: string;
}): Promise<ProcessForecastResult> => {
  const body = await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    body: {
      deptId: input.deptId,
      formComponentValues: input.formComponentValues,
      processCode: input.processCode,
      userId: input.userId,
    },
    method: 'POST',
    path: '/v1.0/workflow/processes/forecast',
  });
  const result = asRecord(unwrapResult(body)) ?? asRecord(body) ?? {};
  const rules = Array.isArray(result.workflowActivityRules) ? result.workflowActivityRules : [];
  return {
    isForecastSuccess: asBoolean(result.isForecastSuccess),
    workflowActivityRules: rules
      .map((item): ForecastActivityRule | undefined => {
        const record = asRecord(item);
        if (!record) return undefined;
        const actor = asRecord(record.workflowActor);
        return {
          activityId: asString(record.activityId),
          activityName: asString(record.activityName),
          activityType: asString(record.activityType),
          isTargetSelect: asBoolean(record.isTargetSelect),
          workflowActor: actor
            ? {
                actorKey: asString(actor.actorKey),
                actorType: asString(actor.actorType),
                required: asBoolean(actor.required),
              }
            : undefined,
        };
      })
      .filter((item): item is ForecastActivityRule => Boolean(item)),
  };
};

export const startProcessInstance = async (input: {
  approvers?: Array<{ actionType: 'AND' | 'NONE' | 'OR'; userIds: string[] }>;
  ccList?: string[];
  ccPosition?: 'FINISH' | 'START' | 'START_FINISH';
  deptId?: number;
  formComponentValues: EncodedFormComponentValue[];
  originatorUserId: string;
  processCode: string;
  targetSelectActioners?: Array<{ actionerKey: string; actionerUserIds: string[] }>;
}): Promise<{ instanceId: string }> => {
  const body = await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    body: {
      approvers: input.approvers,
      ccList: input.ccList,
      ccPosition: input.ccPosition,
      deptId: input.deptId,
      formComponentValues: input.formComponentValues,
      originatorUserId: input.originatorUserId,
      processCode: input.processCode,
      targetSelectActioners: input.targetSelectActioners,
    },
    method: 'POST',
    path: '/v1.0/workflow/processInstances',
  });
  const record = asRecord(body);
  const instanceId =
    asString(record?.instanceId) ?? asString(asRecord(unwrapResult(body))?.instanceId);
  if (!instanceId) throw new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE');
  return { instanceId };
};

export const executeTaskAs = async (
  staffId: string,
  input: {
    processInstanceId: string;
    remark?: string;
    result: 'agree' | 'refuse';
    taskId: string | number;
  },
): Promise<{ result: boolean }> => {
  const body = await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    body: {
      actionerUserId: staffId,
      processInstanceId: input.processInstanceId,
      remark: input.remark,
      result: input.result,
      taskId: Number(input.taskId),
    },
    method: 'POST',
    path: '/v1.0/workflow/processInstances/execute',
  });
  const record = asRecord(body) ?? {};
  return { result: asBoolean(record.result) === true || asBoolean(record.success) === true };
};

export const redirectTaskAs = async (
  staffId: string,
  input: { remark?: string; taskId: string | number; toUserId: string },
): Promise<{ result: boolean }> => {
  const body = await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    body: {
      operateUserId: staffId,
      remark: input.remark,
      taskId: Number(input.taskId),
      toUserId: input.toUserId,
    },
    method: 'POST',
    path: '/v1.0/workflow/tasks/redirect',
  });
  const record = asRecord(body) ?? asRecord(unwrapResult(body)) ?? {};
  return { result: asBoolean(record.result) !== false };
};

export const addCommentAs = async (
  staffId: string,
  input: { processInstanceId: string; text: string },
): Promise<{ result: boolean }> => {
  const body = await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    body: {
      commentUserId: staffId,
      processInstanceId: input.processInstanceId,
      text: input.text,
    },
    method: 'POST',
    path: '/v1.0/workflow/processInstances/comments',
  });
  const record = asRecord(body) ?? {};
  return { result: asBoolean(record.result) === true || asBoolean(record.success) === true };
};

export const terminateProcessInstance = async (input: {
  operatingUserId: string;
  processInstanceId: string;
  remark?: string;
}): Promise<void> => {
  await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    body: {
      isSystem: false,
      operatingUserId: input.operatingUserId,
      processInstanceId: input.processInstanceId,
      remark: input.remark,
    },
    method: 'POST',
    path: '/v1.0/workflow/processInstances/terminate',
  });
};

export const revertTaskAs = async (
  staffId: string,
  input: {
    processInstanceId: string;
    remark?: string;
    revertAction: 'REVERT_FOR_APPROVAL' | 'REVERT_FOR_RESUBMIT';
    targetActivityId: string;
    taskId: string | number;
  },
): Promise<{ result: boolean }> => {
  try {
    const body = await dingtalkWorkspaceRequest<unknown>({
      api: 'v1',
      body: {
        operateUserId: staffId,
        processInstanceId: input.processInstanceId,
        remark: input.remark,
        revertAction: input.revertAction,
        targetActivityId: input.targetActivityId,
        taskId: Number(input.taskId),
      },
      method: 'POST',
      path: '/v1.0/workflow/premium/tasks/revert',
    });
    const record = asRecord(body) ?? asRecord(unwrapResult(body)) ?? {};
    return { result: asBoolean(record.result) !== false };
  } catch (error) {
    return remapPremiumError(error);
  }
};

export const appendTaskAs = async (
  staffId: string,
  input: {
    activateType: 'ALL' | 'ONE_BY_ONE';
    agreeAll?: boolean;
    appenderUserIds: string[];
    processInstanceId: string;
    remark?: string;
    taskId: string | number;
    type: 'after' | 'before';
  },
): Promise<{ result: boolean }> => {
  try {
    const body = await dingtalkWorkspaceRequest<unknown>({
      api: 'v1',
      body: {
        activateType: input.activateType,
        agreeAll: input.agreeAll,
        appenderUserIds: input.appenderUserIds,
        operateUserId: staffId,
        processInstanceId: input.processInstanceId,
        remark: input.remark,
        taskId: Number(input.taskId),
        type: input.type,
      },
      method: 'POST',
      path: '/v1.0/workflow/premium/tasks/append',
    });
    const record = asRecord(body) ?? asRecord(unwrapResult(body)) ?? {};
    return { result: asBoolean(record.result) !== false };
  } catch (error) {
    return remapPremiumError(error);
  }
};

export interface PremiumTodoTask {
  formMassage?: string;
  originatorName?: string;
  processCreateTime?: string;
  processInstanceId: string;
  taskId: string;
  title: string;
}

export const listPremiumTodoTasks = async (
  staffId: string,
  input?: { limit?: number },
): Promise<{ hasMore: boolean; list: PremiumTodoTask[] }> => {
  const limit = input?.limit ?? PREMIUM_TODO_PAGE_SIZE * PREMIUM_TODO_MAX_PAGE;
  const list: PremiumTodoTask[] = [];
  let pageNumber = 1;
  let hasMore = false;

  while (pageNumber <= PREMIUM_TODO_MAX_PAGE && list.length < limit) {
    const body = await dingtalkWorkspaceRequest<unknown>({
      api: 'v1',
      method: 'GET',
      path: '/v1.0/workflow/premium/processCentres/todoTasks',
      query: {
        pageNumber,
        pageSize: PREMIUM_TODO_PAGE_SIZE,
        userId: staffId,
      },
    });
    const result = asRecord(unwrapResult(body)) ?? asRecord(body);
    const page = Array.isArray(result?.list) ? result.list : [];
    for (const item of page) {
      if (list.length >= limit) break;
      const record = asRecord(item);
      const processInstanceId = asString(record?.processInstanceId);
      const taskId = asString(record?.taskId);
      if (!processInstanceId || !taskId) continue;
      list.push({
        formMassage: asString(record?.formMassage),
        originatorName: asString(record?.originatorName),
        processCreateTime: asString(record?.processCreateTime),
        processInstanceId,
        taskId,
        title: asString(record?.title) ?? '',
      });
    }
    hasMore = asBoolean(result?.hasMore) === true;
    if (!hasMore || page.length === 0) {
      hasMore = false;
      break;
    }
    pageNumber += 1;
  }

  return { hasMore: hasMore || list.length >= limit, list };
};

export const saveFormTemplate = async (input: {
  description?: string;
  formComponents: Array<{
    children?: unknown[];
    componentType: string;
    props: Record<string, unknown>;
  }>;
  name: string;
  processCode?: string;
}): Promise<{ processCode: string }> => {
  const body = await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    body: {
      description: input.description,
      formComponents: input.formComponents,
      name: input.name,
      processCode: input.processCode,
    },
    method: 'POST',
    path: '/v1.0/workflow/forms',
  });
  const result = asRecord(unwrapResult(body)) ?? asRecord(body);
  const processCode = asString(result?.processCode);
  if (!processCode) throw new DingtalkWorkspaceError('DINGTALK_UNAVAILABLE');
  return { processCode };
};

export const deleteFormTemplate = async (processCode: string): Promise<void> => {
  await dingtalkWorkspaceRequest<unknown>({
    api: 'v1',
    method: 'DELETE',
    path: '/v1.0/workflow/processCentres/schemas',
    query: { cleanRunningTask: false, processCode },
  });
};
