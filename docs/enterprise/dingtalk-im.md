# 钉钉 IM 接入（v1.4.0）

本文说明 AIHub 如何通过钉钉企业内部机器人为员工提供「对话」与「任务提醒推送」，以及管理员的配置步骤。

## 架构

- **管理端 → 通用设置 → IM 连接器**：每种 IM 一张卡片。钉钉卡片保存 Client ID / Client Secret / RobotCode、可选的 AI 卡片模板 ID 与选择卡片模板 ID、能力开关（对话 / 提醒推送）、会话策略（空闲自动新建会话及时长）。凭据以 `KEY_VAULTS_SECRET` 加密写入 `system_bot_providers`（platform = `dingtalk`）。该表同时是「设置 → 聊天平台」可用平台列表的来源。
- **Stream 长连接**：服务进程内的 `dingtalkStreamWorker` 在连接器启用且「对话」开启时维持一条钉钉 Stream 连接（无需公网回调），收到的机器人消息与卡片回调带 HMAC 转发头在进程内交给聊天平台路由。状态每 30 s 写入 Redis `messenger:dingtalk:stream-status`，管理端卡片轮询显示。
- **身份映射**：员工在钉钉的 staffId 与 AIHub 账号邮箱 `<staffId>@dingtalk.jiefakj.com`（Authentik 生成）一一对应，首次发消息即自动绑定，默认路由到默认助理。未登录过 AIHub 的员工会被提示先登录网页端一次。域名可用环境变量 `DINGTALK_IDENTITY_EMAIL_DOMAIN` 覆盖。
- **会话**：单聊按会话保持当前话题；群聊按「群 + 提问人」隔离，机器人只能看到 @ 它的消息及其引用内容。话题在网页端可见，标题前缀「钉钉 ·」。空闲超过连接器设定时长自动新建会话。
- **指令**：`/助手`（列出并切换）、`/切换 N`、`/新会话`、`/会话`（最近 5 个）、`/继续 N`、`/当前`、`/停止`、`/帮助`；同时接受英文别名 `/agents /use /new /topics /resume /status /stop /help`。
- **回复**：配置了 AI 卡片模板时流式更新卡片；否则先回复「正在思考…」再发送完整 Markdown（超长按段落分片）。卡片接口失败自动回退 Markdown。
- **任务提醒**：任务事件（运行完成 / 运行失败 / 等待处理 / 任务完成）写入站内通知并按用户在任务页「提醒设置」中的渠道选择推送到钉钉（ActionCard，含直达链接）。投递结果记录在 `notification_deliveries`（channel = `dingtalk`）。
- **定时任务**：本部署没有 QStash，`taskSchedulingWorker` 每 60 s 在进程内扫描 cron 到期任务、补发心跳、执行看门狗，见 `task-scheduling.md`。

## 钉钉开发者后台配置

1. 钉钉开发者后台 → 应用开发 → 创建「企业内部应用」，名称建议「AIHub」。
2. 「凭证与基础信息」中记录 Client ID（AppKey）与 Client Secret（AppSecret）。
3. 「应用能力」添加「机器人」：填写名称/头像/简介，消息接收模式选择 **Stream 模式**，记录 RobotCode（通常与 Client ID 相同）。
4. 「权限管理」开通：机器人发送消息（`qyapi_robot_sendmsg`）、机器人消息文件下载；若使用卡片：互动卡片实例写权限、AI 卡片流式更新权限。
5. 「版本管理与发布」发布应用，可见范围至少包含需要使用的员工。
6. （可选）卡片平台 → 新建模板：一个「AI 卡片」模板与一个用于助手/会话选择的互动卡片模板，记录模板 ID。

## 管理端配置

1. 管理端 → 通用设置 → IM 连接器 → 钉钉：填入凭据，点击「测试连接」（调用钉钉 accessToken 接口）。
2. 打开「启用」，按需开启「对话」「提醒推送」，设置会话策略，保存。保存动作进入操作日志（`system.im_connector.update`）。
3. 30 s 内 Stream worker 建立连接，卡片状态显示「已连接」；「已绑定员工」与「近 7 日消息 / 推送」随使用增长。

## 员工侧

- 设置 → 聊天平台 → 钉钉：查看绑定状态、选择默认助手、查看指令用法。
- 任务页右上「提醒设置」：选择渠道（站内 / 钉钉）与事件类型；管理员未启用钉钉推送时该渠道灰显。

## 运维要点

- 容器出网经 `HTTP(S)_PROXY`，`NODE_USE_ENV_PROXY=1` 使 Node 的 fetch 与 WebSocket 均经代理；`NO_PROXY` 需包含 `localhost,127.0.0.1`。
- 单实例部署：Stream 连接与调度 worker 都在服务进程内，多副本时分别依赖钉钉的多连接分发与 Redis 锁。
- 排查：`DEBUG=lobe-server:messenger:*,lobe-server:task-scheduling` 查看连接/转发/调度日志；Redis 键 `messenger:dingtalk:*`；`notification_deliveries` 表的 `failed_reason`。
