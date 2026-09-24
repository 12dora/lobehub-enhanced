# aihub-dws

钉钉个人数据的 sidecar。容器里只跑官方 `dws` CLI 和这个无依赖的 HTTP broker；访问令牌留在卷里，不进 AIHub，也不进 Postgres。

实现以 [`contract-v1.md`](/data/dev/plans/aihub-dingtalk-personal-mcp/contract-v1.md) §2、§2.1、§9 为准。下面只列运维需要的部分。

## 环境变量

| 变量                                                 | 默认                    | 说明                                                                                         |
| ---------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| `DWS_BROKER_TOKEN`                                   | 无                      | 至少 32 字符。更短则进程拒绝启动。除 `GET /healthz` 外，请求必须带 `Authorization: Bearer …` |
| `DWS_CONFIG_DIR`                                     | `/var/lib/dws/config`   | dws 配置、审计和日志                                                                         |
| `DWS_KEYCHAIN_DIR`                                   | `/var/lib/dws/keychain` | dws 密钥包                                                                                   |
| `HOME`                                               | `/var/lib/dws/home`     | dws 家目录                                                                                   |
| `DWS_BIN`                                            | `/usr/local/bin/dws`    | CLI 路径。测试可指到假的 dws                                                                 |
| `PORT`                                               | `8080`                  | 监听 `0.0.0.0`                                                                               |
| `NO_COLOR`                                           | `1`                     | 传给子进程时固定为 `1`                                                                       |
| `TZ`                                                 | `Asia/Shanghai`         | 原样传给 dws                                                                                 |
| `DINGTALK_DWS_AGENTCODE`                             | 不设置                  | v1 留空。只有进程里设了才会传给 dws                                                          |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 及小写形式 | 不设置                  | 原样传给 dws                                                                                 |

子进程环境是白名单：上面这些加上 `PATH`。`DWS_BROKER_TOKEN` 不会传给 dws。

启动时会把配置、密钥包、家目录建成 `0700`，并执行一次 `dws version`。之后无论这次是否成功，`/healthz` 最多每 60 秒在后台再探一次，自己不等待探针，触发复探的那一次仍返回上一次的结果。复探失败会清掉已记录的版本，之后是 503，直到某次复探成功再恢复 200。

## API

除 `GET /healthz` 外都要 Bearer 鉴权。请求体 JSON，最大 64KB。失败体是 `{ "error": { "code", "message" } }`。

