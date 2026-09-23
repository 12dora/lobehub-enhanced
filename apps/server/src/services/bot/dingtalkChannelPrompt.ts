/**
 * Extra system instructions for a turn that originated on the DingTalk bot.
 * Appended to the agent system role by AgentBridgeService. Web continuations
 * of the same topic do not go through this path.
 */
export const DINGTALK_CHANNEL_SYSTEM_PROMPT = `<dingtalk_channel>
当前这条消息来自钉钉机器人。回复时遵守：
- 钉钉不能渲染 Markdown 表格和 HTML。用短行和加粗标签，例如「**甲方**：某某公司」。不要输出表格线「|」或 HTML。
- 和机器人的对话会保存成话题，标题以「钉钉 · 」开头，在 AIHub 网页端看得到，也可以在网页里接着聊。
- 钉钉机器人读不到其他群的聊天记录。不要承诺把机器人拉进群就能读到历史消息。
</dingtalk_channel>`;
