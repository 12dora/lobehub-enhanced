export interface MeetingRoomIssue {
  reason: string;
  roomName: string;
}

const REASON_MAX = 120;

const clipText = (value: string, max = REASON_MAX): string => {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
};

/** Strip URLs, UUIDs, long hex ids, and staff tokens from room-policy text. */
const sanitizeRoomText = (value: string): string => {
  const stripped = value
    .replaceAll(/https?:\/\/\S+/gi, ' ')
    .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ')
    .replaceAll(/\b[0-9a-f]{16,}\b/gi, ' ')
    .replaceAll(/\bstaff:[\w-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return clipText(stripped);
};

const isOpaqueId = (value: string): boolean => /^[0-9a-f-]{8,}$/i.test(value);

/**
 * Translate the few known English booking-policy sentences. Unknown text is
 * returned as-is (already sanitized).
 */
export const translateRoomPolicyReason = (text: string): string => {
  const notLessMinutes = /not\s+(?:be\s+)?less\s+than\s+(\d+)\s+minutes/i.exec(text);
  if (notLessMinutes) return `预订时长不得少于 ${notLessMinutes[1]} 分钟`;
  const notMoreMinutes = /not\s+(?:be\s+)?more\s+than\s+(\d+)\s+minutes/i.exec(text);
  if (notMoreMinutes) return `预订时长不得超过 ${notMoreMinutes[1]} 分钟`;
  const notMoreBare = /not\s+(?:be\s+)?more\s+than\s+(\d+)/i.exec(text);
  if (notMoreBare) return `不得超过 ${notMoreBare[1]}`;
  if (/outside\s+bookable\s+hours/i.test(text) || /not\s+within\s+bookable/i.test(text)) {
    return '不在可预订时段内';
  }
  if (/already\s+booked/i.test(text) || /has\s+been\s+booked/i.test(text)) {
    return '该时段已被预订';
  }
  if (/needs?\s+approval/i.test(text) || /requires?\s+approval/i.test(text)) {
    return '需要审批';
  }
  return text;
};

const extractDeveloperMessageArray = (message: string): unknown[] => {
  const marker = message.search(/developerMessage\s*:/i);
  if (marker < 0) return [];
  const rest = message.slice(marker);
  const start = rest.indexOf('[');
  if (start < 0) return [];
  const jsonSlice = rest.slice(start);
  try {
    const parsed: unknown = JSON.parse(jsonSlice);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const items: unknown[] = [];
    for (const match of jsonSlice.matchAll(/\{[^{}]+\}/g)) {
      try {
        items.push(JSON.parse(match[0]));
      } catch {
        // Truncated object; skip.
      }
    }
    return items;
  }
};

const issueFromRow = (value: unknown): MeetingRoomIssue | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const rawName = typeof row.roomName === 'string' ? row.roomName : '';
  const rawReason =
    typeof row.text === 'string' ? row.text : typeof row.reason === 'string' ? row.reason : '';
  const reason = clipText(translateRoomPolicyReason(sanitizeRoomText(rawReason)));
  if (!reason) return null;
  const sanitizedName = sanitizeRoomText(rawName);
  const roomName = !sanitizedName || isOpaqueId(sanitizedName) ? '会议室' : sanitizedName;
  return { reason, roomName };
};

/** Parse DingTalk `developerMessage` JSON embedded in a clipped upstream message. */
export const parseMeetingRoomIssues = (message: string | undefined): MeetingRoomIssue[] => {
  if (!message) return [];
  const issues: MeetingRoomIssue[] = [];
  for (const item of extractDeveloperMessageArray(message)) {
    const issue = issueFromRow(item);
    if (issue) issues.push(issue);
  }
  return issues;
};
