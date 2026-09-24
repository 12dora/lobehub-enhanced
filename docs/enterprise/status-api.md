# 状态 API

给外部状态看板读取本平台健康摘要。令牌只在创建时显示一次。响应不含密钥、令牌原文或内部堆栈。

## 创建令牌

管理后台 → 状态监控 → 告警设置 → 状态 API。

- 轮换会作废上一枚数据库令牌，并返回新令牌（`sk-status-` 加 32 位字母数字）。库中只保存 sha256 与提示（前缀加末 4 位）。
- 每个进程把库里的令牌哈希缓存在内存里，最多每 60 秒读一次库，数据库正常时也一样。执行轮换或撤销的那个进程在提交成功后立刻改自己的缓存。其它进程在这 60 秒内仍按旧缓存判断：旧令牌继续有效，新令牌返回 401。若缓存里还是「没有令牌」（例如刚生成第一枚），这些进程返回 503 `not_configured`，直到缓存过期后重新读库。
- 读库失败时，有上一份哈希就继续用它，这样数据库故障时摘要仍能报 `outage`。只有库和缓存都读不到、且未配置环境变量时，摘要和事件才返回 503 `unavailable`。
- 轮换和撤销需要与修改基础设施相同的近期重新认证。可选的审计原因会写在成功和失败的审计记录上；未填写时该栏为空。
- 环境变量 `STATUS_API_TOKEN` 若已设置，也可作为令牌使用，与数据库令牌二选一即可。

## 端点

基址为 `APP_URL`。三个接口都返回 `Cache-Control: no-store`。

| 方法 | 路径                     | 认证                           |
| ---- | ------------------------ | ------------------------------ |
| GET  | `/api/status/v1/health`  | 无                             |
| GET  | `/api/status/v1/summary` | `Authorization: Bearer <令牌>` |
| GET  | `/api/status/v1/events`  | 同上                           |

健康检查不查依赖。摘要在进程内缓存 15 秒，同一时刻的并发请求共用一次快照。认证使用上面的 60 秒令牌缓存：命中缓存时不再查库。

错误：

| HTTP | JSON                             | 含义                                                             |
| ---- | -------------------------------- | ---------------------------------------------------------------- |
| 503  | `{ "error": "not_configured" }`  | 没有可用令牌                                                     |
| 503  | `{ "error": "unavailable" }`     | 读不到已保存的令牌，内存里也没有上一份哈希，且未配置环境变量令牌 |
| 401  | `{ "error": "unauthorized" }`    | 未带令牌或令牌不正确                                             |
| 400  | `{ "error": "invalid_request" }` | `since` 或 `limit` 不合法                                        |

## 健康检查

```json
{ "service": "aihub", "status": "ok", "time": "2026-09-25T00:00:00.000Z", "version": "1.12.0" }
```

`version` 是当前部署版本。

```bash
curl -sS "$APP_URL/api/status/v1/health"
```

## 摘要

```bash
curl -sS -H "Authorization: Bearer $STATUS_TOKEN" "$APP_URL/api/status/v1/summary"
```

```json
{
  "checkedAt": "2026-09-25T00:00:00.000Z",
  "components": [
    {
      "id": "dependency.database",
      "group": "dependency",
      "name": "数据库",
      "status": "healthy",
      "message": null,
      "latencyMs": 4,
      "lastCheckedAt": "2026-09-25T00:00:00.000Z"
    }
  ],
  "incidents": [],
  "metrics": {
    "instances": { "live": 1, "offline": 0 },
    "jobs": { "active": 0, "failed": 0 },
    "runtimeErrors24h": 0,
    "dingtalkApiCallsToday": null,
    "dingtalkApiDailyThreshold": 5000
  },
  "schemaVersion": 1,
  "service": {
    "id": "aihub",
    "name": "站点标题",
    "version": "1.12.0",
    "gitSha": null,
    "url": "https://example.com",
    "instanceId": "pinst_…"
  },
  "status": "operational"
}
```

