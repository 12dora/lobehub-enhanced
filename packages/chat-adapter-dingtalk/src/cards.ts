import { randomUUID } from 'node:crypto';

import type { DingTalkApiClient } from './api';
import { rememberDingTalkCard } from './threadId';
import type { DingTalkActionCardButton, DingTalkActionCardParam } from './types';
import {
  CONVERSATION_TYPE_DM,
  CONVERSATION_TYPE_GROUP,
  DingTalkCardUnavailableError,
} from './types';

const DTMD_SEND_MESSAGE = 'dtmd://dingtalkclient/sendMessage?content=';

export const dtmdSendMessageUrl = (command: string): string =>
  `${DTMD_SEND_MESSAGE}${encodeURIComponent(command)}`;

/**
 * Single-button ActionCard (`sampleActionCard`). Never emits a second button.
 * `msgParam` field order matches the DingTalk robot contract:
 * `{ title, text, singleTitle, singleURL }`.
 */
export function buildSampleActionCardParam(options: {
  singleTitle: string;
  singleURL: string;
  text: string;
  title: string;
}): DingTalkActionCardParam {
  return {
    msgKey: 'sampleActionCard',
    msgParam: JSON.stringify({
      title: options.title,
      text: options.text,
      singleTitle: options.singleTitle,
      singleURL: options.singleURL,
    }),
  };
}

/**
 * Build `msgKey` + `msgParam` for a DingTalk ActionCard whose buttons inject
 * a command back into the chat via `dtmd://dingtalkclient/sendMessage`.
 *
 * 1 button → `sampleActionCard` (singleTitle / singleURL).
 * 2–5 buttons → `sampleActionCard2` … `sampleActionCard5`.
 */
export function buildActionCardParam(options: {
  buttons: DingTalkActionCardButton[];
  text: string;
  title: string;
}): DingTalkActionCardParam {
  const buttons = options.buttons.slice(0, 5);
  if (buttons.length <= 1) {
    const button = buttons[0];
    return buildSampleActionCardParam({
      singleTitle: button?.label ?? '',
      singleURL: button ? dtmdSendMessageUrl(button.command) : '',
      text: options.text,
      title: options.title,
    });
  }

  const msgParam: Record<string, string> = {
    text: options.text,
    title: options.title,
  };
  buttons.forEach((button, index) => {
    const n = index + 1;
    msgParam[`actionTitle${n}`] = button.label;
    msgParam[`actionURL${n}`] = dtmdSendMessageUrl(button.command);
  });

  return {
    msgKey: `sampleActionCard${buttons.length}`,
    msgParam: JSON.stringify(msgParam),
  };
}

export interface DingTalkAiCardStreamOptions {
  cardTemplateId: string;
  /** Robot-message conversation id. Required (with staffId) to remember the card. */
  conversationId?: string;
  /** Group open-conversation id for card delivery only — never used as conversationId. */
  openConversationId?: string;
  outTrackId?: string;
  robotCode: string;
  staffId?: string;
}

/**
 * Create → stream chunks → finalize an AI card. Any API failure throws
 * `DingTalkCardUnavailableError` so callers can fall back to markdown.
 */
export class DingTalkAiCardStream {
  private readonly api: DingTalkApiClient;
  private readonly options: DingTalkAiCardStreamOptions;
  private created = false;
  readonly outTrackId: string;

  constructor(api: DingTalkApiClient, options: DingTalkAiCardStreamOptions) {
    this.api = api;
    this.options = options;
    this.outTrackId = options.outTrackId ?? randomUUID();
  }

  async create(initialContent = ''): Promise<void> {
    try {
      await this.api.createAndDeliverCard({
        cardData: { cardParamMap: { content: initialContent } },
        cardTemplateId: this.options.cardTemplateId,
        openConversationId: this.options.openConversationId,
        outTrackId: this.outTrackId,
        robotCode: this.options.robotCode,
        staffId: this.options.staffId,
      });
      this.created = true;
      const conversationId = this.options.conversationId?.trim() ?? '';
      const staffId = this.options.staffId?.trim() ?? '';
      if (conversationId && staffId) {
        rememberDingTalkCard(this.outTrackId, {
          askerStaffId: staffId,
          conversationId,
          conversationType: this.options.openConversationId
            ? CONVERSATION_TYPE_GROUP
            : CONVERSATION_TYPE_DM,
        });
      }
    } catch (error) {
      throw this.wrap(error);
    }
  }

  /** Replace the full card body (`isFull: true`). */
  async replace(content: string): Promise<void> {
    await this.ensureCreated();
    try {
      await this.api.streamCard({
        content,
        isFinalize: false,
        isFull: true,
        key: 'content',
        outTrackId: this.outTrackId,
      });
    } catch (error) {
      throw this.wrap(error);
    }
  }

  /** Alias of `replace` — DingTalk streaming uses full snapshots. */
  async append(content: string): Promise<void> {
    await this.replace(content);
  }

  async finalize(content?: string): Promise<void> {
    await this.ensureCreated();
    try {
      await this.api.streamCard({
        content: content ?? '',
        isFinalize: true,
        isFull: true,
        key: 'content',
        outTrackId: this.outTrackId,
      });
    } catch (error) {
      throw this.wrap(error);
    }
  }

  private async ensureCreated(): Promise<void> {
    if (!this.created) {
      await this.create();
    }
  }

  private wrap(error: unknown): DingTalkCardUnavailableError {
    if (error instanceof DingTalkCardUnavailableError) return error;
    return new DingTalkCardUnavailableError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}
