# 钉钉 IM 接入（v1.4.0）

本文说明 AIHub 如何通过钉钉企业内部机器人为员工提供「对话」与「任务提醒推送」，以及管理员的配置步骤。

## 架构

- **管理端 → 通用设置 → IM 连接器**：每种 IM 一张卡片。钉钉卡片保存 Client ID / Client Secret / RobotCode、可选的 AI 卡片模板 ID 与选择卡片模板 ID、能力开关（对话 / 提醒推送）、会话策略（空闲自动新建会话及时长）。凭据以 `KEY_VAULTS_SECRET` 加密写入 `system_bot_providers`（platform = `dingtalk`）。该表同时是「设置 → 聊天平台」可用平台列表的来源。
- **Stream 长连接**：服务进程内的 `dingtalkStreamWorker` 在连接器启用且「对话」开启时维持一条钉钉 Stream 连接（无需公网回调），收到的机器人消息与卡片回调带 HMAC 转发头在进程内交给聊天平台路由。状态每 30 s 写入 Redis `messenger:dingtalk:stream-status`，管理端卡片轮询显示。
- **身份映射**：员工在钉钉的 staffId 与 AIHub 账号邮箱 `<staffId>@dingtalk.jiefakj.com`（Authentik 生成）一一对应，首次发消息即自动绑定，默认路由到默认助理。未登录过 AIHub 的员工会被提示先登录网页端一次。域名可用环境变量 `DINGTALK_IDENTITY_EMAIL_DOMAIN` 覆盖。
- **会话**：单聊按会话保持当前话题；群聊按「群 + 提问人」隔离，机器人只能看到 @ 它的消息及其引用内容。话题在网页端可见。新建话题时标题写成「钉钉・」加首条用户消息（最多 30 字）；首轮助手回复完成后，服务端走与网页相同的 `generateTopicTitle` 摘要，把占位标题换成「钉钉・」加摘要。空闲超过连接器设定时长自动新建会话。
- **网页续聊 mirror**：在 AIHub 网页端继续钉钉单聊产生的话题时，把该轮用户问题与助手回复以一条 Markdown（标题「网页续聊」）发回原钉钉 1:1 会话。仅 1:1，群聊话题跳过；入站钉钉回复不回写。归属按 `topics.id` + `topics.user_id`（任意 workspace，含 `/切换` 到工作区助手后带 `workspace_id` 的话题）；不能镜像他人话题。本部署网页对话走客户端 runtime，由 `messenger.mirrorWebTurn` 在 `completeRun` 触发；网关 / 异构运行时由服务端 `CompletionLifecycle` 触发。
- **指令**：`/助手`（列出并切换）、`/切换 N`、`/新会话`、`/会话`（最近 5 个）、`/继续 N`、`/当前`、`/停止`、`/帮助`；同时接受英文别名 `/agents /use /new /topics /resume /status /stop /help`。
- **回复**：配置了 AI 卡片模板时，先把「正在思考…」写入卡片首帧，流式 `replace` 后 `finalize`（`isFinalize` + 最终正文）覆盖思考文案。无模板或卡片失败时先发一条可撤回的 Markdown「正在思考…」（走机器人 1:1 / 群发接口以拿到 `processQueryKey`，即使会话 webhook 仍有效也不走 webhook，因为 webhook 不返回 `processQueryKey`），答案或错误发出前 `recall` 该占位消息；撤回失败只记日志。模型无正文或只有空白时仍会撤回占位，不补发空白气泡。队列完成回调若找不到本进程的回复 sink（例如部分失败后重试）不再走通用 `createMessage`，避免重复答案。钉钉撤回接口 HTTP 200 且带 `failedResult` 时按失败 `warn` 记 keys，不抛错。超长 Markdown 按段落分片。卡片接口失败自动回退 Markdown。
- **任务提醒**：任务事件（运行完成 / 运行失败 / 等待处理 / 任务完成）写入站内通知并按用户在任务页「提醒设置」中的渠道选择推送到钉钉（ActionCard，含直达链接）。投递结果记录在 `notification_deliveries`（channel = `dingtalk`），含 `sent` / `failed` / `skipped`。推送 `skipped`（例如账号未映射）仍会写一条 `{ status: 'skipped', failed_reason }` 的投递行；仅钉钉、站内关闭时，父通知以 `isArchived=true` 插入，以便 skipped 行有 parent 且不出现在铃铛里。
- **定时任务**：本部署没有 QStash，`taskSchedulingWorker` 每 60 s 在进程内扫描 cron 到期任务、补发心跳、执行看门狗，见 `task-scheduling.md`。
- **客户端绑定状态**：`messenger.availablePlatforms` 每条平台除 `capabilities.push` 外还带 `binding: { linked: boolean; platformUsername?: string | null }`（调用用户）。钉钉的 `linked` 与推送同一套解析（`resolveDingTalkStaffId`）：`findByPlatform('dingtalk', '')` 命中，或邮箱符合 `<staffId>@dingtalk.jiefakj.com` 约定。`platformUsername` 为链接行用户名，缺省时回退 `platformUserId` / 身份邮箱 local-part（staffId），避免已关联却显示空白账号名。客户端可 `import type { MessengerPlatformBinding } from '@lobechat/types'` 或 `@/services/messenger`。

