import type { DingTalkApiClient } from '../api';
import { DINGTALK_API_BASE, DingTalkApiError, DingTalkCardUnavailableError } from '../types';

/**
 * Built-in StandardCard (`/v1.0/im/v1.0/robot/interactiveCards/send`) does not
 * deliver button clicks on the Stream topic `/v1.0/card/instances/callback`.
 * Confirm cards use create-and-deliver with `callbackType: STREAM`, which
 * requires a card-platform template. The admin sets
 * `DINGTALK_CONFIRM_CARD_TEMPLATE_ID`.
 */
export const DINGTALK_CONFIRM_CARD_TEMPLATE_ENV = 'DINGTALK_CONFIRM_CARD_TEMPLATE_ID';

export const readDingTalkConfirmCardTemplateId = (): string | undefined => {
  const value = process.env[DINGTALK_CONFIRM_CARD_TEMPLATE_ENV]?.trim();
  return value || undefined;
};

export interface DingTalkConfirmCardContent {
  /**
   * When false, both buttons stay visible — the imported template cannot hide
   * only 批准 — and the server ignores an agree/approve click. The web-confirm
   * instruction goes in `note`. Omit to leave 批准 available.
   */
  allowApprove?: boolean;
  content: string;
  /** `YYYY-MM-DD HH:mm` in Asia/Shanghai. Omitted on create → now. */
  createTime?: string;
  /**
   * One hint line. Omitted → 「仅发起人可操作」, or the web-confirm line when
   * the body does not fit.
   */
  note?: string;
  /**
   * Button driver: `''` shows 拒绝/批准, `agree` / `reject` hide them and show
   * the matching badge. Legacy labels such as 「待确认」 are mapped.
   */
  status: string;
  /** Shown as 「状态：<statusText>」. Omitted → derived from `status`. */
  statusText?: string;
  title: string;
  /** Topic deep link used when `content` does not fit the card. */
  webLink?: string;
}

/** Fields a card update may change. Other public variables stay as delivered. */
export interface DingTalkConfirmCardPatch {
  note?: string;
  status: string;
  statusText?: string;
}

export interface DingTalkConfirmCardTarget {
  /** Group openConversationId. Omit for a 1:1 robot card. */
  openConversationId?: string;
  robotCode: string;
  /** DingTalk staffId of the requester. Required for 1:1 delivery. */
  staffId: string;
}

const CARD_PARAM_MAX_CHARS = 900;

/** Shown in `note` instead of a silent cut when the summary does not fit the card. */
export const DINGTALK_CONFIRM_OVERFLOW_LINE = '内容较长，完整内容请在网页端确认：';

/** Chat-list summary prefix. The title is appended. */
export const DINGTALK_CONFIRM_LAST_MESSAGE_PREFIX = 'AI 平台操作确认：';

/** Default `note` while the card can still be approved in DingTalk. */
export const DINGTALK_CONFIRM_ASKER_NOTE = '仅发起人可操作';

export const DINGTALK_CONFIRM_STATUS_TEXT = {
  approved: '已批准，执行中…',
  expired: '已失效（超时未确认）',
  pending: '待确认',
  rejected: '已拒绝',
  web: '请到网页端确认',
} as const;

export type DingTalkConfirmButtonStatus = '' | 'agree' | 'reject';

const charLength = (value: string): number => [...value].length;

const sliceChars = (value: string, count: number): string =>
  [...value].slice(0, Math.max(0, count)).join('');

export const formatDingTalkConfirmOverflowLine = (webLink?: string): string =>
  `${DINGTALK_CONFIRM_OVERFLOW_LINE}${webLink?.trim() || '当前话题'}`;

