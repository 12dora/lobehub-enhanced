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
| Cron     | `TaskModel.getScheduledTasks` + `isExecutionTime`（时区 + `lastHeartbeatAt` 去重），到期则 `runScheduleTick`，并发 ≤ 3                                                            |
| 心跳     | `automationMode=heartbeat` 且可调度；`lastHeartbeatAt + heartbeatInterval` 已到期、且本进程没有 pending `setTimeout` 时补跑 `runHeartbeatTick`。用内存 + `lastHeartbeatAt` 防双发 |
| Watchdog | 调用与 QStash `/watchdog` 相同的 `runWatchdogScan`：超时 running 任务标 `failed` 并写 brief                                                                                       |

多副本用 Redis 锁 `task-scheduling:sweep`（TTL 55 秒，ioredis，与 messenger `linkTokenStore` 同一客户端）。Redis 不可用时打警告后仍执行。

状态查询：`getTaskSchedulingStatus()` → `{ lastSweepAt, lastCounts: { dispatched, skipped, failed } }`，供后续管理页。

日志命名空间：`lobe-server:task-scheduling`（`DEBUG=lobe-server:task-scheduling`）。

## 上线后如何验证

1. 确认进程日志出现 `started interval=60000ms`（或 `DEBUG=lobe-server:task-scheduling` 下的 sweep 计数）。
2. 在任务页给某任务设 cron 为 `* * * * *`（或每分钟 `*/1 * * * *`），时区选实际时区，状态保持可调度（不要用 paused、completed）。
3. 等最多约 1 分钟，打开该任务的运行记录：应新增 `task_topics` 行，`trigger = 'schedule'`。
4. 心跳模式：间隔设为允许的最小值（≥ 600 秒），手动跑一次后再重启服务；重启后若已过间隔，应补一次 `trigger = 'heartbeat'` 的 topic，而不会在同一分钟内双跑。
5. Watchdog：将某任务置 `running`，把 `lastHeartbeatAt` 改到超过 `heartbeatTimeout` 之前，下一轮扫描后应变 `failed` 并出现 error brief。

不在本环境对真实库做联调；以上步骤在部署后的实例上执行。
