import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  Root,
  ThreadInfo,
  WebhookOptions,
} from 'chat';
import { BaseFormatConverter, Message, parseMarkdown, stringifyMarkdown } from 'chat';

import { DingTalkApiClient } from './api';
import {
  decodeDingTalkThreadId,
  encodeDingTalkThreadId,
  getDingTalkSession,
  isSessionWebhookLive,
  rememberDingTalkSession,
  sessionFromRobotMessage,
  threadIdFromRobotMessage,
} from './threadId';
import type {
  DingTalkAdapterConfig,
  DingTalkMediaContent,
  DingTalkRobotMessage,
  DingTalkSessionContext,
  DingTalkThreadId,
} from './types';
import { CONVERSATION_TYPE_DM, CONVERSATION_TYPE_GROUP, MARKDOWN_MAX_BYTES } from './types';

class DingTalkFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  toAst(text: string): Root {
    return parseMarkdown(text);
  }
}

const utf8ByteLength = (text: string): number => Buffer.byteLength(text, 'utf8');

const splitHard = (text: string, maxBytes: number): string[] => {
  const chunks: string[] = [];
  let remaining = text;
  while (utf8ByteLength(remaining) > maxBytes) {
    let lo = 0;
    let hi = remaining.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (utf8ByteLength(remaining.slice(0, mid)) <= maxBytes) lo = mid;
      else hi = mid - 1;
    }
    if (lo === 0) break;
    chunks.push(remaining.slice(0, lo));
    remaining = remaining.slice(lo);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
};

/**
 * Split markdown into chunks of at most `maxBytes` (default 18 KiB), preferring
 * paragraph (`\n\n`) then line boundaries before a hard UTF-8 cut.
 */
export function chunkMarkdown(text: string, maxBytes: number = MARKDOWN_MAX_BYTES): string[] {
  if (utf8ByteLength(text) <= maxBytes) return text ? [text] : [];

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current) {
      chunks.push(current);
      current = '';
    }
  };

  const pushPiece = (piece: string) => {
    if (!piece) return;
    if (utf8ByteLength(piece) > maxBytes) {
      flush();
      chunks.push(...splitHard(piece, maxBytes));
      return;
    }
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (utf8ByteLength(candidate) <= maxBytes) {
      current = candidate;
      return;
    }
    flush();
    current = piece;
  };

  for (const paragraph of paragraphs) {
    if (utf8ByteLength(paragraph) <= maxBytes) {
      pushPiece(paragraph);
      continue;
    }
    for (const line of paragraph.split('\n')) {
      if (utf8ByteLength(line) <= maxBytes) {
        const candidate = current ? `${current}\n${line}` : line;
        if (utf8ByteLength(candidate) <= maxBytes) {
          current = candidate;
        } else {
          flush();
          current = line;
        }
      } else {
        flush();
        chunks.push(...splitHard(line, maxBytes));
      }
    }
  }
  flush();
  return chunks;
}

const markdownTitle = (text: string): string => {
  const line = text.split('\n').find((item) => item.trim());
  if (!line) return 'Reply';
  return line.replace(/^#+\s*/, '').slice(0, 32) || 'Reply';
};

const guessMimeFromName = (name: string, fallback: string): string => {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': {
      return 'image/png';
    }
    case 'jpg':
    case 'jpeg': {
      return 'image/jpeg';
    }
    case 'gif': {
      return 'image/gif';
    }
    case 'pdf': {
      return 'application/pdf';
    }
    case 'mp3': {
      return 'audio/mpeg';
    }
    case 'mp4': {
      return 'video/mp4';
    }
    default: {
      return fallback;
    }
  }
};

const collectDownloadCodes = (
  payload: DingTalkRobotMessage,
): Array<{
  downloadCode: string;
  mimeType: string;
  name: string;
  type: Attachment['type'];
}> => {
  const items: Array<{
    downloadCode: string;
    mimeType: string;
    name: string;
    type: Attachment['type'];
  }> = [];

  const push = (
    content: DingTalkMediaContent | undefined,
    type: Attachment['type'],
    fallbackName: string,
    mimeType: string,
  ) => {
    const downloadCode = content?.downloadCode ?? content?.pictureDownloadCode;
    if (!downloadCode) return;
    const name = content?.fileName || fallbackName;
    items.push({
      downloadCode,
      mimeType: guessMimeFromName(name, mimeType),
      name,
      type,
    });
  };

  switch (payload.msgtype) {
    case 'picture': {
      push(payload.content ?? payload.picture, 'image', 'image.jpg', 'image/jpeg');
      break;
    }
    case 'file': {
      push(payload.content, 'file', 'file', 'application/octet-stream');
      break;
    }
    case 'audio': {
      push(payload.content, 'audio', 'audio.mp3', 'audio/mpeg');
      break;
    }
    case 'video': {
      push(payload.content, 'video', 'video.mp4', 'video/mp4');
      break;
    }
    case 'richText': {
      const rich = payload.content?.richText ?? payload.richText?.richText ?? [];
      for (const [index, part] of rich.entries()) {
        if (part.picture?.downloadCode) {
          items.push({
            downloadCode: part.picture.downloadCode,
            mimeType: 'image/jpeg',
            name: `image-${index + 1}.jpg`,
            type: 'image',
          });
        }
      }
      break;
    }
    default: {
      break;
    }
  }

  return items;
};