/** `YYYY-MM-DD HH:mm` in Asia/Shanghai, as the imported template prints it. */
export const formatDingTalkConfirmCreateTime = (at: Date = new Date()): string =>
  new Intl.DateTimeFormat('sv-SE', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(at);

/**
 * Button driver for the imported template. `agree` and legacy `approve` both
 * become `agree` on the card. Callback parsing still returns `approve` so the
 * messenger command stays `messenger:confirm:approve`.
 */
export const toDingTalkConfirmButtonStatus = (status: string): DingTalkConfirmButtonStatus => {
  const text = status.trim();
  const lower = text.toLowerCase();
  if (
    text === '' ||
    lower === 'pending' ||
    text === DINGTALK_CONFIRM_STATUS_TEXT.pending ||
    text === DINGTALK_CONFIRM_STATUS_TEXT.web
  ) {
    return '';
  }
  if (
    lower === 'agree' ||
    lower === 'approve' ||
    lower === 'approved' ||
    text === '批准' ||
    text.startsWith('已批准')
  ) {
    return 'agree';
  }
  if (
    lower === 'reject' ||
    lower === 'rejected' ||
    lower === 'refuse' ||
    lower === 'expired' ||
    text === '拒绝' ||
    text.startsWith('已拒绝') ||
    text.startsWith('已失效')
  ) {
    return 'reject';
  }
  return '';
};

const inferStatusText = (raw: string, button: DingTalkConfirmButtonStatus): string => {
  const text = raw.trim();
  if (text === 'expired' || text.startsWith('已失效')) return DINGTALK_CONFIRM_STATUS_TEXT.expired;
  if (text === DINGTALK_CONFIRM_STATUS_TEXT.web) return text;
  if (button === 'agree') return DINGTALK_CONFIRM_STATUS_TEXT.approved;
  if (button === 'reject') return DINGTALK_CONFIRM_STATUS_TEXT.rejected;
  return DINGTALK_CONFIRM_STATUS_TEXT.pending;
};

/**
 * Keep the card param inside DingTalk's string limit without dropping the tail
 * quietly. Overflow keeps a body prefix, puts the web-confirm line in `note`,
 * and disables in-card approval. The template still shows both buttons.
 */
export const fitDingTalkConfirmCardContent = (
  content: string,
  webLink?: string,
): { allowApprove: boolean; content: string; note?: string } => {
  const notice = formatDingTalkConfirmOverflowLine(webLink);
  const markerAt = content.indexOf(DINGTALK_CONFIRM_OVERFLOW_LINE);
  const body = (markerAt === -1 ? content : content.slice(0, markerAt)).replace(/\n+$/, '');
  if (markerAt === -1 && charLength(body) <= CARD_PARAM_MAX_CHARS) {
    return { allowApprove: true, content: body };
  }
  const head =
    charLength(body) <= CARD_PARAM_MAX_CHARS
      ? body
      : sliceChars(body, CARD_PARAM_MAX_CHARS).replace(/\s+$/u, '');
  return { allowApprove: false, content: head, note: notice };
};

export const truncateCardParam = (value: string): string => {
  const chars = [...value];
  if (chars.length <= CARD_PARAM_MAX_CHARS) return value;
  return `${chars.slice(0, CARD_PARAM_MAX_CHARS - 1).join('')}…`;
};

const resolveStatusText = (
  input: { allowApprove?: boolean; status: string; statusText?: string },
  button: DingTalkConfirmButtonStatus,
  allowApprove: boolean,
): string => {
  const explicit = input.statusText?.trim();
  if (explicit) return explicit;
  if (button === '' && !allowApprove) return DINGTALK_CONFIRM_STATUS_TEXT.web;
  return inferStatusText(input.status, button);
};

/**
 * Public variables of the imported confirm template. Every value is a string.
 * `status` is `''` | `agree` | `reject` — never the Chinese label.
 */
export const buildDingTalkConfirmCardParamMap = (
  input: DingTalkConfirmCardContent,
): Record<string, string> => {
  const fitted = fitDingTalkConfirmCardContent(input.content, input.webLink);
  const allowApprove = input.allowApprove === false ? false : fitted.allowApprove;
  const status = toDingTalkConfirmButtonStatus(input.status);
  const title = truncateCardParam(input.title);
  const note =
    input.note ??
    fitted.note ??
    (allowApprove ? DINGTALK_CONFIRM_ASKER_NOTE : formatDingTalkConfirmOverflowLine(input.webLink));
  const createTime = input.createTime?.trim()
    ? input.createTime.trim()
    : formatDingTalkConfirmCreateTime();
  return {
    content: fitted.content,
    createTime: truncateCardParam(createTime),
    lastMessage: truncateCardParam(`${DINGTALK_CONFIRM_LAST_MESSAGE_PREFIX}${title}`),
    note: truncateCardParam(note),
    status,
    statusText: truncateCardParam(resolveStatusText(input, status, allowApprove)),
    title,
  };
};

/**
 * Incremental update. Only the keys that change after a click or timeout.
 * `title` / `content` / `createTime` / `lastMessage` stay on the delivered card.
 */
export const buildDingTalkConfirmCardUpdateParamMap = (
  input: DingTalkConfirmCardPatch,
): Record<string, string> => {
  const status = toDingTalkConfirmButtonStatus(input.status);
  const statusText = truncateCardParam(
    input.statusText?.trim() || inferStatusText(input.status, status),
  );
  const map: Record<string, string> = {
    status,
    statusText,
  };
  if (input.note !== undefined) map.note = truncateCardParam(input.note);
  return map;
};

export const buildDingTalkConfirmDeliverBody = (params: {
  card: DingTalkConfirmCardContent;
  cardTemplateId: string;
  outTrackId: string;
  target: DingTalkConfirmCardTarget;
}): Record<string, unknown> => {
  const isGroup = Boolean(params.target.openConversationId);
  const openSpaceId = isGroup
    ? `dtv1.card//IM_GROUP.${params.target.openConversationId}`
    : `dtv1.card//IM_ROBOT.${params.target.staffId}`;

  const body: Record<string, unknown> = {
    callbackType: 'STREAM',
    cardData: { cardParamMap: buildDingTalkConfirmCardParamMap(params.card) },
    cardTemplateId: params.cardTemplateId,
    openSpaceId,
    outTrackId: params.outTrackId,
  };

  if (isGroup) {
    body.imGroupOpenSpaceModel = { supportForward: false };
    body.imGroupOpenDeliverModel = { robotCode: params.target.robotCode };
  } else {
    body.imRobotOpenSpaceModel = { supportForward: false };
    body.imRobotOpenDeliverModel = {
      robotCode: params.target.robotCode,
      spaceType: 'IM_ROBOT',
    };
  }

  return body;
};

const readError = async (response: Response): Promise<{ code: string; message: string }> => {
  const raw = await response.text();
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const code = json.code ?? json.errcode ?? `http_${response.status}`;
    const message = json.message ?? json.errmsg ?? raw;
    return { code: String(code), message: String(message) };
  } catch {
    return { code: `http_${response.status}`, message: raw || response.statusText };
  }
};