## 钉钉开发者后台配置

1. 钉钉开发者后台 → 应用开发 → 创建「企业内部应用」，名称建议「AIHub」。
2. 「凭证与基础信息」中记录 Client ID（AppKey）与 Client Secret（AppSecret）。
3. 「应用能力」添加「机器人」：填写名称 / 头像 / 简介，消息接收模式选择 **Stream 模式**，记录 RobotCode（通常与 Client ID 相同）。
4. 「权限管理」开通：机器人发送消息（`qyapi_robot_sendmsg`）、机器人消息文件下载；若使用卡片：互动卡片实例写权限、AI 卡片流式更新权限。
5. 「版本管理与发布」发布应用，可见范围至少包含需要使用的员工。
6. （可选）卡片平台 → 新建模板：一个「AI 卡片」模板与一个用于助手 / 会话选择的互动卡片模板，记录模板 ID。

## 管理端配置

1. 管理端 → 通用设置 → IM 连接器 → 钉钉：填入凭据，点击「测试连接」（调用钉钉 accessToken 接口）。
2. 打开「启用」，按需开启「对话」「提醒推送」，设置会话策略，保存。保存动作进入操作日志（`system.im_connector.update`）。
3. 30 s 内 Stream worker 建立连接，卡片状态显示「已连接」；「已绑定员工」与「近 7 日消息 / 推送」随使用增长。

## 通知应用（服务号）

定时提醒（提醒他人 / 整部门）与任务生命周期推送，在配置了「通知应用」后走**双通道**：钉钉**工作通知**（`topapi/message/corpconversation/asyncsend_v2`，`msgtype: oa`）以及服务号机器人的 1:1 消息（`POST /v1.0/robot/oToMessages/batchSend`，`robotCode` = 通知应用 AppKey）。两条通道独立发送、互不影响：工作通知失败不会阻止机器人，反之亦然。聊天机器人（Stream 对话）不受影响。未配置通知应用时，任务推送仍走对话机器人路径。

服务号机器人是**只发不收**：AIHub 不订阅它的 Stream，也不回复发到该机器人的消息。`robotCode` 使用通知应用的 AppKey；新 API 令牌来自 `/v1.0/oauth2/accessToken`（与工作通知用的 oapi `/gettoken` 分开缓存）。每批最多 20 个 `userIds`。Markdown 正文与 OA 一致：`### <应用名> · <种类>` 标题、正文、`HH:mm · 来自 <设置人>`。有深链时用单按钮 `sampleActionCard`（`singleTitle` / `singleURL`）。

通知应用是**另一套企业内部应用**（服务号），与对话机器人分开。管理端钉钉卡片的「通知应用（服务号）」填写该应用的 AppKey / AppSecret / AgentId。保存后可用「测试」：先调 `oapi/gettoken`（工作通知），再调 `/v1.0/oauth2/accessToken`（机器人发送权限所需的新 API 令牌）。不会真实调用 `oToMessages/batchSend`（那会发出一条 1:1 消息）。

### 权限（钉钉开放平台 → 该服务号应用 → 权限管理）

须开通通讯录只读能力（授予在该应用上，而不是对话机器人上）：

- `qyapi_get_department_list` — 部门列表
- `qyapi_get_member` — 成员详情
- `qyapi_get_department_member` — 部门成员

工作通知还需该应用具备「企业工作通知」发送权限，可见范围覆盖要提醒的员工与部门。服务号机器人 1:1 发送还需 `qyapi_robot_sendmsg`（该应用上的机器人能力；消息接收模式无需开 Stream）。

### 通讯录同步

