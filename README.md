<div align="center">

**简体中文** · [English](./README.en-US.md)

# LobeHub Enhanced・LobeHub 企业增强版

</div>

把开源的 LobeHub 变成一套**开箱即用的企业 AI 平台**：自带管理面板和用户管理，支持**钉钉扫码登录**与 **Authentik / 通用 OIDC 单点登录**，额外接入 **ChatGPT 网页版、Grok、Cursor** 等服务商并可全员共享一个账号，品牌名称与颜色随你定制，所有管理操作**全程留痕可审计**。一条 `docker compose up -d` 就能私有部署，Docker 镜像同时支持 x86-64 与 ARM（含 Apple 芯片）。

> 本项目是社区维护的非官方分支，**与 LobeHub LLC 无关，也未获其背书或支持**。它基于 [lobehub/lobehub](https://github.com/lobehub/lobehub) 二次开发，按 LobeHub Community License 分发（见 [LICENSE](./LICENSE)）。“LobeHub” 是 LobeHub LLC 的商标，此处仅用于说明上游项目。

|          |                                              |          |                                                  |
| -------- | -------------------------------------------- | -------- | ------------------------------------------------ |
| 代码仓库 | `https://github.com/12dora/lobehub-enhanced` | 容器镜像 | `ghcr.io/12dora/lobehub-enhanced`                |
| 当前版本 | `v1.0.0`                                     | 上游基线 | `lobehub/lobehub` v2.2.10（已吸收 v2.2.13 更新） |

## 新增功能

所有增强功能**默认开启**，可以在管理面板「系统 → 模块」在线开关，也可以用环境变量逐项关闭（见下文）。

**登录与账号**

- 钉钉扫码登录：扫码即入，企业白名单，只有白名单企业的成员才能登录
- Authentik / 通用 OIDC 单点登录，登录方式向导带你完成配置、测试、发布与回滚
- 两步验证（TOTP 验证器）与通行密钥（Passkey）登录；管理员可为本地账号重置密码、清除两步验证（SSO 账号的认证因子仍归 IdP 管）
- 开放注册 + 邮箱域名白名单
- 用户管理：角色、封禁、会话、删除，全部在管理面板（`/admin`）完成

**AI 服务商**

- 共享账号服务商：**ChatGPT 网页版、Grok（SuperGrok / X Premium 订阅）、Grok Build（CLI 代理）、Cursor** —— 管理员授权一次平台账号，全员直接用，无需人手一份 API Key
- 80+ 服务商与模型统一管理，模型列表可从上游一键同步
- 平台助理：全员下发、灰度发布
- 技能与连接器治理，连接器支持共享 OAuth 授权

**管控与审计**

- 操作日志与实时查看；会话历史、证据导出、法律保全、数据保留
- 内容审计：关键词 + LLM 裁判，按内容类别配置阻断 / 降级 / 仅记录
- 设置策略（默认值 / 锁定）与侧边栏布局管控
- 网络代理：内置代理引擎，按作用域决定哪些出站流量走代理
- 遥测上报已彻底移除

**运营与品牌**

- 品牌自定义：名称、Logo、主色，一直覆盖到启动画面
- 任务模板库：面向制造业场景的首页任务推荐，可增删改、拖拽排序

**部署与性能**

- 23 个功能模块按需启停：`LOBE_MODULE_PRESET=minimal|standard|full` 三档预设，或在管理页逐个开关
- 从完整栈到「一个容器 + 一个数据库」的最小部署，见下文[部署形态](#部署形态)
- 两轮性能优化实测：空闲 CPU 约 1.5% 降至约 0.1%，启动内存约 500 MB 降至约 240 MB，空闲数据库往返减少约 80%，首屏 JS 从 33.8 MB 降至约 25 MB

## 截图

<table>
<tr>
<td width="50%"><img width="100%" src="docs/enhanced/screenshots/admin-overview.png" alt="管理概览"><br><sub><b>管理概览</b></sub></td>
<td width="50%"><img width="100%" src="docs/enhanced/screenshots/admin-task-templates.png" alt="任务模板"><br><sub><b>任务模板</b></sub></td>
</tr>
<tr>
<td width="50%"><img width="100%" src="docs/enhanced/screenshots/admin-modules.png" alt="模块配置"><br><sub><b>模块配置（按需启停）</b></sub></td>
<td width="50%"><img width="100%" src="docs/enhanced/screenshots/admin-audit-logs.png" alt="操作日志"><br><sub><b>操作日志</b></sub></td>
</tr>
<tr>
<td width="50%"><img width="100%" src="docs/enhanced/screenshots/admin-chatgpt-web.png" alt="ChatGPT 网页版"><br><sub><b>ChatGPT 网页版共享账号</b></sub></td>
<td width="50%"><img width="100%" src="docs/enhanced/screenshots/admin-branding.png" alt="品牌自定义"><br><sub><b>品牌自定义</b></sub></td>
</tr>
</table>

## 快速部署（Docker）

准备：一台装有 Docker 与 Docker Compose 的机器；数据库使用 `paradedb/paradedb:latest-pg17`（自带向量与全文检索，普通 postgres 镜像跑不通迁移）；对象存储用自带的 rustfs（其地址必须能被**浏览器**访问）；Redis 可选。

```bash
# 1. 获取部署文件（只需要 docker-compose/enhanced 目录）
git clone https://github.com/12dora/lobehub-enhanced.git
cd lobehub-enhanced/docker-compose/enhanced
cp .env.example .env

# 2. 生成三个独立密钥，填入 .env 的 AUTH_SECRET / KEY_VAULTS_SECRET / PLATFORM_MASTER_KEY
openssl rand -base64 32

# 3. 编辑 .env：APP_URL（对外访问地址）、S3_ENDPOINT / S3_PUBLIC_DOMAIN（浏览器可达的对象存储地址）、
#    BOOTSTRAP_SUPER_ADMIN_EMAIL（首个管理员邮箱）+ BOOTSTRAP_ALLOW_CREATE=1

# 4. 启动，并从日志里取一次性管理员密码
docker compose up -d
docker compose logs app | grep -i bootstrap

# 5. 打开 <APP_URL>/admin 登录，随后修改密码
```

| 必填变量                      | 说明                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `APP_URL`                     | 对外访问地址，如 `https://chat.example.com`                                                           |
| `DATABASE_URL`                | `postgresql://user:pass@host:5432/db`（启动时自动迁移）                                               |
| `AUTH_SECRET`                 | 登录会话签名密钥                                                                                      |
| `KEY_VAULTS_SECRET`           | 用户级 API Key 的加密密钥                                                                             |
| `PLATFORM_MASTER_KEY`         | 平台密钥的主密钥（base64，32 字节）。**务必备份**，丢失后已存的服务商 / 连接器 / 登录方式密钥无法解密 |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | 首个管理员邮箱；配合 `BOOTSTRAP_ALLOW_CREATE=1` 自动创建                                              |

增强功能默认全部开启；如需关闭某项，可在管理面板「系统 → 模块」在线开关，或把对应变量设为 `0`：`ENABLE_PLATFORM_ADMIN`（管理面板）、`ENABLE_PLATFORM_MANAGED_AI`、`ENABLE_PLATFORM_MANAGED_SKILLS`、`ENABLE_PLATFORM_MANAGED_CONNECTORS`、`ENABLE_PLATFORM_MANAGED_AGENTS`、`ENABLE_PLATFORM_SETTINGS_POLICY`、`ENABLE_RUNTIME_BRANDING`、`ENABLE_DATABASE_OIDC`。使用数据库配置的登录方式时请保持 `AUTH_SSO_PROVIDERS` 为空。

### 部署形态

同一个镜像，从完整栈到「一个容器 + 一个数据库」按机器选择：

| 启动命令                                             | 边车                        | 适用                                                                           |
| ---------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| `docker compose up -d`                               | ParadeDB + Redis + 对象存储 | 默认完整栈（4 核 / 8 GiB 起）                                                  |
| `docker compose --profile search up -d`              | 另加 SearXNG                | 需要内置联网搜索                                                               |
| `docker compose -f docker-compose.minimal.yml up -d` | 仅 ParadeDB                 | 小机器（1–2 核 / 2–4 GiB），搭配 `minimal` 预设                                |
| `docker compose --profile document-render up -d`     | 另加 Gotenberg              | 需要把 Word / Excel / PPT 渲染成页面图喂给模型（另需设 `DOCUMENT_RENDER_URL`） |

23 个功能模块由 `LOBE_MODULE_PRESET=minimal|standard|full` 三档预设决定默认启停（默认 `full`，即今天的完整行为），单个模块可在管理页「系统 → 模块」或用 `LOBE_MODULES_DISABLED` 覆盖。Node 堆上限 `LOBE_NODE_HEAP_MB` 由 compose 注入 1536（裸 `docker run` 不设则不封顶）。各模块的内存 / 后台任务开销与实测数据见 [`docs/enterprise/modules.md`](./docs/enterprise/modules.md)。

升级：`docker compose pull && docker compose up -d`（迁移自动执行）。镜像标签：`latest`、`1.0`、`1.0.0`，支持 `linux/amd64` 与 `linux/arm64`（Apple 芯片的 Mac 通过 Docker Desktop 直接使用 arm64 镜像）。完整示例见 [`docker-compose/enhanced/`](./docker-compose/enhanced/)。

### AI 一键部署（含沙箱与文档渲染）

把下面这段话直接发给你的 AI 助手（Claude Code、Codex、Cursor 等），它会替你完成部署，并顺带装好**代码沙箱**与**文档渲染**两个边车：

```text
请在这台机器上用 Docker 部署 LobeHub Enhanced，并同时装好沙箱和文档渲染：

一、基础栈
1. git clone https://github.com/12dora/lobehub-enhanced.git，进入 docker-compose/enhanced，把 .env.example 复制为 .env。
2. 用 openssl rand -base64 32 生成互不相同的值，分别填入 AUTH_SECRET、KEY_VAULTS_SECRET、PLATFORM_MASTER_KEY、POSTGRES_PASSWORD、RUSTFS_SECRET_KEY。
3. 把 APP_URL 设为对外访问地址（本机试用填 http://localhost:3210）；把 S3_ENDPOINT 和 S3_PUBLIC_DOMAIN 设为浏览器能访问到的
   http://<本机IP或域名>:9000（不能填 localhost，否则浏览器取不到附件）；设置 BOOTSTRAP_SUPER_ADMIN_EMAIL=<我的邮箱> 和 BOOTSTRAP_ALLOW_CREATE=1。

二、沙箱边车（代码 / 终端 / 文件工具跑在同级容器里）
4. 在仓库根目录构建沙箱镜像：docker build -f Dockerfile.sandbox -t aihub-sandbox:latest .
   （约 2.7 GB、十几分钟；机器上有 bun 时也可以用 bun run build:sandbox-image -- --smoke，顺带跑一遍冒烟测试。
   镜像已预装 LibreOffice、pandoc、poppler-utils、中日韩字体和 Office 处理库，沙箱根文件系统只读，运行时装不了包，所以必须用这个镜像。）
5. 把宿主 Docker 套接字的组 ID 写进 .env：Linux 用 DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)，macOS 用 stat -f '%g'。
   SANDBOX_PROVIDER=local 与 SANDBOX_LOCAL_IMAGE=aihub-sandbox:latest 已是默认值，不用改。

三、文档渲染边车（把 Word / Excel / PPT 转成页面图喂给模型，缺它这些文件只能当纯文本读）
6. 在 .env 里加 COMPOSE_PROFILES=document-render 和 DOCUMENT_RENDER_URL=http://document-render:3000
   （会额外起一个 gotenberg/gotenberg:8 容器，限 1 CPU / 1 GiB，只在内网可达；已经用了别的 profile 就写成 COMPOSE_PROFILES=search,document-render）。

四、启动与自检
7. 执行 docker compose up -d，等 app 容器日志出现数据库迁移通过与 Ready，然后从日志里找到 bootstrap 打印的一次性管理员密码（只打印一次）告诉我。
8. 自检并把结果贴给我：docker compose ps 所有容器 running/healthy；docker run --rm aihub-sandbox:latest soffice --version 能打印版本；
   docker compose logs document-render 无报错；curl -I <APP_URL> 有响应。
9. 最后告诉我 <APP_URL>/admin 的登录方式，提醒我备份 .env 里的 PLATFORM_MASTER_KEY（丢了已存的服务商密钥无法解密），
   并说明沙箱和文档渲染分别在管理面板「系统 → 模块」和「系统 → 通用 → 文档渲染」里开关、测试连接。

排障要求：端口冲突、镜像拉取失败先说明原因再给方案；沙箱报 EACCES 或 “Docker daemon is unreachable” 基本是 DOCKER_GID 填错，
按宿主套接字实际组 ID 改掉再重启 app 容器。不要用普通 postgres 镜像替换 paradedb，迁移跑不过。
```

不想要沙箱或文档渲染时，把第二、三步删掉即可：沙箱可在管理面板「系统 → 模块」关掉 `sandbox` 模块，`DOCUMENT_RENDER_URL` 留空则 Office 文件按纯文本处理。

## 登录方式

在管理面板 **系统 → 安全与认证 → 登录方式** 中新建，向导会带你完成配置、测试与发布：

- **钉钉**：填写钉钉开放平台应用的 AppKey / AppSecret，然后点击「通过钉钉登录添加企业」扫码，企业 ID 会自动加入白名单 —— 只有白名单里的企业成员才能登录。回调地址：`<APP_URL>/oauth/identity-provider/dingtalk/<登录方式标识>`；应用需开通「通讯录个人信息读权限」，授权范围包含 `openid corpid`。详见 [`docs/enterprise/dingtalk-login.md`](./docs/enterprise/dingtalk-login.md)。
- **Authentik / 通用 OIDC**：填写发现地址与客户端凭据即可，回调地址：`<APP_URL>/api/auth/oauth2/callback/<登录方式标识>`。详见 [`docs/enterprise/authentik-setup.md`](./docs/enterprise/authentik-setup.md)。
- 测试登录用回调地址统一为 `<APP_URL>/oauth/identity-provider/test/callback`；多种登录方式可同时启用。

## 开发

```bash
pnpm install  # 安装依赖
bun run dev   # 启动开发环境
bun run check # 代码检查 + 相关测试
```

约定与结构见 [`AGENTS.md`](./AGENTS.md)，运维文档见 [`docs/enterprise/`](./docs/enterprise/)。

## 许可证

本仓库按 **LobeHub Community License**（Apache-2.0 附加条款）分发，`LICENSE` 原样保留。本项目是 lobehub/lobehub 的衍生作品：按该许可证第 1 (b) 条，**开发并分发衍生作品需要向 LobeHub LLC 取得商业授权**（<hello@lobehub.com>），使用者须自行确保合规。上游代码版权归 LobeHub LLC 所有，全部版权与许可声明均已保留；相对上游的改动记录在 git 历史与本文档中。
