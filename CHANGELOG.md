<a name="readme-top"></a>

# Changelog

All notable changes to **LobeHub Enhanced** are documented here.
Upstream LobeHub release notes live in the [lobehub/lobehub](https://github.com/lobehub/lobehub) repository.

## 1.6.1 (2026-09-16)

1.6.0 上线后的跟进。

#### 🐛 Fixes

- 定时提醒推送标题改为「<站点标题> · <发起人>提醒你：<摘要>」（工具调用带 ≤12 字的 `title`，缺省截取正文），不再是无信息量的「定时提醒」。
- 提醒任务不再在到点之前的 cron 容差窗内提前触发（19:28 的提醒曾在 19:25 的扫描就发出）。
- `createReminder` 的 schedule 入参容忍空字符串/空数组并归一 `H:mm`/`HH:mm:ss`，缺 `time` 时返回明确的字段提示，减少一轮模型重试。
- 任务助手自动开通时 `DEFAULT_LANG` 为空默认中文名「任务助手」。

## 1.6.0 (2026-09-16)

定时提醒改为「提醒即任务」，任务助手纳入平台助理管理，提醒工具常驻并改为单次调用。

#### ✨ Features

- 提醒即任务：自然语言设置的提醒现在创建为一条任务（`config.reminder`，`automation_mode='schedule'`，cron 按 Asia/Shanghai；一次性提醒到点后完成），正文首行以 `@姓名·部门` / `@部门名` 写收件人，其后为提醒内容。调度 tick 与「运行」对提醒任务不再启动 Agent，而是直接投递（服务号工作通知 + 服务号机器人 + 站内铃铛），并在投递前原子认领触发槽（并发 tick / 重复投递 / 到点前一分钟的「立即发送」只发一次）。`reminders` 表成为任务的档案（`task_id`，迁移 0034），遗留行仍由旧扫描触发。
- 任务详情：提醒任务正文改为显式「保存」（不再每次输入触发），保存后服务端按 `@提及` 确定性解析收件人、用 LLM 重新理解正文里的时间表达并重排 cron（歧义时返回候选「姓名 · 部门」）；`@` 提及选择器接钉钉通讯录；新增收件人/周期/下次发送/上次发送与投递计数面板，可「立即发送」或「取消提醒」；任务列表带 ⏰ 提醒标签。
- 定时提醒页签改为两张表格：「我发起的」（内容、收件人、周期、下次/上次发送与计数、状态、操作）与「我收到的」（时间、内容、来自、工作通知/机器人渠道状态）。
- `lobe-reminder` 工具常驻（agent 模式无需 activator 激活回合），`createReminder` 一次调用接受姓名/「姓名·部门」/部门名并在服务端解析，歧义与大受众在同一次调用返回；工具输出时间一律 Asia/Shanghai。
- 任务助手（内置 `task-agent`）成为平台系统助理 `task-manager`：管理端「助理管理」新增任务助手卡片，管理员发布的名称/头像/提示词/默认模型与思考强度覆盖到每位成员的任务页助手（轻量托管：成员仍可换模型与助理），启动/列表时自动开通，发布换模型时重置成员行；系统助理行不可归档/删除/设为默认。

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

- #17748 / #17754 (stale model state in the selector) were found already implemented in the fork; only the model-redirect half is missing and is intentionally not ported. #17928 (recent-topic preview batching) does not apply: the fork's `recent.ts` has no topic preview and no per-topic subquery.

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