/**
 * Metadata-only attachments — no downloads. Media bytes are fetched later by
 * `downloadMediaFromRawMessage` after a chat-sdk Redis round-trip.
 */
export function extractMediaMetadata(raw: DingTalkRobotMessage): Attachment[] {
  return collectDownloadCodes(raw).map(
    (item) =>
      ({
        mimeType: item.mimeType,
        name: item.name,
        type: item.type,
      }) as Attachment,
  );
}

export async function downloadMediaFromRawMessage(
  api: DingTalkApiClient,
  raw: DingTalkRobotMessage,
  logger?: Pick<Logger, 'warn'>,
): Promise<Attachment[]> {
  const robotCode = raw.robotCode;
  if (!robotCode) return [];

  const attachments: Attachment[] = [];
  for (const item of collectDownloadCodes(raw)) {
    try {
      const file = await api.downloadMessageFile({
        downloadCode: item.downloadCode,
        robotCode,
      });
      attachments.push({
        buffer: file.buffer,
        mimeType: file.mimeType ?? item.mimeType,
        name: file.filename ?? item.name,
        type: item.type,
      } as Attachment);
    } catch (error) {
      logger?.warn?.('Failed to download %s media for message %s: %s', item.type, raw.msgId, error);
    }
  }
  return attachments;
}

