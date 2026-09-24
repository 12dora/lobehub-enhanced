import { buildDingTalkAppUrl, markdownLink } from '@lobechat/utils/appLink';

/**
 * DingTalk messenger runs stay `approvalMode: 'headless'` so overridable tools
 * still auto-run. Tool-level `humanIntervention: 'always'` is parked instead
 * (confirm card). Anything else headless still blocks — in Chinese, with a
 * topic link when the run already has one.
 */
export const isDingTalkMessengerMetadata = (
  metadata: Record<string, unknown> | undefined,
): boolean => {
  const bot = metadata?.botContext;
  if (!bot || typeof bot !== 'object') return false;
  const record = bot as Record<string, unknown>;
  return (
    record.platform === 'dingtalk' &&
    typeof record.messengerInstallationKey === 'string' &&
    record.messengerInstallationKey.length > 0
  );
};

const topicPath = (metadata: Record<string, unknown> | undefined): string => {
  const agentId = typeof metadata?.agentId === 'string' ? metadata.agentId : '';
  const topicId = typeof metadata?.topicId === 'string' ? metadata.topicId : '';
  if (!agentId || !topicId) return '';
  const origin = (process.env.APP_URL || '').replace(/\/$/, '');
  const path = `/agent/${agentId}/${topicId}`;
  return buildDingTalkAppUrl(origin, path);
};

/** Tool result text for a headless block that is not an approval-card park. */
export const formatDingTalkImHeadlessBlockedContent = (
  metadata: Record<string, unknown> | undefined,
): string => {
  const link = topicPath(metadata);
  const where = link ? `请${markdownLink('在网页端确认', link)}。` : '请到网页端确认。';
  return `该操作需要本人确认，但当前钉钉会话不能代为批准（安全策略已拦截）。${where}`;
};
