<a name="readme-top"></a>

# Changelog

All notable changes to **LobeHub Enhanced** are documented here.
Upstream LobeHub release notes live in the [lobehub/lobehub](https://github.com/lobehub/lobehub) repository.

## 1.8.3 (2026-09-21)

钉钉审批、待办、日程对接真实接口后的修正。

#### 🐛 Fixes

- 钉钉带分页参数的请求(可见审批模板、日程与会议室分页等)不再被出站安全策略误拦;请求固定为钉钉官方域名并禁止重定向。
- 「检查权限」逐个权限点检测(含写权限),并显示钉钉返回的缺失权限点;此前缺少日程写入、忙闲读取权限时仍显示正常。
- 审批表单的下拉选项显示为可读文本。
- 未购买 OA 审批高级版时,「待我处理」「我发起的」不再因钉钉限流而误报为空:按接口限速扫描,结果不完整时明确提示。
- 待办列表首页查询不再触发钉钉接口错误。

## 1.8.2 (2026-09-21)

企业查询凭证与编辑弹窗修正,镜像构建提速。

#### 🐛 Fixes

- 企业查询凭证连同「Bearer 」前缀一起粘贴时,「测试连接」与查询不再失败:保存、测试和请求时统一去除前缀、引号与首尾空白。
- 企业查询编辑弹窗移除额度说明文字;修复弹窗底部输入框下边缘与焦点环被裁切的问题。

#### ⚡ Build

- Docker 构建复用 Next 编译缓存与 pnpm store(BuildKit 缓存挂载),三个 SPA 包支持并行构建。

## 1.8.1 (2026-09-21)

企业查询「测试连接」修正。

#### 🐛 Fixes

- 天眼查凭证填写错误时,「测试连接」不再误报正常:天眼查的 MCP 服务在列出工具时不校验凭证,现追加一次不计费的鉴权调用,凭证无效时提示「凭证无效」。企查查不受影响。

## 1.8.0 (2026-09-21)

助理可以用成员本人的钉钉身份处理审批、待办与日程，并可查询企查查 / 天眼查企业信息。

#### ✨ Features

- **钉钉审批**：在对话中发起、查询、同意、拒绝、转交、评论、撤销审批，管理审批模板（须具备钉钉 OA 审批管理权限）；退回与加签需钉钉 OA 审批高级版。操作人由服务端按钉钉验证过的身份注入，管理员手动绑定的账号不可用于此类操作；服务端在每次写入前重新校验本人是否为当前处理人 / 发起人。
- **写操作二次确认**：钉钉审批、待办、日程的所有写操作在对话中弹出确认卡片，展示服务端解析后的完整摘要，不受「自动批准工具」设置影响；信息不明确时助理先追问。
- **自动审批规则**：成员用自然语言创建规则，助理编译为结构化条件（模板 + 发起人 / 部门 + 表单字段比较），后台每 2 分钟按规则自动同意 / 拒绝 / 转交 / 评论，不调用模型；每次执行写入审计并通过钉钉工作通知告知本人。成员在「设置 → 自动审批规则」查看、停用、删除规则及执行记录，管理员可查看全员规则并强制停用。
- **自动审批档位**：钉钉连接器卡片新增「工作台能力」，可分别开启审批 / 待办 / 日程、切换自动审批档位（关闭 / 严格 / 适中 / 宽松，默认适中）并检查应用权限。
- **钉钉待办与日程**：增删改查本人待办与日程，指派他人、邀请参会人需确认；查询同事忙闲只返回忙 / 闲时段；可预订会议室。
- **企业查询**：通用设置 → 基础设施新增「企业查询」卡片，统一配置企查查与天眼查凭证、默认供应商、失败自动切换、查询类目与每人每日上限；助理通过自然语言查询企业信息，企业名称有多个匹配时请成员确认，每次查询写入审计。

#### 📝 Docs

- 新增 `docs/enterprise/dingtalk-workspace.md`（权限模型、配置步骤、钉钉 App 操作支持对照、后续可接入能力清单）与 `docs/enterprise/enterprise-lookup.md`。

#### 🗃 Migration

- `0036`：`platform_infra_settings` 允许 `enterprise_lookup`；新增 `enterprise_lookup_daily_usage`、`dingtalk_approval_rules`、`dingtalk_approval_rule_runs`。

## 1.7.2 (2026-09-18)

提醒收件人纠错：模型把生僻字姓名写错时，结合上下文直接找回正确的人。

#### ✨ Improvements

- 收件人姓名未找到且有多个近似候选时，若恰好一个候选在用户最近一条消息原文中独立出现（排除错字本身、更长姓名的一部分以及引用的消息内容），或恰好一个与其他已解析收件人同部门，则只返回该候选并注明原因，模型直接用 `staff:` token 重试，无需再问用户。其余情况仍列出候选请用户选择。

## 1.7.1 (2026-09-18)

定时提醒创建链路整改（同部门多人收件、并发编号、模型纠错）与审计会话历史滚动加载。

#### 🐛 Fixes

- 提醒同一部门的多名同事时，收件人写入不再因部门唯一索引冲突而失败（迁移 `0035` 将唯一索引按收件人类型收窄）。
- 并发创建提醒任务时，任务编号冲突的重试改在 SAVEPOINT 内进行，不再中止外层事务。
- 周期提醒若创建时间晚于当天的触发时刻，不再被补发，从下一个实际时刻开始提醒。
- 提醒工具不再把数据库错误原文（SQL）回传给模型；可重试的冲突提示模型原参数重试一次。

#### ✨ Improvements

- 收件人姓名未找到时返回近似候选（同长度、编辑距离 ≤1 或同拼音）：唯一候选让模型直接用 `staff:` token 重试，多个候选则请用户选择。
- 收件人支持「我 / 自己」，解析为当前用户。
- 提醒工具说明要求一次调用携带全部收件人、不并行创建、搜索后原样使用 token，避免手抄生僻字出错。
- 审计・会话历史：消息区改为固定高度盒内滚动，最新消息在底部，滚到顶部自动加载更早消息，与实时查看一致；切换会话时自动关闭「加载正文」。

## 1.7.0 (2026-09-18)

审计界面整理：操作日志显示目标名称，实时查看与会话历史改用只读聊天视图。

#### ✨ Features

- 实时查看、会话历史的消息区改为与用户聊天界面一致的只读视图：头像 + 气泡、Markdown 渲染（代码块 / 表格 / 列表），原始 HTML 一律按文本显示；脱敏标记渲染为不可伪造、不会被链接包裹的 chip。
- 操作日志「目标」列显示目标名称（会话标题 / 用户名 / 助理名等，`global` 显示为「全局」），单行截断，悬停显示全名与原始 ID。会话标题与文件名仅在审计策略未禁用会话访问且查看者具备会话查看权限时返回，并按会话脱敏规则处理。
- 会话历史：模型行与更新时间合并为一行并显示助理名称（默认助理显示本地化名称），「加载正文」开关移到「实时查看」按钮左侧，邮箱单行截断 + tooltip，无标题会话显示「未命名」。

#### 🐛 Fixes

- 操作日志事件详情抽屉的右侧滑入 / 滑出动画。
- 实时查看：去掉重复的正文提示横幅，说明改为警告色；左右两栏固定高度、各自滚动；「新消息」跳转按钮始终浮在可视区。
- 会话历史在策略切为仅元数据后不再显示已缓存的消息正文。

## 1.6.1 (2026-09-16)

1.6.0 上线后的跟进。

#### 🐛 Fixes

- 定时提醒推送标题改为「<站点标题>・< 发起人 > 提醒你：< 摘要 >」（工具调用带 ≤12 字的 `title`，缺省截取正文），不再是无信息量的「定时提醒」。
- 提醒任务不再在到点之前的 cron 容差窗内提前触发（19:28 的提醒曾在 19:25 的扫描就发出）。
- `createReminder` 的 schedule 入参容忍空字符串 / 空数组并归一 `H:mm`/`HH:mm:ss`，缺 `time` 时返回明确的字段提示，减少一轮模型重试。
- 任务助手自动开通时 `DEFAULT_LANG` 为空默认中文名「任务助手」。

## 1.6.0 (2026-09-16)

定时提醒改为「提醒即任务」，任务助手纳入平台助理管理，提醒工具常驻并改为单次调用。

#### ✨ Features

- 提醒即任务：自然语言设置的提醒现在创建为一条任务（`config.reminder`，`automation_mode='schedule'`，cron 按 Asia/Shanghai；一次性提醒到点后完成），正文首行以 `@姓名·部门` / `@部门名` 写收件人，其后为提醒内容。调度 tick 与「运行」对提醒任务不再启动 Agent，而是直接投递（服务号工作通知 + 服务号机器人 + 站内铃铛），并在投递前原子认领触发槽（并发 tick / 重复投递 / 到点前一分钟的「立即发送」只发一次）。`reminders` 表成为任务的档案（`task_id`，迁移 0034），遗留行仍由旧扫描触发。
- 任务详情：提醒任务正文改为显式「保存」（不再每次输入触发），保存后服务端按 `@提及` 确定性解析收件人、用 LLM 重新理解正文里的时间表达并重排 cron（歧义时返回候选「姓名・部门」）；`@` 提及选择器接钉钉通讯录；新增收件人 / 周期 / 下次发送 / 上次发送与投递计数面板，可「立即发送」或「取消提醒」；任务列表带 ⏰ 提醒标签。
- 定时提醒页签改为两张表格：「我发起的」（内容、收件人、周期、下次 / 上次发送与计数、状态、操作）与「我收到的」（时间、内容、来自、工作通知 / 机器人渠道状态）。
- `lobe-reminder` 工具常驻（agent 模式无需 activator 激活回合），`createReminder` 一次调用接受姓名 /「姓名・部门」/ 部门名并在服务端解析，歧义与大受众在同一次调用返回；工具输出时间一律 Asia/Shanghai。
- 任务助手（内置 `task-agent`）成为平台系统助理 `task-manager`：管理端「助理管理」新增任务助手卡片，管理员发布的名称 / 头像 / 提示词 / 默认模型与思考强度覆盖到每位成员的任务页助手（轻量托管：成员仍可换模型与助理），启动 / 列表时自动开通，发布换模型时重置成员行；系统助理行不可归档 / 删除 / 设为默认。

#### 🐛 Fixes

- 「Agent 反应偏慢」根因：提醒工具之前只在候选池、不在常驻列表，每次都多一轮激活；加上搜索→创建→回复共 4 轮模型调用。现在为 2 轮。

## 1.3.2 (2026-09-10)

Review follow-up to 1.3.1 (codex review of the released range).

#### 🐛 Reliability

- Chat client: a failed topic-detail fetch before the user message is persisted now fails the operation and restores the draft, like the other pre-persist failures; a restore never overwrites text the user already typed while the send was in flight (the send error is still surfaced); the tool error card falls back to the server message when the error code has no localized copy.

#### 🏗️ Build

- Dockerfile: the `manifests` stage also carries `apps/server/package.json`, so the dependency layer's cache key covers every production workspace package.

## 1.3.1 (2026-09-10)

Follow-up to the first upstream sync: the four "needs real work" items left in the ledger were ported onto the fork's own code paths, two others were re-checked and closed as not applicable, and the Docker build no longer reinstalls dependencies on every release. Ledger: [docs/enterprise/upstream-sync.md](./docs/enterprise/upstream-sync.md).

#### 🐛 Reliability

- Agent runtime: an empty completion whose `finishReason` is `network_error` and that produced nothing billable is retried up to three times (four attempts in total) even on providers that otherwise never retry; any other empty completion still stops immediately (#19083).
- Agent runtime: the same tool call (name + canonicalised arguments) requested five times in a row ends the turn with `finishReason: tool_call_repeat_limit` and a short stop notice instead of looping; the guard is tracked per operation in agent state and resets whenever a step produces a different call or no call (#18965).
- Chat client: when a send fails before the run starts (gateway 5xx, network error, heterogeneous agent start failure), the typed text and attachments are restored into the composer for every runtime branch; previously only the client-mode branch restored, and only for tRPC client errors. Cancelled sends and sends whose user message was already persisted are left alone. The upstream server-side topic reservation half does not apply to the fork (#18497, client half).
- Errors: `getRuntimeErrorMessage` accepts a fallback message, so a runtime error code without localized copy shows the server's message instead of the raw key; the provider connectivity check uses it; `useBusinessErrorContent` receives the whole error object (#17418, remaining frontend hunks).

#### 🏗️ Build

- Dockerfile: a `manifests` stage feeds `pnpm install` only the workspace `package.json` files (root version zeroed), patches and the desktop manifest, so package source edits and release version bumps no longer invalidate the dependency layer.

#### 📝 Ledger

- \#17748 / #17754 (stale model state in the selector) were found already implemented in the fork; only the model-redirect half is missing and is intentionally not ported. #17928 (recent-topic preview batching) does not apply: the fork's `recent.ts` has no topic preview and no per-topic subquery.

## 1.3.0 (2026-09-10)

First explicit upstream sync: 59 upstream pull requests from lobehub/lobehub v2.2.11–v2.2.16 cherry-picked onto the v2.2.10 base, plus 11 follow-up fixes found in review. Scope was limited to security, reliability, model runtime / model cards and small UX changes; no dependency bumps, no database schema changes, no upstream feature that overlaps the enterprise admin console. The full per-PR ledger (applied, skipped and why) lives in [docs/enterprise/upstream-sync.md](./docs/enterprise/upstream-sync.md).

#### 🔒 Security

- OpenAPI auth errors return 401 instead of 500 and API keys are masked with their real prefix (#17143).

#### 🐛 Reliability

- Agent runtime: reuse assistant messages on step retry, drop duplicate continuations, preserve grouped sub-agent final answers, recover stale scoped tool calls, diagnose synthetic tool failures with reason and tool, keep image tool results from being reported as failures, account container message tokens in the context budget, fall back to state messages after context compression, bound repeated compression, slim compression payloads, retry preflighted OpenAI context-limit errors, run blocking XREAD on a dedicated Redis connection, fix `sanitizeNullBytes` escape corruption (#17044 #17703 #17726 #17725 #18664 #19116 #18795 #17839 #18587 #18626 #16896 #17876 #18507).
- Chat client: stop gateway reconnect loops on stale running operations, isolate thread cancellation, stop duplicating AskUserQuestion answers, keep unsent composer drafts, commit model switch before immediate send, preserve default action lists, hide empty reasoning cards, fix layout jitter on tool-call completion, anchor tool timers to the result message, `Enter`/`Esc` hotkeys on approval cards (#17332 #17719 #17939 #18097 #18365 #18993 #17935 #17968 #17930 #18182 #18413 #17733).
- Server: gateway sync peak avoidance, hung device handshake timeout, serialized file-parse cache writes, agent-document edits can no longer clear content, parsed-file source metadata preserved (with the fork's Office preview now receiving the backing file id), error-status mapping aligned with the spec table, numeric chat errors mapped to tRPC status, deduplicated AI model batch updates (#17305 #19021 #17919 #18643 #17458 #18688 #17221 #17465).

#### 🤖 Models and runtime

- New model cards: Gemini 3.8 Flash, GLM-5.3 / GLM-5.3-Flash with always-on thinking, MiniMax-H3 (video v2 API), Kimi K3 descriptions, DeepSeek V4 Flash Vision description, Cerebras / Groq reasoning parameters and seven long-tail cards (#19058 #18290 #18723 #17827 #18560 #16469).
- Claude Fable 5.1 `tool_choice` rules and the auto fallback prompt; Grok 4.6 reasoning-effort control and prompt-cache keys; Claude replayed-thinking sanitisation for Anthropic-compatible providers; failed assistant placeholders filtered and the Claude prefill guard hardened; nine new error patterns and `SubscriptionPlanLimit` classified; chat output cost ratio aligned; unavailable image models disabled with a notice (#19016 #19024 #18225 #17489 #17629 #17737 #19004 #19006 #18748 #17410).

#### ✨ UX

- Disabled models can be re-enabled from the chat input; the todo tray scrolls; large PDFs are readable; `.v` / `.sv` attachments are recognised; `message.getMessages` is split out of the initial-load batch (#18730 #18858 #19073 #19118 #18462).

## 1.0.0 (2026-08-16)

First public release of LobeHub Enhanced — an enterprise-enhanced fork of LobeHub.
Based on upstream lobehub/lobehub v2.2.10.

#### ✨ Features

- **Admin console** — a dedicated `/admin` application (37 routes) driven by a single navigation manifest: overview, statistics, users, AI, skills, connectors, assistants, security & authentication, branding, audit and system status.
- **Platform RBAC** — 66 platform permissions and 6 system roles (`super_admin`, `user_admin`, `ai_admin`, `identity_admin`, `auditor`, `platform_user`); every admin API passes a single server-side permission gate backed by an asserted procedure registry.
- **Managed resources & settings policy** — the platform can take over AI, skills, connectors and assistants; user settings resolve `builtin default → platform default → user override → platform lock`, with independent visibility control.
- **AI provider & model catalog** — platform-owned providers and models with immutable revisions, instant apply, rollback, connection tests and `keep | replace | clear` secret handling, behind an explicit platform-AI takeover gate.
- **Skills & connectors governance** — platform catalogs with the same revision lifecycle, a builtin-tool permission matrix, and platform-hosted **shared OAuth accounts** with per-user bindings and bulk revocation.
- **Platform assistants** — global assistants with versions, assignments, staged rollouts (start / retry / rollback / cancel), non-hideable assistants and a configurable default inbox.
- **Audit subsystem** — append-only audit logs with an operation log UI, live view, conversation evidence search, exports, legal holds and retention runs; holds block retention deletion.
- **Database-driven identity providers** — OIDC/Authentik configuration stored in the database with live discovery, SSRF-checked network validation, publish / rollback / disable, controlled restart activation and a last-known-good snapshot on disk. Break-glass local admin retained.
- **Login methods & open registration** — toggle open registration behind an email-domain allowlist, enforced in the sign-up path.
- **Runtime branding** — name, logos, favicon, OG image, legal name, email sender, page-title template and primary colour applied site-wide the moment they are saved, with no first-paint flash.
- **ChatGPT Web provider (`chatgptweb`)** — the ChatGPT web session as a first-class provider: browser-fingerprinted transport, paste-a-web-session connection, session auto-renewal, chat / search / attachments / reasoning / images and resumable streaming.
- **Platform secret encryption** — AES-256-GCM envelope encryption for every stored platform secret behind a pluggable key provider (`env` or HashiCorp Vault AppRole), plus an asynchronous rewrap job for key rotation.
- **Platform jobs, instances & system page** — a lease-based job queue that survives across HTTP workers, live service instance tracking with a reaper, restart request/prepare flow and job cancel/retry.
- **Sidebar layout management** — platform-controlled sidebar ordering and visibility.
- **Admin analytics** — server-side totals, per-user usage, agent/model/topic rankings, 52-week activity calendars, hourly strips and token/cost heatmaps with time-range and user filters.
- **In-image super admin bootstrap** — `BOOTSTRAP_SUPER_ADMIN_*` provisions the first super admin at server startup, so a Docker-only deployment never needs a repository checkout.

#### 🔧 Deployment

- Multi-arch (`linux/amd64`, `linux/arm64`) images published to `ghcr.io/12dora/lobehub-enhanced` on every `v*.*.*` tag.
- Reference stack in `docker-compose/enhanced/` — ParadeDB (Postgres + pgvector + BM25), Redis and an S3-compatible object store.
- Enterprise configuration documented in `.env.example` and `docs/enterprise/`.

#### ♻️ Changes from upstream

- The upstream automatic sync workflow is removed; upstream updates are reviewed and applied explicitly.
- The upstream migration chain is squashed to a single baseline plus deltas.
- The provider draft/publish flow is replaced by direct instant-apply semantics.
- Telemetry and analytics are disabled by default; the npm version check is off because this fork's version line is independent of upstream.