进程内 `dingtalkDirectorySyncWorker` 在启动 60 s 后跑一次，之后每小时走一遍部门树（`topapi/v2/department/listsub` 从部门 `1` 开始，根部门名用 `topapi/v2/department/get`）和部门成员（`topapi/v2/user/list`，cursor 分页，每页 100）。结果写入 `dingtalk_departments` / `dingtalk_directory_users` / `dingtalk_user_departments`（拼音列用 `pinyinFull` / `pinyinInitials`）。未配置通知应用时跳过。管理端「立即同步」走同一套逻辑（Redis 锁 `messenger:dingtalk:directory-sync-lock`）。状态在 Redis `messenger:dingtalk:directory-status`（无 TTL）：`idle` / `running` / `ok` / `error`，含部门数、人员数、上次同步时间。

### 定时提醒数据模型（提醒即任务）

新的定时提醒是一条 `automationMode='schedule'` 的任务，而不是独立调度对象：

| 表 | 角色 |
| --- | --- |
| `tasks` | 提醒任务。`config.reminder.kind='reminder'`，`schedule_timezone='Asia/Shanghai'`，`status='scheduled'`，`assignee_agent_id` 为空。`instruction` 第一行是 `@姓名·部门` mention，空行后是正文。`name` 为正文前 40 字。 |
| `reminders` | 提醒档案：正文（不含 mention 行）、`repeat_rule`、下次 `fire_at`、投递计数。新行 `source='task'` 且 `task_id` 指向任务（`ON DELETE CASCADE`，`task_id` 非空唯一）。`status` 与任务对齐：`scheduled` / `sent`（任务 completed）/ `canceled`。 |
| `reminder_recipients` / `reminder_deliveries` | 不变，仍按 `reminder_id`。`listReceived`（我收到的）继续读投递行。 |

Tick 到期时 `runScheduleTick` 识别 `config.reminder` 后调用 `ReminderTaskService.fireForTick`：走与原先相同的工作通知 + 服务号机器人 + 站内 `reminder.received`，**不** `execAgent`。遗留 `task_id IS NULL` 行仍由 `reminderWorker` 每 60s 扫描 `fire_at <= now`。

一次提醒的 cron 是 `mm HH D M *`（当天当时分）。任务扫描间隔 60s、`isExecutionTime` 容差 5 分钟；发出后写 `tasks.last_heartbeat_at` 以免同一窗口连发。重复提醒的 `until`（YYYY-MM-DD，Asia/Shanghai，含当日）在 tick 时判断，过期则完成任务且不投递。

### 工作通知格式（OA）

钉钉对同一用户、同一自然日的**相同工作通知正文**会去重。AIHub 发出的工作通知一律用 `msgtype: oa`。`head.bgcolor` 固定 `FF2E7CF6`（色带标识应用）；`head.text` 仍发送管理端通用设置的站点标题（未设置时为「AI 助手」），但钉钉工作通知会把 `oa.head.text` **改写成服务号在开放平台登记的应用名**，因此调用方身份写在 `body.title`：`<站点标题或「AI 助手」> · <通知种类>`。载荷形如 `{"msgtype":"oa","oa":{"message_url":"<仅任务推送的绝对深链>","head":{"bgcolor":"FF2E7CF6","text":"<站点标题>"},"body":{"title":"<站点标题> · <定时提醒 | 运行完成 | 运行失败 | 等待处理 | 任务完成>","form":[{"key":"时间","value":"HH:mm"},{"key":"来自","value":"<设置人>"}],"content":"<正文>","author":"<设置人>"}}}`。定时提醒无 `message_url`，`body.title` 为 `<站点标题> · 定时提醒`，form 为「时间」（周期提醒写成 `09:00 · 每周三`）与「来自」。任务生命周期推送的 `body.title` 为 `<站点标题> ·` 加短事件名（运行完成 / 运行失败 / 等待处理 / 任务完成，各不超过 12 字；原先较长的推送标题与说明放在 `content`，任务名在 form「任务」），form 为「任务」与「时间」，`message_url` 为任务深链。`reminder_deliveries.provider_task_id` 与 `notification_deliveries.provider_message_id` 记录工作通知的 `task_id`。`reminder_deliveries` 另有 `robot_message_id` / `robot_status` / `robot_failed_reason` 记录服务号机器人投递；任务推送的机器人结果只记日志，不改 `notification_deliveries`。markdown / `action_card` 仍可走 `sendWorkNotice` 兼容路径。未配置通知应用时，任务推送回退到对话机器人 `oToMessages/batchSend`。

## 手工绑定

任务提醒按 **任务所有者** 的 AIHub 账号解析钉钉 staffId。绑定来源有三种，推送解析顺序相同：

