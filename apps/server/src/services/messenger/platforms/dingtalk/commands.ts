export interface CommandMatch {
  args: string;
  name: string;
}

/**
 * Chinese + English aliases for DingTalk slash commands.
 * `/切换` maps to `/agents` (common.md `/切换 N` = `/use N`; `/use` is `/agents N`).
 */
export const DINGTALK_COMMAND_ALIASES: Record<string, string> = {
  agents: 'agents',
  help: 'help',
  new: 'new',
  resume: 'resume',
  status: 'status',
  stop: 'stop',
  topics: 'topics',
  use: 'agents',
  助手: 'agents',
  停止: 'stop',
  切换: 'agents',
  帮助: 'help',
  会话: 'topics',
  继续: 'resume',
  当前: 'status',
  新会话: 'new',
};

/** Parse a DingTalk slash command, including Chinese names and English aliases. */
export const parseDingTalkCommand = (text: string | undefined): CommandMatch | null => {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const body = trimmed.slice(1);
  const spaceIndex = body.search(/[ \t]/);
  const head = spaceIndex === -1 ? body : body.slice(0, spaceIndex);
  const args = spaceIndex === -1 ? '' : body.slice(spaceIndex).trim();
  const atIndex = head.indexOf('@');
  const rawName = atIndex === -1 ? head : head.slice(0, atIndex);
  if (!rawName) return null;
  const mapped =
    DINGTALK_COMMAND_ALIASES[rawName] ?? DINGTALK_COMMAND_ALIASES[rawName.toLowerCase()];
  if (!mapped) {
    return { args, name: rawName.toLowerCase() };
  }
  return { args, name: mapped };
};

export const isDingTalkSlashText = (text: string | undefined): boolean =>
  Boolean(text?.trim().startsWith('/'));

export const formatRelativeTimeZh = (date: Date, now = new Date()): string => {
  const deltaMs = now.getTime() - date.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return '刚刚';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export interface TopicListEntry {
  id: string;
  title: string;
  updatedAt: Date | string | number;
}

export const formatTopicListText = (
  topics: TopicListEntry[],
  now = new Date(),
): { lines: string[]; text: string } => {
  const lines = topics.map((topic, index) => {
    const title = topic.title?.trim() || '未命名会话';
    const when = formatRelativeTimeZh(new Date(topic.updatedAt), now);
    return `${index + 1}. ${title} · ${when}`;
  });
  return { lines, text: lines.join('\n') };
};

export const formatIdlePolicyZh = (params: {
  idleNewTopicEnabled?: boolean;
  idleNewTopicHours?: number;
}): string => {
  if (params.idleNewTopicEnabled === false) return '空闲策略：已关闭';
  const hours = params.idleNewTopicHours ?? 24;
  return `空闲策略：${hours} 小时后自动新会话`;
};

export const formatStatusText = (params: {
  agentName: string;
  idleNewTopicEnabled?: boolean;
  idleNewTopicHours?: number;
  topicTitle?: string;
}): string => {
  const topic = params.topicTitle?.trim() || '新会话';
  return [`当前助手：${params.agentName}`, `当前会话：${topic}`, formatIdlePolicyZh(params)].join(
    '\n',
  );
};
