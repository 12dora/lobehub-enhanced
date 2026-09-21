import { describe, expect, it } from 'vitest';

import { parseMeetingRoomIssues, translateRoomPolicyReason } from './roomIssues';

const LIVE_MESSAGE =
  'code: 321001, developerMessage: [{"roomName":"捷发2楼会议室","text":"The reservation period shall not be less than 30 minutes."}]';

describe('parseMeetingRoomIssues', () => {
  it('parses the live developerMessage payload into a sanitized room policy', () => {
    expect(parseMeetingRoomIssues(LIVE_MESSAGE)).toEqual([
      { reason: '预订时长不得少于 30 分钟', roomName: '捷发2楼会议室' },
    ]);
  });

  it('returns an empty list when the message is missing or has no array', () => {
    expect(parseMeetingRoomIssues(undefined)).toEqual([]);
    expect(parseMeetingRoomIssues('meetingRoomNotAvailable')).toEqual([]);
  });

  it('recovers complete objects from a truncated developerMessage array', () => {
    const truncated =
      'developerMessage: [{"roomName":"一号会议室","text":"already booked"},{"roomName":"二';
    expect(parseMeetingRoomIssues(truncated)).toEqual([
      { reason: '该时段已被预订', roomName: '一号会议室' },
    ]);
  });

  it('clips reason to 120 chars and strips urls and ids', () => {
    const reason = `See https://open.dingtalk.com/foo ${'详'.repeat(200)} id 57e7f53257e7f53257e7f532 staff:abc`;
    const message = `developerMessage: ${JSON.stringify([{ reason, roomName: 'A' }])}`;
    const issues = parseMeetingRoomIssues(message);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason.length).toBeLessThanOrEqual(120);
    expect(issues[0]?.reason).not.toContain('https://');
    expect(issues[0]?.reason).not.toContain('57e7f53257e7f53257e7f532');
    expect(issues[0]?.reason).not.toContain('staff:abc');
  });

  it('does not surface a hex room id as the display name', () => {
    const message =
      'developerMessage: [{"roomName":"57e7f532-aaaa-bbbb-cccc-ddddeeeeff00","text":"needs approval"}]';
    expect(parseMeetingRoomIssues(message)).toEqual([{ reason: '需要审批', roomName: '会议室' }]);
  });
});

describe('translateRoomPolicyReason', () => {
  it.each([
    ['The reservation period shall not be less than 30 minutes.', '预订时长不得少于 30 分钟'],
    ['Shall not be more than 120 minutes', '预订时长不得超过 120 分钟'],
    ['not more than 8', '不得超过 8'],
    ['outside bookable hours', '不在可预订时段内'],
    ['The room has been booked', '该时段已被预订'],
    ['This booking needs approval', '需要审批'],
    ['房间维修中', '房间维修中'],
  ] as const)('translates %s', (input, expected) => {
    expect(translateRoomPolicyReason(input)).toBe(expected);
  });
});