/**
 * One create-and-deliver call. Throws `DingTalkCardUnavailableError` when the
 * template id is missing or DingTalk rejects the card, so the caller can fall
 * back without a second request.
 */
export const sendDingTalkStreamConfirmCard = async (
  api: DingTalkApiClient,
  params: {
    card: DingTalkConfirmCardContent;
    cardTemplateId?: string;
    outTrackId: string;
    target: DingTalkConfirmCardTarget;
  },
): Promise<void> => {
  const cardTemplateId = params.cardTemplateId?.trim() || readDingTalkConfirmCardTemplateId();
  if (!cardTemplateId) {
    throw new DingTalkCardUnavailableError('DINGTALK_CONFIRM_CARD_TEMPLATE_ID is not set', {
      code: 'missing_confirm_card_template',
    });
  }

  const token = await api.getAccessToken();
  const body = buildDingTalkConfirmDeliverBody({
    card: params.card,
    cardTemplateId,
    outTrackId: params.outTrackId,
    target: params.target,
  });

  let response: Response;
  try {
    response = await fetch(`${DINGTALK_API_BASE}/v1.0/card/instances/createAndDeliver`, {
      body: JSON.stringify(body),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      method: 'POST',
    });
  } catch (error) {
    throw new DingTalkCardUnavailableError(error instanceof Error ? error.message : String(error), {
      cause: error,
      code: 'card_unavailable',
    });
  }

  if (!response.ok) {
    const parsed = await readError(response);
    throw new DingTalkCardUnavailableError(
      `DingTalk confirm card failed: ${parsed.code} ${parsed.message}`,
      { code: parsed.code, status: response.status },
    );
  }

  const raw = await response.text();
  if (!raw) return;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new DingTalkCardUnavailableError('DingTalk confirm card returned invalid JSON', {
      cause: error,
      code: 'card_unavailable',
    });
  }
  if (data.success === false) {
    throw new DingTalkCardUnavailableError(
      `DingTalk confirm card failed: ${String(data.result ?? data.message ?? 'success=false')}`,
      { code: 'card_unavailable' },
    );
  }
  if (data.code !== undefined && data.code !== '0' && data.code !== 0) {
    throw new DingTalkCardUnavailableError(
      `DingTalk confirm card failed: ${String(data.code)} ${String(data.message ?? '')}`,
      { code: String(data.code) },
    );
  }
};

