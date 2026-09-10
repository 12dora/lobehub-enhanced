# 上游同步台账（lobehub/lobehub）

本仓库基于上游 **v2.2.10** 做二开，历史已 squash 为单根，因此上游更新只能按 PR 逐个 `git cherry-pick -x`，不能 `git merge`。
本文件记录每一轮同步的范围、已合入与已跳过的上游 PR 及原因，作为下一轮同步的起点。

## 同步方法

1. 在本仓库配置 `upstream` remote 并按需拉取标签：
   `git remote add upstream git@github.com:lobehub/lobehub.git && git fetch --filter=blob:none --no-tags upstream tag v2.2.10 tag v2.2.16`
2. 三方文件集比较：上游改动集 U（基线..新版）、二开改动集 F（基线..main）；`U ∩ F` 是冲突区，二开重写超过 200 行的文件视为热点，触及热点的 PR 只在能局部落地时合入。
3. 候选 PR 先在临时工作树里 `git cherry-pick -n` 试合并，登记冲突文件后再分批处理；每个 PR 单独提交，保留上游作者与 `(cherry picked from commit …)`。
4. locale JSON 冲突几乎都是基线漂移（二开只改过 zh-CN / en-US），按键做三方合并：保留二开字符串、补上游新增键。
5. 不做的事：不升第三方依赖、不改数据库 schema（上游迁移编号 0117+ 与二开 squash 前编号冲突，若将来需要合入必须重编号到 0030+ 并重生成 drizzle journal）、不合入会覆盖二开 admin / RBAC / 平台目录的功能。

## 第一轮：v2.2.10 → v2.2.16（2026-09-10，随 v1.3.0 发布）

上游区间：1,399 个提交 / 10,358 个文件 / 42 个迁移；二开改动 5,737 个文件；冲突区 1,077 个非 locale 文件（其中 121 个热点）。
决策：只摘取安全修复、可靠性修复、模型运行时与模型卡、小 UX 四类；大功能不合入。

### 已合入