`components[].group`：`dependency`、`capability`、`worker`、`runtime`、`budget`。名称与状态监控页一致（数据库、Redis、对象存储、邮件服务、密钥管理、沙箱、文档渲染、能力就绪、后台任务、运行时错误、钉钉接口今日调用量）。

`components[].status`：`healthy`、`degraded`、`unavailable`、`disabled`、`unknown`。

总状态：

| `status`      | 条件                                         |
| ------------- | -------------------------------------------- |
| `outage`      | 数据库或 Redis 为 `unavailable`              |
| `degraded`    | 任一组件为 `degraded` 或 `unavailable`       |
| `operational` | 其余情况（`disabled` 与 `unknown` 不算故障） |
| `unknown`     | 快照本身失败                                 |

运行时组件只包含最近 1 小时内仍有错误的子系统；只要有一条，该组件就是 `unavailable`，总状态因此是 `degraded`。告警工人只在错误出现尖峰时才发通知，所以状态页可能已经标红，而告警还没发出。`metrics.runtimeErrors24h` 仍统计 24 小时。`metrics.jobs` 与管理后台任务列表使用同一条清除水位：已经结束、且结束时间不晚于水位的任务不计入。

钉钉接口调用量读不到时为 `null`。每日阈值与告警设置、钉钉连接器是同一处：管理员留空时用环境变量 `DINGTALK_API_DAILY_ALERT_THRESHOLD`（默认 5000），填 0 表示关闭。阈值为 0 时 `dingtalkApiDailyThreshold` 为 `null`，对应组件为 `disabled`。告警设置读不到时改用该环境变量或默认 5000，不会因为读失败而变成 `null`。

沙箱同时出现在依赖和能力里时只计一次，用依赖那一项。`incidents` 只来自当前不健康的组件。`incidents[].since` 是该组件这次进入不健康的时间（告警状态里记下的），没有记录时为 `null`，不是最近一次探测时间。`AIHUB_STATUS_ALERTS=0` 时告警工人不运行，因此不写这份状态，`since` 一直是 `null`。

## 事件

```bash
curl -sS -H "Authorization: Bearer $STATUS_TOKEN" \
  "$APP_URL/api/status/v1/events?since=2026-09-25T00:00:00.000Z&limit=50"
```

`since` 为排他下界（严格晚于该时间）。`limit` 为 1–200，默认 50。存储只保留最新约 50 条，因此更大的 `limit` 也不会返回更多。顺序为新的在前。

```json
{
  "events": [
    {
      "id": "evt_0123456789abcdef",
      "at": "2026-09-25T00:00:01.000Z",
      "level": "error",
      "componentId": "runtime.dingtalk_api",
      "message": "调用失败"
    }
  ]
}
```

`level`：`error`、`warning`、`info`。`componentId` 与摘要组件 id 相同：`dependency:database` 写成 `dependency.database`，`budget:dingtalk_api` 写成 `budget.dingtalk_api`，`spike:<子系统>` 或单独的子系统名写成 `runtime.<子系统>`。

告警工人记下状态变化的规则：

- 总开关关闭时仍会记下。`AIHUB_STATUS_ALERTS=0` 时工人不运行，因此一条也不记。
- 某一类规则关闭时，这一类的变化不记。
- 「恢复时通知」关闭时，恢复不记。
- 同一组件、同一状态（故障或恢复）10 分钟内最多记一条，避免来回抖动把最近事件挤满。组件的健康状态每次仍会更新，所以下一次真正的变化不会丢。
- 重复发送的抑制窗口是告警设置里的重复间隔，与这 10 分钟的记录窗口分开。发送被抑制时，只要还在记录规则里，第一条仍会记下。

## schemaVersion

当前为 `1`。

- 只增加字段、或增加组件 id 时，不升级版本。客户端应忽略不认识的字段。
- 删除字段、改变字段类型、或改变已有 id / 枚举含义时，将 `schemaVersion` 加 1。
- 路径保持 `/api/status/v1/`。不兼容的下一版使用新的路径版本。