const extractText = (payload: DingTalkRobotMessage): string => {
  if (payload.msgtype === 'text') {
    return payload.text?.content ?? '';
  }
  if (payload.msgtype === 'richText') {
    const rich = payload.content?.richText ?? payload.richText?.richText ?? [];
    return rich
      .map((part) => part.text ?? '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

const isBotMention = (payload: DingTalkRobotMessage): boolean => {
  if (payload.conversationType === CONVERSATION_TYPE_DM) return true;
  if (payload.isInAtList === true) return true;
  if (payload.isInAtList === false) return false;
  return (payload.atUsers?.length ?? 0) > 0;
};

const isCardCallback = (body: Record<string, unknown>): boolean =>
  typeof body.outTrackId === 'string' || body.userId !== undefined;

export class DingTalkAdapter implements Adapter<DingTalkThreadId, DingTalkRobotMessage> {
  readonly name = 'dingtalk';
  readonly persistThreadHistory = true;

  private readonly api: DingTalkApiClient;
  private readonly robotCode: string;
  private readonly formatConverter = new DingTalkFormatConverter();
  private _userName: string;
  private chat!: ChatInstance;
  private logger!: Logger;

  constructor(config: DingTalkAdapterConfig) {
    this.api = new DingTalkApiClient(config.clientId, config.clientSecret);
    this.robotCode = config.robotCode;
    this._userName = config.userName || 'dingtalk-bot';
  }

  get userName(): string {
    return this._userName;
  }

  get apiClient(): DingTalkApiClient {
    return this.api;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger(this.name);
    this._userName = chat.getUserName() || this._userName;
    await this.api.getAccessToken();
    this.logger.info('Initialized dingtalk adapter');
  }

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const bodyText = await request.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (isCardCallback(body) && !body.msgtype) {
      return Response.json({ ok: true });
    }

    const payload = body as unknown as DingTalkRobotMessage;
    if (!payload.msgId || !payload.conversationId) {
      return Response.json({ ok: true });
    }

    rememberDingTalkSession(sessionFromRobotMessage(payload));

    const messageText = extractText(payload).trim();
    const hasMedia = extractMediaMetadata(payload).length > 0;
    if (!messageText && !hasMedia) {
      return Response.json({ ok: true });
    }

    const threadId = threadIdFromRobotMessage(payload);
    const messageFactory = () => this.parseRawEvent(payload, threadId, messageText);
    this.chat.processMessage(this, threadId, messageFactory, options);
    return Response.json({ ok: true });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<DingTalkRobotMessage>> {
    const text = this.formatConverter.renderPostable(message);
    await this.sendMarkdown(threadId, text);
    return {
      id: `dingtalk_${Date.now()}`,
      raw: {
        conversationId: this.decodeThreadId(threadId).conversationId,
        conversationType: this.isDM(threadId) ? CONVERSATION_TYPE_DM : CONVERSATION_TYPE_GROUP,
        msgId: '',
        msgtype: 'markdown',
        text: { content: text },
      },
      threadId,
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<DingTalkRobotMessage>> {
    // DingTalk robot messages are not editable; AI-card streaming is a separate path.
    return {
      id: messageId,
      raw: {
        conversationId: this.decodeThreadId(threadId).conversationId,
        conversationType: this.isDM(threadId) ? CONVERSATION_TYPE_DM : CONVERSATION_TYPE_GROUP,
        msgId: messageId,
        msgtype: 'markdown',
        text: { content: this.formatConverter.renderPostable(message) },
      },
      threadId,
    };
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    // DingTalk robots cannot delete messages.
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<DingTalkRobotMessage>> {
    return { messages: [] };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const decoded = this.decodeThreadId(threadId);
    const session = getDingTalkSession(threadId) ?? getDingTalkSession(decoded.conversationId);
    return {
      channelId: decoded.conversationId,
      channelName: session?.senderNick,
      id: threadId,
      isDM: this.isDM(threadId),
      metadata: { conversationId: decoded.conversationId, senderStaffId: decoded.senderStaffId },
    };
  }

  parseMessage(raw: DingTalkRobotMessage): Message<DingTalkRobotMessage> {
    const threadId = threadIdFromRobotMessage(raw);
    const text = extractText(raw).trim();
    return new Message({
      attachments: extractMediaMetadata(raw),
      author: this.authorFromPayload(raw),
      formatted: parseMarkdown(text),
      id: raw.msgId,
      isMention: isBotMention(raw),
      metadata: {
        dateSent: raw.createAt ? new Date(raw.createAt) : new Date(),
        edited: false,
      },
      raw,
      text,
      threadId,
    });
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // DingTalk robots have no reaction API.
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    // no-op
  }

  async startTyping(_threadId: string): Promise<void> {
    // DingTalk robots have no typing indicator.
  }

  encodeThreadId(data: DingTalkThreadId): string {
    return encodeDingTalkThreadId(data);
  }

  decodeThreadId(threadId: string): DingTalkThreadId {
    return decodeDingTalkThreadId(threadId);
  }

  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).conversationId;
  }

  isDM(threadId: string): boolean {
    return this.decodeThreadId(threadId).senderStaffId === undefined;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  async sendMarkdown(threadId: string, markdown: string): Promise<void> {
    const decoded = this.decodeThreadId(threadId);
    const session = getDingTalkSession(threadId) ?? getDingTalkSession(decoded.conversationId);
    const atUserIds = this.isDM(threadId)
      ? []
      : ([decoded.senderStaffId || session?.senderStaffId].filter(Boolean) as string[]);
    const chunks = chunkMarkdown(markdown);
    const pieces = chunks.length > 0 ? chunks : [markdown];

    for (const chunk of pieces) {
      const body = this.withGroupMention(chunk, session, atUserIds);
      await this.dispatchMarkdown(threadId, session, body, atUserIds);
    }
  }

  private withGroupMention(
    text: string,
    session: DingTalkSessionContext | undefined,
    atUserIds: string[],
  ): string {
    if (atUserIds.length === 0) return text;
    const staffId = atUserIds[0];
    const mention = `@${session?.senderNick || staffId}`;
    if (text.includes(mention) || text.includes(`@${staffId}`)) return text;
    return `${mention} ${text}`;
  }

  private async dispatchMarkdown(
    threadId: string,
    session: DingTalkSessionContext | undefined,
    text: string,
    atUserIds: string[],
  ): Promise<void> {
    const title = markdownTitle(text);
    if (isSessionWebhookLive(session) && session?.sessionWebhook) {
      const payload: Record<string, unknown> = {
        markdown: { text, title },
        msgtype: 'markdown',
      };
      if (atUserIds.length > 0) {
        payload.at = { atUserIds };
      }
      await this.api.sendBySessionWebhook(session.sessionWebhook, payload);
      return;
    }

    const robotCode = session?.robotCode || this.robotCode;
    const decoded = this.decodeThreadId(threadId);
    const msgParam = JSON.stringify({ text, title });

    if (this.isDM(threadId)) {
      const userId = session?.senderStaffId;
      if (!userId) {
        throw new Error(`DingTalk DM send requires senderStaffId for thread ${threadId}`);
      }
      await this.api.sendOtoMessage({
        msgKey: 'sampleMarkdown',
        msgParam,
        robotCode,
        userIds: [userId],
      });
      return;
    }

    await this.api.sendGroupMessage({
      msgKey: 'sampleMarkdown',
      msgParam,
      openConversationId: decoded.conversationId,
      robotCode,
    });
  }

  private parseRawEvent(
    payload: DingTalkRobotMessage,
    threadId: string,
    messageText: string,
  ): Promise<Message<DingTalkRobotMessage>> {
    return Promise.resolve(
      new Message({
        attachments: extractMediaMetadata(payload),
        author: this.authorFromPayload(payload),
        formatted: parseMarkdown(messageText),
        id: payload.msgId,
        isMention: isBotMention(payload),
        metadata: {
          dateSent: payload.createAt ? new Date(payload.createAt) : new Date(),
          edited: false,
        },
        raw: payload,
        text: messageText,
        threadId,
      }),
    );
  }

  private authorFromPayload(payload: DingTalkRobotMessage): Author {
    const staffId = payload.senderStaffId || payload.senderId || 'unknown';
    const name = payload.senderNick || staffId;
    return {
      fullName: name,
      isBot: false,
      isMe: false,
      userId: staffId,
      userName: name,
    };
  }
}

export function createDingTalkAdapter(config: DingTalkAdapterConfig): DingTalkAdapter {
  return new DingTalkAdapter(config);
}

export { decodeDingTalkThreadId, encodeDingTalkThreadId };
