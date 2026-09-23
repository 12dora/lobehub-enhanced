/**
 * DingTalk chat-sdk adapter configuration.
 */
export interface DingTalkAdapterConfig {
  /** Optional AI-card template id — stored for callers (G2b / messenger). */
  aiCardTemplateId?: string;
  /** AppKey / Client ID */
  clientId: string;
  /** AppSecret / Client Secret */
  clientSecret: string;
  /** Robot code from the DingTalk open platform */
  robotCode: string;
  /** Optional interactive-select card template id — stored for callers. */
  selectCardTemplateId?: string;
  /** Bot display name override */
  userName?: string;
}

/**
 * Thread-id components. DM = conversation only; group sessions also carry the asker.
 *
 *   - DM:    `dingtalk:<conversationId>`
 *   - group: `dingtalk:<conversationId>:<senderStaffId>`
 */
export interface DingTalkThreadId {
  conversationId: string;
  senderStaffId?: string;
}

export interface DingTalkAtUser {
  dingtalkId?: string;
  staffId?: string;
}

export interface DingTalkMediaContent {
  downloadCode?: string;
  fileName?: string;
  fileType?: string;
  pictureDownloadCode?: string;
}

export interface DingTalkRichTextItem {
  picture?: { downloadCode?: string };
  text?: string;
}

/**
 * Inbound robot payload (Stream topic `/v1.0/im/bot/messages/get`).
 *
 * `conversationType` is `'1'` for DM and `'2'` for group.
 */
export interface DingTalkRobotMessage {
  atUsers?: DingTalkAtUser[];
  chatbotCorpId?: string;
  chatbotUserId?: string;
  content?: DingTalkMediaContent & { richText?: DingTalkRichTextItem[] };
  conversationId: string;
  conversationTitle?: string;
  conversationType: string;
  createAt?: number;
  isAdmin?: boolean;
  isInAtList?: boolean;
  msgId: string;
  msgtype: string;
  picture?: DingTalkMediaContent;
  richText?: { richText?: DingTalkRichTextItem[] };
  robotCode?: string;
  senderCorpId?: string;
  senderId?: string;
  senderNick?: string;
  senderStaffId?: string;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
  text?: { content?: string };
}

/**
 * Interactive / AI-card callback (Stream topic `/v1.0/card/instances/callback`).
 */
export interface DingTalkCardCallback {
  content?: string | Record<string, unknown>;
  corpId?: string;
  outTrackId?: string;
  userId?: string;
}

export interface DingTalkSessionContext {
  conversationId: string;
  conversationType: string;
  robotCode?: string;
  senderNick?: string;
  senderStaffId: string;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
}

export type DingTalkStreamState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type DingTalkAck = (result?: unknown) => void;

export interface DingTalkDownloadedFile {
  buffer: Buffer;
  filename?: string;
  mimeType?: string;
}

export interface DingTalkCreateCardParams {
  cardData?: { cardParamMap?: Record<string, string> };
  cardTemplateId: string;
  openConversationId?: string;
  outTrackId: string;
  robotCode: string;
  staffId?: string;
}

export interface DingTalkStreamCardParams {
  content: string;
  guid?: string;
  isFinalize?: boolean;
  isFull?: boolean;
  key?: string;
  outTrackId: string;
}

export interface DingTalkUpdateCardParams {
  cardData?: { cardParamMap?: Record<string, string> };
  outTrackId: string;
}

export interface DingTalkActionCardButton {
  command: string;
  label: string;
}

export interface DingTalkActionCardParam {
  msgKey: string;
  msgParam: string;
}

/**
 * Typed DingTalk HTTP error. `code` is the platform error code (`InvalidAuthentication`,
 * numeric `errcode`, or `http_<status>` when the body has no code).
 */
export class DingTalkApiError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, options: { cause?: unknown; code: string; status?: number }) {
    super(message, { cause: options.cause });
    this.name = 'DingTalkApiError';
    this.code = options.code;
    this.status = options.status;
  }
}

/**
 * Thrown by AI-card helpers when create / stream / update fails so callers can
 * fall back to markdown.
 */
export class DingTalkCardUnavailableError extends DingTalkApiError {
  constructor(message: string, options?: { cause?: unknown; code?: string; status?: number }) {
    super(message, {
      cause: options?.cause,
      code: options?.code ?? 'card_unavailable',
      status: options?.status,
    });
    this.name = 'DingTalkCardUnavailableError';
  }
}

export const DINGTALK_API_BASE = 'https://api.dingtalk.com';
export const DINGTALK_OAPI_BASE = 'https://oapi.dingtalk.com';
export const DINGTALK_GATEWAY_URL = 'https://api.dingtalk.com/v1.0/gateway/connections/open';
export const TOPIC_ROBOT = '/v1.0/im/bot/messages/get';
export const TOPIC_CARD = '/v1.0/card/instances/callback';

/** `POST /v1.0/gateway/connections/open` AbortController timeout. */
export const DINGTALK_GATEWAY_OPEN_TIMEOUT_MS = 15_000;
/** WebSocket constructor → `open` (or `error`/`close`) timeout. */
export const DINGTALK_SOCKET_OPEN_TIMEOUT_MS = 15_000;
/** How often the frame-silence watchdog runs. */
export const DINGTALK_STREAM_WATCHDOG_INTERVAL_MS = 30_000;
/**
 * Terminate + reconnect when nothing has proved the socket alive for this long.
 * Application frames and protocol `pong`s both reset the clock. A socket that
 * stops answering pings still hits this watchdog (and the shorter pong timeout).
 */
export const DINGTALK_STREAM_FRAME_SILENCE_MS = 180_000;
/** `ws` protocol-level ping interval. */
export const DINGTALK_STREAM_WS_PING_INTERVAL_MS = 30_000;
/** Terminate when a protocol ping is not answered with `pong`. */
export const DINGTALK_STREAM_WS_PONG_TIMEOUT_MS = 10_000;
export const MARKDOWN_MAX_BYTES = 18 * 1024;
export const DINGTALK_NOT_ASKER_REPLY = '仅提问人可操作';
export const DINGTALK_MARKDOWN_TITLE_FALLBACK = '回复';
export const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
export const CONVERSATION_TYPE_DM = '1';
export const CONVERSATION_TYPE_GROUP = '2';
