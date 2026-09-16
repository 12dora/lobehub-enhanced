# 进程内任务调度（本地模式）

本部署没有 `QSTASH_TOKEN`，Upstash QStash 的 cron / 延迟消息不会触发。`taskSchedulingWorker` 在进程内每 60 秒扫一次库，补上「到期 cron 任务 / 心跳 tick / 卡住任务 watchdog」。

## 何时会启动

同时满足才会跑：

- 未开队列运行时（`AGENT_RUNTIME_MODE` 不是 `queue`，即 `enableQueueAgentRuntime` 为假）
- 已配置 `DATABASE_URL`
- 不是 Vercel / Lambda / Edge

`QStash` 路径（`/api/workflows/task/schedule-dispatch` 等）保持原样，本 worker 不替代云上 QStash。

## 扫到什么

| 步骤     | 行为                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron     | `TaskModel.getScheduledTasks` + `isExecutionTime`（时区 + `lastHeartbeatAt` 去重），到期则 `runScheduleTick`，并发 ≤ 3。若 `task.config.reminder.kind === 'reminder'`，tick **不跑 agent**：`ReminderTaskService.fireForTick` 走钉钉工作通知 + 服务号机器人 + 站内铃铛，然后 `TaskModel.updateHeartbeat`。一次性提醒（`once=true`）或 `until` 已过则把任务标 `completed`。 |
| 心跳     | `automationMode=heartbeat` 且可调度；`lastHeartbeatAt + heartbeatInterval` 已到期、且本进程没有 pending `setTimeout` / 进行中的 tick 时补跑 `runHeartbeatTick`。从未跑过的任务（`lastHeartbeatAt` 为空）不会被扫到；并发与 cron 相同（≤ 3） |
| Watchdog | 调用与 QStash `/watchdog` 相同的 `runWatchdogScan`：超时 running 任务标 `failed` 并写 brief                                                                                       |

多副本用 Redis 锁 `task-scheduling:sweep`（ioredis，与 messenger `linkTokenStore` 同一客户端）：`SET` NX 写入随机 token，TTL 5 分钟，扫完后用 Lua compare-and-delete 释放。选长 TTL + 显式释放，而不是持锁期间续期：一次 sweep 是整段临界区，应一次跑完或等 TTL 过期，避免另一副本在 kickoff 尚未结束时再扫一遍。Redis 不可用时打警告后仍执行。

状态查询：`getTaskSchedulingStatus()` → `{ lastSweepAt, lastCounts: { dispatched, skipped, notDue, failed } }`，供后续管理页。`notDue` 是尚未到点的行；`skipped` 是已到点但本轮未真正发出的 tick（pending timer、inflight、快照变化、tick 自身拒绝）。

日志命名空间：`lobe-server:task-scheduling`（`DEBUG=lobe-server:task-scheduling`）。

## 上线后如何验证

1. 确认进程日志出现 `started interval=60000ms`（或 `DEBUG=lobe-server:task-scheduling` 下的 sweep 计数）。
2. 在任务页给某任务设 cron 为 `*/1 * * * *`（每分钟），时区选实际时区，状态保持可调度（不要用 paused、completed）。不要用 `* * * * *`：`isExecutionTime` 把 `cronHour === '*'` 当成「每小时的某一分钟」（例如 `30 * * * *`），有过 `lastExecutedAt` 后最多每 60 分钟再跑一次，不会每分钟触发。
3. 等最多约 1 分钟，打开该任务的运行记录：应新增 `task_topics` 行，`trigger = 'schedule'`。
4. 心跳模式：间隔设为允许的最小值（≥ 600 秒），手动跑一次后再重启服务；重启后若已过间隔，应补一次 `trigger = 'heartbeat'` 的 topic，而不会在同一分钟内双跑。从未手动跑过的心跳任务不会在 sweep 里被踢起来。
5. Watchdog：将某任务置 `running`，把 `lastHeartbeatAt` 改到超过 `heartbeatTimeout` 之前，下一轮扫描后应变 `failed` 并出现 error brief。

## 提醒任务（定时提醒）

定时提醒不再走独立的 `reminderWorker` 调度（该 worker 只扫 `reminders.task_id IS NULL` 的遗留行）。新提醒是普通任务：

- `automationMode='schedule'`，`scheduleTimezone='Asia/Shanghai'`，`status='scheduled'`，`assigneeAgentId` 为空（runner **不会**回填 inbox agent）。
- `tasks.config.reminder` 标记提醒任务（`kind:'reminder'`、`once`、`until`、`schedule`、`scheduleSummary`、`reminderId`）。
- cron 由结构化日程生成：一次 `mm HH D M *`、每天 `mm HH * * *`、每周 `mm HH * * d1,d2`（周日=0）、每月 `mm HH d1,d2 * *`。
- 「3 分钟后」一次提醒依赖 60s 扫描 + `isExecutionTime` 5 分钟容差；发出后必须写 `lastHeartbeatAt`，否则同一窗口会再投。
- 手动「立即发送 / 运行」走 `ReminderTaskService.fireNow`，返回 `{ topicId: null, reminderFired }`，不创建 `task_topics`。

不在本环境对真实库做联调；以上步骤在部署后的实例上执行。
