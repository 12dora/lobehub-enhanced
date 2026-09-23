const content = `# lh bot - Bot Integration Management

Manage bot integrations that connect agents to messaging platforms.

## Supported Platforms

Discord, Slack, Telegram, Lark, Feishu, 钉钉

钉钉 is this deployment's channel. Group history cannot be read (钉钉开放平台不提供该能力). Do not use \`lh bot message read\` for 钉钉, and do not run \`lh\` via \`runCommand\` for platform operations — \`lh\` is not installed in the sandbox. Use builtin tools. Notify colleagues (催交 / 提醒某人) with lobe-reminder.

## Subcommands

- \`lh bot list [-a <agentId>] [--platform <p>]\` - List bot integrations
- \`lh bot view <botId> [-a <agentId>]\` - View bot details
- \`lh bot add -a <agentId> --platform <p> [--bot-token <t>] [--app-id <id>]\` - Add bot to agent
- \`lh bot update <botId> [--bot-token <t>] [--platform <p>]\` - Update bot credentials
- \`lh bot remove <botId> [--yes]\` - Remove bot integration
- \`lh bot enable <botId>\` - Enable bot
- \`lh bot disable <botId>\` - Disable bot
- \`lh bot connect <botId> [-a <agentId>]\` - Connect and start bot

## Message Subcommands

- \`lh bot message send <botId> --target <channelId> --message <text> [--reply-to <messageId>] [--json]\` - Send a message
- \`lh bot message read <botId> --target <channelId> [--limit <n>] [--before <messageId>] [--after <messageId>] [--json]\` - Read messages from a channel
- \`lh bot message edit <botId> --target <channelId> --message-id <id> --message <text>\` - Edit a message
- \`lh bot message delete <botId> --target <channelId> --message-id <id> [--yes]\` - Delete a message
- \`lh bot message search <botId> --target <channelId> --query <text> [--author-id <id>] [--limit <n>] [--json]\` - Search messages
- \`lh bot message react <botId> --target <channelId> --message-id <id> --emoji <emoji>\` - Add reaction
- \`lh bot message reactions <botId> --target <channelId> --message-id <id> [--json]\` - List reactions
- \`lh bot message pin <botId> --target <channelId> --message-id <id>\` - Pin a message
- \`lh bot message unpin <botId> --target <channelId> --message-id <id>\` - Unpin a message
- \`lh bot message pins <botId> --target <channelId> [--json]\` - List pinned messages
- \`lh bot message poll <botId> --target <channelId> --poll-question <text> --poll-option <opt> [--poll-multi] [--poll-duration-hours <n>]\` - Create a poll
- \`lh bot message thread create <botId> --target <channelId> --thread-name <name> [--message <text>] [--message-id <id>]\` - Create thread
- \`lh bot message thread list <botId> --target <channelId> [--json]\` - List threads
- \`lh bot message thread reply <botId> --thread-id <id> --message <text>\` - Reply to thread
- \`lh bot message channel list <botId> [--server-id <id>] [--filter <type>] [--json]\` - List channels
- \`lh bot message channel info <botId> --target <channelId> [--json]\` - Get channel info
- \`lh bot message member info <botId> --member-id <id> [--server-id <id>] [--json]\` - Get member info

## Tips

- Each platform requires specific credentials (token, app ID, secrets)
- Use \`lh bot connect\` to start a long-running bot connection
- Batch history on platforms that support it uses lobe-message \`readMessages\`, not \`lh bot message read\` (the sandbox has no \`lh\`). 钉钉 group history cannot be read.
- For step-by-step platform setup instructions, read the platform-specific reference under \`references/bot/\`: \`discord\`, \`telegram\`, \`slack\`, \`feishu\`, \`lark\`, \`qq\`, \`wechat\`
`;

export default content;