| 上游 PR | 提交主题 | 上游提交 | 本仓库提交 |
| --- | --- | --- | --- |
| [#17044](https://github.com/lobehub/lobehub/pull/17044) | 🐛 fix: runtime unresolved tool calls (#17044) | `a5b1e52641` | `bb6e72c94` |
| [#17143](https://github.com/lobehub/lobehub/pull/17143) | 🐛 fix: openapi auth errors return 401 instead of 500 & mask real API key prefix (#17143) | `f0c5cd091b` | `77458ea32` |
| [#17305](https://github.com/lobehub/lobehub/pull/17305) | 🐛 fix: avoid sync peak (#17305) | `783d983514` | `e0228107f` |
| [#17458](https://github.com/lobehub/lobehub/pull/17458) | 🐛 fix(resource): preserve source metadata for parsed files (#17458) | `9b65c42a93` | `f5d69e89f` |
| [#17725](https://github.com/lobehub/lobehub/pull/17725) | 🐛 fix(agent-runtime): preserve grouped sub-agent final answers (#17725) | `aa06851a9c` | `1bc9bdd20` |
| [#17839](https://github.com/lobehub/lobehub/pull/17839) | 🐛 fix(context-engine): account container message tokens in context budget (#17839) | `cacf310895` | `378cb749b` |
| [#17919](https://github.com/lobehub/lobehub/pull/17919) | 🐛 fix(document): serialize the file parse cache write and order its lookup (#17919) | `b639878df1` | `81ae0de28` |
| [#18643](https://github.com/lobehub/lobehub/pull/18643) | 🐛 fix: prevent agent document edits from clearing content (#18643) | `b970f34c86` | `8bf5deb62` |
| [#18795](https://github.com/lobehub/lobehub/pull/18795) | 🐛 fix(context-engine): stop reporting image tool results as failed calls (#18795) | `c143d887d7` | `a56d681e8` |
| [#19021](https://github.com/lobehub/lobehub/pull/19021) | 🐛 fix(device-gateway): stop a hung handshake from parking the device client offline (#19021) | `95c8abd1df` | `3e0e53a62` |
| [#16896](https://github.com/lobehub/lobehub/pull/16896) | 🐛 fix: preflight OpenAI context limit errors (#16896) | `d1533b5777` | `0612f19a0` |
| [#17221](https://github.com/lobehub/lobehub/pull/17221) | 🐛 fix: map numeric chat errors to tRPC status (#17221) | `97f6a0fb10` | `5cf18b3d7` |
| [#17876](https://github.com/lobehub/lobehub/pull/17876) | 🐛 fix(agent-runtime): run blocking XREAD on a dedicated Redis connection (#17876) | `0a04d21dc3` | `857d312ed` |
| [#18507](https://github.com/lobehub/lobehub/pull/18507) | 🐛 fix(agent-runtime): stop sanitizeNullBytes from corrupting escape text (#18507) | `5072403ae0` | `1d8a121e7` |
| [#18587](https://github.com/lobehub/lobehub/pull/18587) | 🐛 fix(agent-runtime): support slim compression payloads (#18587) | `c3ed4078e8` | `935a4024c` |
| [#18626](https://github.com/lobehub/lobehub/pull/18626) | 🐛 fix(agent-runtime): prevent repeated context compression (#18626) | `718a960fb3` | `66d4ff250` |
| [#18688](https://github.com/lobehub/lobehub/pull/18688) | 🐛 fix: align error response status mapping (#18688) | `cd70af2f88` | `c1087fe4d` |
| [#18748](https://github.com/lobehub/lobehub/pull/18748) | 🐛 fix: align chat output cost estimate ratio (#18748) | `fe6b36ab1a` | `18e5a2f23` |
| [#19006](https://github.com/lobehub/lobehub/pull/19006) | 🐛 fix(model-runtime): classify SubscriptionPlanLimit in the error spec table (#19006) | `89cca7696f` | `8eae7c94a` |
| [#17733](https://github.com/lobehub/lobehub/pull/17733) | 💄 style: add Enter / Esc hotkeys to AskUserQuestion intervention (#17733) | `8126a8b62e` | `69af26e16` |
| [#17930](https://github.com/lobehub/lobehub/pull/17930) | 🐛 fix(conversation): fix layout jitter on tool-call turn completion (#17930) | `6691f621cd` | `c13df1924` |
| [#17935](https://github.com/lobehub/lobehub/pull/17935) | 🐛 fix(conversation): hide empty reasoning card for signature-only reasoning (#17935) | `e6efbc6660` | `e28971ac1` |
| [#17968](https://github.com/lobehub/lobehub/pull/17968) | 🐛 fix(conversation): skip empty content block placeholder and fold turn process at visible output end (#17968) | `f18d70eaed` | `82efaf46b` |
| [#18182](https://github.com/lobehub/lobehub/pull/18182) | 🐛 fix(chat): anchor the tool execution timer to the tool message createdAt (#18182) | `67cddfb022` | `76f04cddd` |
| [#18413](https://github.com/lobehub/lobehub/pull/18413) | 🐛 fix(chat): anchor tool timer to result message (#18413) | `b767af494b` | `e561b4649` |
| [#18462](https://github.com/lobehub/lobehub/pull/18462) | 🐛 fix(trpc): split message.getMessages out of the initial-load batch (#18462) | `2aebce0bc5` | `9250bd2f9` |
| [#18730](https://github.com/lobehub/lobehub/pull/18730) | 🐛 fix: enable disabled models from chat input (#18730) | `32285e8f77` | `0aa54fa73` |
| [#18858](https://github.com/lobehub/lobehub/pull/18858) | 🐛 fix(chat): make todo tray list scrollable (#18858) | `080364a7c0` | `8767af29e` |
| [#19073](https://github.com/lobehub/lobehub/pull/19073) | 🐛 fix(local-system): allow reading large PDFs (#19073) | `5d5c39760a` | `7c8fb86de` |
| [#19118](https://github.com/lobehub/lobehub/pull/19118) | ✨ feat(file): support .v / .sv (Verilog / SystemVerilog) attachments (#19118) | `5590527309` | `bc9652367` |
| [#17323](https://github.com/lobehub/lobehub/pull/17323) | 🔒 fix(mcp): stop leaking server process.env to stdio pre-check subprocess (#17323) | `f56bf98c25` | `03b85b2d1` |
| [#17465](https://github.com/lobehub/lobehub/pull/17465) | 🐛 fix: deduplicate AI model batch updates (#17465) | `7cc8b024fb` | `1df931cf9` |
| [#17703](https://github.com/lobehub/lobehub/pull/17703) | 🐛 fix: reuse assistant messages on step retry (#17703) | `27b26a823a` | `7c83dbdc1` |
| [#17726](https://github.com/lobehub/lobehub/pull/17726) | 🐛 fix: omit duplicate assistant continuations (#17726) | `11f7bc8d44` | `5df9f64c6` |
| [#17737](https://github.com/lobehub/lobehub/pull/17737) | 🐛 fix: filter failed assistant placeholders and harden Claude prefill guard (#17737) | `b6a8fcf0dc` | `b27b26bb9` |
| [#18610](https://github.com/lobehub/lobehub/pull/18610) | 🐛 fix(agent-runtime): remove compressed messages from queue payload (#18610) | `abbc941de9` | `86beda6b8` |
| [#18630](https://github.com/lobehub/lobehub/pull/18630) | 🐛 fix(context-engine): fix unstable web document index prompt (#18630) | `0887c8f5d7` | `1fffea35e` |
| [#18664](https://github.com/lobehub/lobehub/pull/18664) | 🐛 fix(tools): recover stale scoped tool calls (#18664) | `1dae711792` | `a5352092f` |
| [#19116](https://github.com/lobehub/lobehub/pull/19116) | 🐛 fix(context-engine): diagnose synthetic tool failures with reason and tool (#19116) | `664f8582e6` | `8cfb97223` |
| [#17332](https://github.com/lobehub/lobehub/pull/17332) | 🐛 fix(chat): clear stale local runningOperation so gateway reconnect stops looping 404 (#17332) | `785476a20a` | `df59ada2c` |
| [#17719](https://github.com/lobehub/lobehub/pull/17719) | 🐛 fix: isolate thread conversation cancellation (#17719) | `4174fd5626` | `8768268db` |
| [#17939](https://github.com/lobehub/lobehub/pull/17939) | 🐛 fix(conversation): stop duplicating AskUserQuestion answers in client runtime (#17939) | `7ea48ad9a7` | `88115c975` |
| [#18097](https://github.com/lobehub/lobehub/pull/18097) | 🐛 fix(chat-input): stop deleting unsent composer drafts (#18097) | `c0a4f1bf1c` | `4cda9f263` |
| [#18215](https://github.com/lobehub/lobehub/pull/18215) | 🐛 fix(chat): prevent tool titles from clipping (#18215) | `10f24d7ade` | `4c2474070` |
| [#18365](https://github.com/lobehub/lobehub/pull/18365) | 🐛 fix(model-switch): commit selection before immediate send (#18365) | `dcc1c496bd` | `cfacbc241` |
| [#18993](https://github.com/lobehub/lobehub/pull/18993) | 🐛 fix(chat-input): preserve default action lists (#18993) | `d03b7e3ca7` | `7198f0564` |
| [#16469](https://github.com/lobehub/lobehub/pull/16469) | 🐛 fix(model-runtime): support advanced reasoning parameters for Cerebras and Groq (#16469) | `ba69b32909` | `a9a3bc81a` |
| [#17410](https://github.com/lobehub/lobehub/pull/17410) | 🐛 fix(image): warn and disable generation when selected model is unavailable (#17410) | `826541a3a4` | `bdc6523ab` |
| [#17489](https://github.com/lobehub/lobehub/pull/17489) | 🐛 fix(model-runtime): enable prompt cache keys for Grok (#17489) | `17ba87e438` | `e606a1ba0` |
| [#17629](https://github.com/lobehub/lobehub/pull/17629) | 🐛 fix(model-runtime): sanitize replayed thinking history for anthropic-compatible providers (#17629) | `b36a003ac5` | `9df6b2ced` |
| [#17827](https://github.com/lobehub/lobehub/pull/17827) | ✨ feat(video): add MiniMax-H3 with official v2 API support (#17827) | `fad36790eb` | `f316cd499` |
| [#18225](https://github.com/lobehub/lobehub/pull/18225) | ✨ feat: add Grok 4.6 reasoning effort support (#18225) | `c7f2712ca4` | `208869f4f` |
| [#18290](https://github.com/lobehub/lobehub/pull/18290) | ✨ feat: add Gemini 3.7 Flash descriptions and runtime coverage (#18290) | `5852e0974f` | `e96689f00` |
| [#18560](https://github.com/lobehub/lobehub/pull/18560) | ✨ feat: add DeepSeek V4 Flash Vision Exp description (#18560) | `81cf1fcdb5` | `22953bda6` |
| [#18723](https://github.com/lobehub/lobehub/pull/18723) | ✨ feat: support GLM-5.3-Flash (#18723) | `705772ab88` | `42072471e` |
| [#19004](https://github.com/lobehub/lobehub/pull/19004) | ✨ feat(model-runtime): classify 9 error patterns from 2026-09 triage (#19004) | `8996397b2a` | `53bfc808d` |
| [#19016](https://github.com/lobehub/lobehub/pull/19016) | ✨ feat(model-runtime): support Claude Fable 5.1 tool_choice rules (#19016) | `2399e4afbb` | `a25fc1cec` |
| [#19024](https://github.com/lobehub/lobehub/pull/19024) | 🐛 fix(model-runtime): ask Fable 5.1 to call the tool when tool_choice falls back to auto (#19024) | `f279402dbc` | `d5ad8469d` |
| [#19058](https://github.com/lobehub/lobehub/pull/19058) | ✨ feat: add Gemini 3.8 Flash and fix React artifact preview (#19058) | `20b7c0f6c6` | `fd660d87c` |

本轮为适配二开而追加的修正提交：

| 上游 PR | 提交主题 | 上游提交 | 本仓库提交 |
| --- | --- | --- | --- |
| — | 🐛 fix(file-viewer): 文档条目有后备文件时向预览器传递后备文件 id | — | `ffc89349b` |
| — | 🐛 fix(chat): drop the unsupported modelRedirects argument from the chat-input notice | — | `a17a36083` |
| — | 🐛 fix: 按 fork 的会话模型解析改写 effectiveModel | — | `030624c2d` |
| — | 🐛 fix(context-engine): 合并 #18795 与 #19116 后去重 hasUsableToolContent | — | `e19235c60` |
| — | 🐛 fix(agent-runtime): 压缩后下一步 LLM 回落到 state.messages | — | `628357499` |
| — | 🐛 fix(ai-model): 同步结果按去重后的 models 计数 | — | `d6f657ee2` |
| — | ✅ test(tools): 用缺失 API 的 namespaced 调用覆盖 unknown-namespace 断言 | — | `52f46b0a2` |
| — | 🐛 fix(operation): treat an omitted isNew as not-new when cancelling operations | — | `3f89fd96b` |
| — | 🐛 fix(chat): route the reconnect completion clear to the run's own group bucket | — | `dc0a6ba0a` |
| — | ✨ feat(model-bank): 补齐上游 Ling-3.0-flash 等 7 张模型卡片 (#16469) | — | `bed0a7804` |
| — | ✅ test(chat): 补齐 Gemini 3.7 Flash thinkingLevel3 默认值用例 (#18290) | — | `ae4aa99cf` |

### 已跳过（按决策）

| 上游 PR / 主题 | 原因 |
| --- | --- |
| Projects / Goals / Acceptance 工作流（#17996 #18047 #18574 #18597 #19064 等） | 大功能，新增 schema，且与二开平台助理目录、RBAC 重叠 |
| 异构 CLI Agent（Cursor/CodeBuddy/Qoder/Kimi Code/Pi/TRAE/Grok Build/Factory Droid，#18229 #18775 等） | 桌面端为主，二开已有自己的 Cursor 服务商实现 |
| Elasticsearch 全文搜索（#18807 #18902 #19028） | 新增 schema、Dockerfile 与 compose 改动；二开重写了 search repository |
| 公共 OpenAPI/SDK 扩展、workspace 协作（评论/点赞/成员授权/转移，#18750 #18999 #18536 #18545） | 新增 schema |
| Agent 分享链接与访客对话（#18998） | 新增 schema，绕过二开 RBAC |
| auth 微应用拆分（#18542）、Home 仪表盘重构（#17680 等）、桌面端 OTA/终端/浏览器 | 与二开登录页 / 品牌层冲突或与内网部署无关 |
| ChatGPT 订阅 Codex OAuth（#17527） | 二开自有实现更完整（动态 CLI 版本、目录同步、responsesOnly） |
| Telegram webhook 校验加固（#18930） | 需要把 Chat SDK 固定到 ~4.38（依赖升级），且内网未启用 Telegram 机器人 |
| 移动端消息树迭代遍历（#17457） | 上游次日已回滚（#17493） |
| 音频多模态与成本估算（#17904 #17949） | 触及二开重写的 aiAgent service 与 const 包依赖 |
| 模型+思考强度合并选择器（#18838） | 与二开 `platform.modelLocked` 模型切换器逻辑冲突（22 个冲突文件） |
| 模型过期状态展示（#17748 #17754） | 2026-09-10 复核：二开已自行落地 `resolveStaleModelState`（notEnabled / removed）与选择器提示；只有上游的 redirect 半边未做（二开无模型重定向元数据，a17a36083 已明确不移植） |
| 设置页表头统一（#17667 #17696 #17698） | 100 个冲突文件，纯样式 |
| 实时语音听写（#18132 #18578 #18709） | 依赖 OpenAI realtime STT，内网未接；触及二开定制的 ChatInput |
| AskUserQuestion 补充回答（#18571） | 依赖 heterogeneous-agents Cursor ACP 会话 |
| Ox 跳转说明与模型价格保留（#18727） | 51 个 locale 冲突，二开有自己的服务商设置页 |

### 已跳过（试合并后放弃）

| 上游 PR | 原因 |
| --- | --- |
| #17418 空补全重试与错误分类 | 二开重写了 ServerLLMTransport（无 ServerLLMRetryPolicy）与 Conversation/Error，并删除了 ClientLLMTransport；核心 `runtimeRetry.ts` 已与上游一致。**2026-09-10 随 v1.3.1 补齐剩余前端 hunk**（见下方第二轮） |
| #19083 网络空补全重试 | 依赖 #17418 的 ServerLLMRetryPolicy。**2026-09-10 随 v1.3.1 按二开路径移植**（见下方第二轮） |
| #18965 工具循环上限 | 二开删除了 `callLlmFinalizer.ts`，LLM 收尾在 `apps/server/.../serverCallLlm*`。**2026-09-10 随 v1.3.1 按二开路径移植**（见下方第二轮） |
| #18497 死锁 topic 吞消息 | 二开删除了 `topicStartReservation.ts` 并重写 aiAgent service / conversationLifecycle。**2026-09-10 复核：服务端无 topic 预留锁，问题不可达；客户端草稿恢复半边随 v1.3.1 移植**（见下方第二轮） |
| #18682 网关完成后清侧栏加载态 | 二开未合 #18497，其 `onSessionComplete` 已走 `updateTopicStatus` 路径，问题不存在 |
| #17928 recent 预览批量查询 | 二开的 `recent.ts` 仍是 v2.2.10 基线（无话题预览、无逐话题子查询），问题不存在；`remove-markdown` 已是根依赖（2026-09-10 复核） |
| #18063 受限 API key 可访问 /users/me | 二开没有 API key scope 基础设施，`/users/me` 已仅 requireAuth |
| #18596 模型路由上下文与回退 | 二开重写了 `apps/server/src/modules/ModelRuntime`，且依赖 `packages/business` |
| #17363 仅思考型 Qwen 保护 | 逻辑已在二开；剩余 hunk 是 `*ModelId.ts` 改名，会破坏后续 PR 与二开 |
| #17710 复制 operation id | 二开 MessageModel 的元数据保护会剥离 `metadata.operationId`，客户端执行器也不写入，功能无法生效（评审后撤回） |
| #18390 设置搜索覆盖更多目标 | 二开已删除 `src/features/SettingsSearch`、`Settings/labs` |
| #18712 全局界面字体 | 依赖二开没有的桌面字体 IPC / SettingsSearch，且需新增 `font-list` 依赖 |
| #17058 显示真实上下文大小 | 上游当日已回滚（#17067），v2.2.16 不含该改动 |
| 已在二开中存在（空提交，未合入）：#17323 MCP 环境泄漏、#17717 子代理工具白名单、#17013 移动端输入缩放、#17644 浏览器粘贴图片、#17790 助理步数、#17371 / #17372 会话状态、#16991 GPT 区间定价、#17281 MiniMax detail | 二开此前已独立修复或从未引入该问题 |

### 验证

- 全仓 `tsgo --noEmit` 与本轮触及的测试文件在主检出（非 worktree）跑通；worktree 里的 `node_modules` 软链会把跨包导入解析到主检出，单包测试需在包目录内运行。
- 每个批次由 codex 对照上游原始提交做合并复核，复核发现的问题（FileViewer 后备文件 id、压缩后消息回落、取消操作的 `isNew` 判定、网关重连 groupId、同步计数、缺失模型卡等）已以追加提交修正。
- 线上验证见 CHANGELOG 1.3.0 与 `apps/docs/aihub/README.md` 的发布记录。

## 第二轮：v1.3.0 遗留项收尾（2026-09-10，随 v1.3.1 发布）

不引入新的上游区间，只处理第一轮「试合并后放弃」中需要按二开路径重写的条目。做法：opus 子代理先探索二开对应路径并产出移植映射，再由 grok / opus 在独立工作树按映射重写，codex 只读复核，最后在主检出跑测试与 `tsgo`。

| 上游 PR | 二开落点 | 本仓库提交 |
| --- | --- | --- |
| #19083 网络空补全重试 | 新增 `apps/server/src/modules/AgentRuntime/adapters/serverCallLlmRetryPolicy.ts`（`isRetryableNetworkEmptyCompletion`，额外校验二开特有的 `fileCount === 0`）；`serverCallLlmExecution.ts` 在错误分类与重试预算处覆盖；`serverCallLlmExecutor.ts` 的 `maxAttempts` 取 `max(策略值, 4)` | 见 v1.3.1 |
| #18965 工具循环上限 | `packages/agent-runtime/src/utils/toolCallRepeatGuard.ts` 原样复制并导出，`AgentState.toolCallRepeatGuard` 字段；接入点 `serverCallLlmAttempt.ts`（`salvageAnswerFromThinking` 之后、`publishCallLlmOutput` 之前，用 `isOperationInterrupted` 替代上游的 `finishReason !== 'abort'`），`serverCallLlmPersistence.buildCallLlmResult` 每步把 guard 写回 state；同时跟进上游同日热修 #18989（上限 5→20），终止说明改为中文 | 见 v1.3.1 |
| #18497 死锁 topic 吞消息（客户端半边） | `conversationLifecycle.ts` 新增 `restoreComposerAfterFailedSend`，网关 / 异构 / 客户端模式四处 catch 统一调用；取消不恢复，`inputEditorTempState === null`（用户消息已持久化）不恢复。服务端预留逻辑不移植：二开无 topic 启动锁，`cleanupStaleRunningTopics` 已有 2h 过期 | 见 v1.3.1 |
| #17418 剩余前端 hunk | `getRuntimeErrorMessage` 第 4 参 `fallbackMessage`（i18next `defaultValue`）；`ProviderConfig/Checker.tsx` 传服务端消息作回退；`useBusinessErrorContent(error)` 改收完整错误对象 | 见 v1.3.1 |

复核（本轮 codex 持续「模型容量不足」，改由 opus 子代理复核）发现并已修正：#18497 客户端半边最初在网关路径上、以及运行记录被回收后仍会恢复草稿（重复发送 / 覆盖当前输入），已改为以「用户消息持久化」为界（网关 transport 与客户端模式在持久化后立即清空快照；异构执行失败不恢复；技能准备失败补上恢复）。

复核后判定不修的意见：Checker 在 `modelRuntime` 命名空间尚未加载的瞬间可能以传输异常文本作标题（命名空间加载后即重渲染，且该文本是用户自己的服务商检查结果）。

v1.3.1 发布后 codex 恢复，对发布区间再复核一轮（v1.3.2）。采纳：客户端模式 `internal_ensureTopicDetail` 失败也走失败 + 恢复草稿；输入框已有新内容时不覆盖；工具错误卡标题回退到服务端消息；Dockerfile manifests 阶段补 `apps/server/package.json`。
不采纳：`maxAttempts` 对无重试预算服务商显示 4（与上游一致，仅诊断字段）；`getRuntimeErrorMessage` 仅在有回退文案时才传 `defaultValue`（会让对话错误卡重新显示裸 key，违背上游意图）；e2e 工作区清单入 manifests（纯开发依赖，原 Dockerfile 亦不装）。