const assertCardOk = async (response: Response, label: string): Promise<void> => {
  if (!response.ok) {
    const parsed = await readError(response);
    throw new DingTalkCardUnavailableError(
      `DingTalk ${label} failed: ${parsed.code} ${parsed.message}`,
      { code: parsed.code, status: response.status },
    );
  }

  const raw = await response.text();
  if (!raw) return;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new DingTalkCardUnavailableError(`DingTalk ${label} returned invalid JSON`, {
      cause: error,
      code: 'card_unavailable',
    });
  }
  if (data.success === false) {
    throw new DingTalkCardUnavailableError(
      `DingTalk ${label} failed: ${String(data.result ?? data.message ?? 'success=false')}`,
      { code: 'card_unavailable' },
    );
  }
  if (data.code !== undefined && data.code !== '0' && data.code !== 0) {
    throw new DingTalkCardUnavailableError(
      `DingTalk ${label} failed: ${String(data.code)} ${String(data.message ?? '')}`,
      { code: String(data.code) },
    );
  }
};

/**
 * One incremental update (`updateCardDataByKey`). Sends only the keys in
 * `card`, so a confirm stays one delivery plus one update.
 */
export const updateDingTalkConfirmCard = async (
  api: DingTalkApiClient,
  outTrackId: string,
  card: DingTalkConfirmCardPatch,
): Promise<void> => {
  try {
    const token = await api.getAccessToken();
    let response: Response;
    try {
      response = await fetch(`${DINGTALK_API_BASE}/v1.0/card/instances`, {
        body: JSON.stringify({
          cardData: { cardParamMap: buildDingTalkConfirmCardUpdateParamMap(card) },
          cardUpdateOptions: { updateCardDataByKey: true },
          outTrackId,
        }),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': token,
        },
        method: 'PUT',
      });
    } catch (error) {
      throw new DingTalkCardUnavailableError(
        error instanceof Error ? error.message : String(error),
        { cause: error, code: 'card_unavailable' },
      );
    }
    await assertCardOk(response, 'confirm card update');
  } catch (error) {
    if (error instanceof DingTalkCardUnavailableError) throw error;
    if (error instanceof DingTalkApiError) {
      throw new DingTalkCardUnavailableError(
        `DingTalk confirm card update failed: ${error.message}`,
        { cause: error, code: error.code, status: error.status },
      );
    }
    throw new DingTalkCardUnavailableError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const parseContent = (content: unknown): Record<string, unknown> | undefined => {
  if (typeof content === 'string') {
    try {
      return asRecord(JSON.parse(content));
    } catch {
      return undefined;
    }
  }
  return asRecord(content);
};

const normalizeDecision = (value: unknown): 'approve' | 'reject' | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (text === 'approve' || text === 'approved' || text === 'agree' || value.trim() === '批准') {
    return 'approve';
  }
  if (text === 'reject' || text === 'rejected' || text === 'refuse' || value.trim() === '拒绝') {
    return 'reject';
  }
  return undefined;
};

/**
 * Button payload from `/v1.0/card/instances/callback`.
 * The imported template's 回传请求 params are `{ "action": "agree" | "reject" }`.
 * Legacy `approve` is still accepted. Both `agree` and `approve` return
 * `approve` so the messenger command stays `messenger:confirm:approve`.
 * Button ids are accepted as a fallback.
 */
export const parseDingTalkConfirmAction = (content: unknown): 'approve' | 'reject' | undefined => {
  const parsed = parseContent(content);
  if (!parsed) return undefined;
  const privateData = asRecord(parsed.cardPrivateData) ?? parsed;
  const params = asRecord(privateData.params);
  const fromParams =
    normalizeDecision(params?.action) ||
    normalizeDecision(params?.decision) ||
    normalizeDecision(params?.command);
  if (fromParams) return fromParams;

  const actionIds = privateData.actionIds;
  if (Array.isArray(actionIds)) {
    for (const id of actionIds) {
      const decision = normalizeDecision(id);
      if (decision) return decision;
    }
  }
  return undefined;
};