| 方法   | 路径                           | 作用                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/healthz`                     | 当前探针有效：200 `{ok:true, dwsVersion}`。无效：503 `{ok:false, dwsVersion:""}`。不鉴权，也不等待后台复探                                                                                                                                                                                                                                                                                                                                                  |
| POST   | `/v1/login`                    | 设备码登录。身份列表只要失败就是 502 `LOGIN_START_FAILED`（不启动登录子进程，名额和锁会放开）。拿锁、读列表、等验证码合计不超过 25 秒                                                                                                                                                                                                                                                                                                                       |
| GET    | `/v1/login/:jobId`             | 查询登录任务，结束后保留 30 分钟                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DELETE | `/v1/login/:jobId`             | 进行中：先停子进程（最多等 5 秒）再读一次身份列表。期望身份是这次新出现的，或 `lastLoginAt` 比快照新：200 `{ok:true, status:'succeeded', identity}`。其它新身份会登出，然后 200 `{ok:true, status:'cancelled'}`。列表失败：200 `{ok:true, status:'cancelled', reconciled:false}`，审计 `CANCEL_RECONCILE_FAILED`。已成功：200 `{ok:true, status:'succeeded', identity}`，不登出。失败 / 过期 / 已取消：200 `{ok:true, status}`。未知：404 `LOGIN_NOT_FOUND` |
| GET    | `/v1/profiles/:profile/status` | `dws auth status`。排队最多 5 秒，子进程最多 15 秒。未登录或 profile 不在列表里（dws 退出 2 或 3）仍是 200 `{authenticated:false}`。客户端断开时杀掉子进程                                                                                                                                                                                                                                                                                                  |
| DELETE | `/v1/profiles/:profile`        | 登出前列表、登出、复查各最多 10 秒，三段合计最多 35 秒；超时或失败是 502 `LOGOUT_FAILED`。不在列表：200 `{ok:true, removed:false, absent:true}`。退出 0 且复查已消失：200 `{ok:true, removed:true}`。客户端断开后仍会跑完                                                                                                                                                                                                                                   |
| POST   | `/v1/exec`                     | 按允许列表执行读 / 写。工具失败仍是 HTTP 200                                                                                                                                                                                                                                                                                                                                                                                                                |

`profile` 形如 `corpId:userId`。`op` 与参数见合同 §2.1。broker 自己拼 argv，请求体不能加 flag。

每次真正调用会在 **stdout** 打一行 JSON 审计（`exec` / `login` / `logout` / `status`）。里面只有 profile 的 sha256 前 12 位，没有参数、消息正文或登录 stderr。

## 安全

- 状态目录挂进容器即可，例如宿主机 `~/apps/aihub/dws-state`，属主 uid/gid **10077**，模式 **0700**。不要挂到别的服务。
- **不要发布端口。** 只走 Compose 内部网络，由 AIHub 用 `DINGTALK_PERSONAL_BROKER_URL` 访问。
- 镜像以 uid 10077 运行。建议 `read_only`，并把 `/tmp` 做成 tmpfs（下载的临时目录在这里，用完即删，单文件上限 20MB）。
- 全局最多 4 个短命令同时跑，同一 profile 同时只有一个子进程。排队（profile 锁和全局名额共用一个时钟）最多 10 秒，超时错误码是 `TIMEOUT`。普通命令的子进程上限 50 秒，下载是 100 秒。
- 登录设备码最多 10 个进行中的任务。名额在开始等待之前扣下，失败或结束时放回，所以同时来 11 个会是 10 个任务加一个 429。
- 读操作和 `GET /v1/profiles/:profile/status` 在 HTTP 客户端断开时会杀掉子进程。写操作（改待办、完成待办、提交日志）以及 `DELETE /v1/profiles/:profile` 断开后仍会跑完。
- `GET /v1/profiles/:profile/status` 的排队上限是 5 秒、子进程上限是 15 秒（给 AIHub 的 30 秒留余量）。登出的三次子进程各 10 秒，整段 35 秒（给 AIHub 的 45 秒留余量）。
- 身份不符时，用登录前成功的 `dws profile list` 判断：返回的 profile 不在那次快照里才登出。快照任何失败都会让登录直接 502，不会启动设备码进程。没有快照却已发布的任务仍不登出（防御分支，审计码 `MISMATCH_CLEANUP_SKIPPED`）。
- 取消进行中的登录也用这份快照。子进程退出后再读一次列表：期望身份若是这次写上的（或 `lastLoginAt` 更新了）就按成功返回，令牌留给 AIHub 落账；其它新身份会登出。这次列表失败则返回 `cancelled` 且 `reconciled:false`，并打审计 `CANCEL_RECONCILE_FAILED`，不会猜着登出。这次读列表不占该 profile 的锁，避免和尚未退出的登录子进程互相卡住。

## 运维

构建（需要调用方环境里的代理变量；脚本自己不会清掉它们）：

```bash
bash apps/aihub-dws/scripts/build-image.sh
```

脚本把 `dws-linux-amd64.tar.gz`（默认 v1.0.62）下到 `apps/aihub-dws/vendor/`（已 gitignore），校验 sha256，再打 `aihub-dws:<package.json version>` 和 `aihub-dws:latest`。

本地确认进程时也不要写 `-p` / `ports`。健康检查走容器内的 `/healthz`（镜像里的 HEALTHCHECK 已经这样做）：

```bash
docker run --rm --name aihub-dws-check \
  -e DWS_BROKER_TOKEN="$(openssl rand -hex 32)" \
  -v "$HOME/apps/aihub/dws-state/config:/var/lib/dws/config" \
  -v "$HOME/apps/aihub/dws-state/keychain:/var/lib/dws/keychain" \
  -v "$HOME/apps/aihub/dws-state/home:/var/lib/dws/home" \
  --read-only --tmpfs /tmp:size=256m \
  aihub-dws:latest
```

生产 Compose 只把服务放在内部网络上，不要发布端口。

开发机直接跑（Node 24）：

```bash
cd apps/aihub-dws
DWS_BROKER_TOKEN="$(openssl rand -hex 32)" DWS_BIN=/usr/local/bin/dws node src/server.ts
```

测试（vitest 用仓库根的 `node_modules`，不要在这个目录单独装依赖）：

```bash
cd apps/aihub-dws && /data/dev/lobehub-enhanced/node_modules/.bin/vitest run --config vitest.config.mts
```

dws 自己的 jsonl 审计和调试日志在 `$DWS_CONFIG_DIR/audit` 与 `$DWS_CONFIG_DIR/logs`。进程启动时清一次，之后每 6 小时删掉超过 14 天的文件。