1. `messenger_account_links` 行（`(userId, dingtalk)`），不论 `source` 是 `auto` 还是 `manual`
2. 否则邮箱符合 `<staffId>@dingtalk.jiefakj.com` 约定
3. 都没有则投递 `skipped`（`failed_reason=user_not_mapped`）

本地账号（例如破窗管理员 `admin@jiefakj.com`）没有钉钉身份邮箱，也不会在机器人会话里自动建链。管理员可在 **管理端 → 通用设置 → IM 连接器 → 钉钉 → 已绑定员工** 为任意 AIHub 账号手工绑定（或解绑）钉钉企业用户。

若该钉钉用户已经映射到另一个 AIHub 账号 —— 无论是 `messenger_account_links` 行（`boundVia: 'link'`）还是身份邮箱 local-part 等于该 staffId（`boundVia: 'identity_email'`）—— 默认拒绝并返回 `PLATFORM_USER_ALREADY_BOUND`（详情含对方 `boundUserId` / Email / Name / `boundVia`）。`force: true` 在同一事务里删掉对方的链接行（若有）并写入当前绑定，避免「先解绑再绑定」半提交。身份邮箱冲突没有链接行可删；`force: true` 仍允许写入手工行（运维可能故意把某钉钉用户指到本地管理员）。

手工行一旦存在，**入站对话**按 `findByPlatformUser` 命中该行，因此该 staffId 的机器人消息会到达手工绑定的账号（链接行优先于身份邮箱）。**推送**仍按账号各自解析：手工绑定账号走链接行，身份邮箱账号走邮箱 local-part，两边都会推到同一个钉钉用户。

连接器已配置凭据时，保存会尝试调用钉钉 `topapi/v2/user/get` 补全显示名；查找失败不阻断写入。手工绑定与自动绑定一样会被 `resolveDingTalkStaffId` / `messenger.availablePlatforms.binding` 读到。列表最多返回 200 行，并带 `hasMore` / `total`（`total` 不受 200 上限截断）。

## 员工侧

- 设置 → 聊天平台 → 钉钉：查看绑定状态、选择默认助手、查看指令用法。
- 任务页右上「提醒设置」：选择渠道（站内 / 钉钉）与事件类型。钉钉渠道按 `messenger.availablePlatforms` 呈现三种状态（`unavailable` 优先于 `unlinked`；旧服务端不下发 `binding` 时保持可用，避免全员被挡）：
  - **unavailable**：管理员未启用钉钉推送（`capabilities.push` 不为 true）时该渠道灰显，提示「管理员未启用钉钉推送。」
  - **unlinked**：连接器已开推送，但当前账号 `binding.linked === false`（无 `messenger_account_links` 且邮箱不符合身份约定）时同样灰显，提示未关联钉钉。本地账号需改用钉钉身份邮箱登录，或由管理员在「手工绑定」中补链。
  - **linked-as**：已关联时渠道可用；`binding.platformUsername` 有值则显示「推送至钉钉账号 {{name}}」。身份邮箱用户的用户名为 staffId，因此不会出现空白账号名。

## 运维要点

- 容器出网经 `HTTP(S)_PROXY`，`NODE_USE_ENV_PROXY=1` 使 Node 的 fetch 与 WebSocket 均经代理；`NO_PROXY` 需包含 `localhost,127.0.0.1`。
- 单实例部署：Stream 连接与调度 worker 都在服务进程内，多副本时分别依赖钉钉的多连接分发与 Redis 锁。
- 排查：`DEBUG=lobe-server:messenger:*,lobe-server:task-scheduling` 查看连接 / 转发 / 调度日志；Redis 键 `messenger:dingtalk:*`；`notification_deliveries` 表的 `failed_reason`。
- reminder never reaches DingTalk → check `notification_deliveries` for `status=skipped`/`failed_reason=user_not_mapped`; the task owner must be a DingTalk-linked account.
- 提醒未到达钉钉 → 查 `notification_deliveries` 的 `status=skipped` / `failed_reason=user_not_mapped`；任务所有者必须是已关联钉钉的账号。

## 免登页 JSAPI

`/dingtalk/sso` 页面加载的钉钉 JSAPI 为仓库自带副本 `public/vendor/dingtalk/dingtalk.open.js`（来源 `https://g.alicdn.com/dingding/dingtalk-jsapi/3.0.31/dingtalk.open.js`，2026-09-15 取得）。此前引用的 CDN 版本 3.0.34 不存在（404），导致手机端免登页在 `script_load_failed` 阶段回退到登录页；诊断上报见 `POST /api/auth/dingtalk/sso/diag`（容器日志 `[dingtalk-sso-diag]`）。升级 JSAPI 时替换该文件即可。
