import { resolveActionHref } from '@/components/ActionLink/href';

/**
 * Failure reasons the DingTalk toolsets store in their results were, until recently, the sentence
 * written for the model: 「未找到该待办或日程（DINGTALK_NOT_FOUND）。请先 listTodos / listEvents 确认
 * id…」. History keeps those, so the cards clean them before a reader sees them. Newer results carry
 * a stable `errorCode` plus a short Chinese `error`, and this only has to leave those alone.
 */

/**
 * 「（DINGTALK_NOT_FOUND）」「(VALIDATION)」: a code is for the model and the logs, never the reader.
 * Only code-shaped words go — 「（PDF）」 in a reason is the reader's own business.
 */
const CODE_FRAGMENT = /\s*[(（]\s*(?:[A-Z][\dA-Z]*(?:_[\dA-Z]+)+|VALIDATION)\s*[)）]/g;

/** A sentence containing one of these talks to the model, not to the person reading the card. */
const MODEL_DIRECTED: readonly RegExp[] = [/不要向用户/, /请先\s*list/i, /请点击下方卡片/];

const MARKDOWN_LINK = /\[[^\n\]]+\]\([^\s)]+\)/g;

/**
 * Sentences end at 。！？ — full-width only: an ASCII `?` belongs to URLs, while a URL never holds
 * a full-width stop (it would be percent-encoded), so a `[text](url)` link stays in one piece.
 */
const SENTENCE = /[^。！？]+[。！？]*/g;

/**
 * The reader's version of a failure reason: codes stripped wherever they sit, sentences addressed
 * to the model dropped. A dropped sentence still hands over its `[text](url)` link — that link is
 * the way out (e.g. 「请点击下方卡片的「授权」按钮，或打开：[点此前往授权](…)」). `undefined` when
 * nothing readable is left.
 */
export const toReaderReason = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const sentences = value.replaceAll(CODE_FRAGMENT, '').match(SENTENCE) ?? [];
  const text = sentences
    .map((sentence) =>
      MODEL_DIRECTED.some((pattern) => pattern.test(sentence))
        ? (sentence.match(MARKDOWN_LINK) ?? []).join(' ')
        : sentence,
    )
    .join('')
    .replaceAll(/\s+/g, ' ')
    .trim();

  return text || undefined;
};

/**
 * Where a failed item is fixed (DingTalk's permission apply page, the authorization or settings
 * page): an absolute https URL, or an allow-listed in-app path (the browser runtime has no app
 * origin, so settings links arrive relative). No `http:`, `javascript:` or protocol-relative
 * target becomes a link.
 */
export const toBatchActionHref = (value: unknown): string | undefined =>
  resolveActionHref(value)?.href;

export const BATCH_ACTION_LABEL_LIMIT = 20;

/** The label the server gave the fix-it link (「申请权限」「去授权」), one short line. */
export const toBatchActionLabel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

  const label = value.replaceAll(/\s+/g, ' ').trim();
  return label ? label.slice(0, BATCH_ACTION_LABEL_LIMIT) : undefined;
};

/** 「未执行」: the batch stopped before this item. It says exactly that, whatever else it carries. */
export const BATCH_SKIPPED_REASON = '未执行';
