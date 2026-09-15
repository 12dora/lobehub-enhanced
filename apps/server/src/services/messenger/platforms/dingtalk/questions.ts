import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { sendDingTalkChoiceList, sendDingTalkMarkdown } from './cards';
import {
  DINGTALK_PENDING_QUESTION_KEY_PREFIX,
  DINGTALK_PENDING_QUESTION_TTL_SECONDS,
} from './const';

const log = debug('lobe-server:messenger:dingtalk:questions');

export interface DingTalkChoiceOption {
  label: string;
  value: string;
}

export interface DingTalkPendingQuestion {
  operationId: string;
  options?: DingTalkChoiceOption[];
  parentMessageId?: string;
  prompt: string;
  questionId: string;
  toolCallId?: string;
}

export interface WaitingForHumanEventLike {
  finalState?: unknown;
  lastAssistantContent?: string;
  operationId?: string;
}

const pendingKey = (threadId: string): string =>
  `${DINGTALK_PENDING_QUESTION_KEY_PREFIX}${threadId}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const parseToolArguments = (raw: unknown): Record<string, unknown> | undefined => {
  if (isRecord(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const optionsFromUnknown = (value: unknown): DingTalkChoiceOption[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const options: DingTalkChoiceOption[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const label = asString(item.label) ?? asString(item.value) ?? asString(item.header);
    const optionValue = asString(item.value) ?? label;
    if (!label || !optionValue) continue;
    options.push({ label, value: optionValue });
  }
  return options.length > 0 ? options : undefined;
};

/**
 * Runtime signal: `onComplete` with `reason === 'waiting_for_human'`.
 * Question text comes from `pendingHumanPrompt` / `askUserQuestion` tool
 * arguments / last assistant content. Resume uses `resumeToolResult`
 * (same as the web client `executeGatewayAgent` path).
 */
export const extractDingTalkQuestion = (
  event: WaitingForHumanEventLike,
): DingTalkPendingQuestion | null => {
  const operationId = asString(event.operationId);
  if (!operationId) return null;

  const state = isRecord(event.finalState) ? event.finalState : {};
  const pendingTools = Array.isArray(state.pendingToolsCalling) ? state.pendingToolsCalling : [];
  const pendingAnchors = Array.isArray(state.pendingHumanToolMessages)
    ? state.pendingHumanToolMessages
    : [];

  const askTool = pendingTools.find((tool) => {
    if (!isRecord(tool)) return false;
    const apiName = asString(tool.apiName);
    const identifier = asString(tool.identifier);
    return (
      apiName === 'askUserQuestion' ||
      identifier === 'lobe-user-interaction' ||
      identifier === 'lobe-agent'
    );
  });

  const args = askTool && isRecord(askTool) ? parseToolArguments(askTool.arguments) : undefined;
  const questions = Array.isArray(args?.questions) ? args.questions : [];
  const firstQuestion = questions.find((item) => isRecord(item));

  const pendingPrompt = isRecord(state.pendingHumanPrompt) ? state.pendingHumanPrompt : undefined;
  const pendingSelect = isRecord(state.pendingHumanSelect) ? state.pendingHumanSelect : undefined;

  const prompt =
    (firstQuestion && asString(firstQuestion.question)) ||
    asString(pendingPrompt?.prompt) ||
    asString(pendingSelect?.prompt) ||
    asString(event.lastAssistantContent) ||
    '需要你确认';

  const options =
    optionsFromUnknown(firstQuestion?.options) ?? optionsFromUnknown(pendingSelect?.options);

  const toolResultAnchor = pendingAnchors.find(
    (item) => isRecord(item) && item.kind === 'toolResult',
  );
  const anyAnchor = pendingAnchors.find((item) => isRecord(item));
  const anchor =
    (isRecord(toolResultAnchor) ? toolResultAnchor : undefined) ??
    (isRecord(anyAnchor) ? anyAnchor : undefined);
  const askToolId = askTool && isRecord(askTool) ? asString(askTool.id) : undefined;

  const parentMessageId = asString(anchor?.messageId);
  const toolCallId = asString(anchor?.toolCallId) ?? askToolId;
  const questionId = parentMessageId || toolCallId || operationId;

  return {
    operationId,
    options,
    parentMessageId,
    prompt,
    questionId,
    toolCallId,
  };
};

export const storeDingTalkPendingQuestion = async (
  threadId: string,
  pending: DingTalkPendingQuestion,
): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.set(
      pendingKey(threadId),
      JSON.stringify(pending),
      'EX',
      DINGTALK_PENDING_QUESTION_TTL_SECONDS,
    );
  } catch (error) {
    log('storeDingTalkPendingQuestion failed: %O', error);
  }
};

export const loadDingTalkPendingQuestion = async (
  threadId: string,
): Promise<DingTalkPendingQuestion | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(pendingKey(threadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DingTalkPendingQuestion;
    if (!parsed?.operationId || !parsed.questionId) return null;
    return parsed;
  } catch (error) {
    log('loadDingTalkPendingQuestion failed: %O', error);
    return null;
  }
};

export const clearDingTalkPendingQuestion = async (threadId: string): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.del(pendingKey(threadId));
  } catch (error) {
    log('clearDingTalkPendingQuestion failed: %O', error);
  }
};

export const resolveQuestionAnswer = (text: string, pending: DingTalkPendingQuestion): string => {
  const trimmed = text.trim();
  const options = pending.options;
  if (!options?.length) return trimmed;
  const index = Number.parseInt(trimmed, 10);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) {
    return options[index - 1].value;
  }
  const byValue = options.find((option) => option.value === trimmed);
  if (byValue) return byValue.value;
  const byLabel = options.find((option) => option.label === trimmed);
  if (byLabel) return byLabel.value;
  return trimmed;
};

export const forwardDingTalkWaitingQuestion = async (
  threadId: string,
  event: WaitingForHumanEventLike,
): Promise<DingTalkPendingQuestion | null> => {
  const pending = extractDingTalkQuestion(event);
  if (!pending) return null;
  await storeDingTalkPendingQuestion(threadId, pending);
  const decoded = threadId.startsWith('dingtalk:') ? threadId.slice('dingtalk:'.length) : threadId;
  const askerStaffId = decoded.includes(':') ? decoded.slice(decoded.lastIndexOf(':') + 1) : '';
  if (pending.options?.length) {
    await sendDingTalkChoiceList({
      askerStaffId,
      entries: pending.options.map((option) => ({
        command: `messenger:answer:${option.value}`,
        label: option.label,
      })),
      text: pending.prompt,
      threadId,
      title: '需要确认',
    });
  } else {
    await sendDingTalkMarkdown(threadId, pending.prompt);
  }
  return pending;
};
