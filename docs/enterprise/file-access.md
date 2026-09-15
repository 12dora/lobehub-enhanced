# 文件访问控制（v1.3.5）

对象存储中的文件只通过两条路径对外可见，两条路径都不再是「知道 ID 即可读」。

## 浏览器路径：`GET /f/:id`

- 302 到短期预签名对象地址；所有响应 `Cache-Control: private, no-store` + `Vary: Cookie`。
- `pba_*`（平台品牌资源：Logo、Favicon、平台助理头像）保持公开，登录页与邮件依赖它。
- 其余 ID 必须携带 Better Auth 会话 Cookie：匿名 401，找不到 404，无权 403。
- 授权规则依次（`apps/server/src/services/file/fileAccess.ts` → `resolveFileAccess`）：
  1. 文件所有者（`files.user_id`）。
  2. 文件属于某工作区且可见性为 `public`/NULL，访问者是该工作区在册成员。
  3. 审计员：平台管理开关开启、审计模块启用、持有 `platform_audit:conversation_read:all`，且审计策略「内容访问模式」为「允许正文和附件」（`content_allowed`）。
     每次打开都写审计日志 `admin.audit.files.open`（目标类型 `file`，写失败则拒绝访问）。
- 话题链接分享页不走 `/f/`：`message.getMessages({ topicShareId })` 直接返回 15 分钟预签名对象地址。

## 机器路径：模型、沙箱与服务端取数

模型服务商、`imageUrlToBase64`、沙箱等无法携带 Cookie，因此服务端在把附件交给它们之前把本站 `/f/<id>` 换成预签名对象地址或 data URI：

- 内联运行时（ChatGPT/ChatGPT Web/Cursor/Grok/SuperGrok）：先尝试内联字节，失败或超限时改为预签名地址。
- 其他所有运行时：`beforeChat` / `beforeCreateImage` / `beforeCreateVideo` 仅做地址改写（image/file/video/audio 部件与 `imageUrl`/`imageUrls`/`endImageUrl` 参数）。
- 机器路径的授权复用 `resolveFileAccess`，但只接受「所有者/工作区成员」两种理由，不信任请求头里的工作区 ID。

## 对象键与存储桶

- 存储桶必须私有（`mc anonymous set none`），不得开放匿名 `GetObject`；应用只通过预签名地址读取。
- 客户端提供的对象键统一经 `assertClientObjectKey` 校验：相对路径、无 `..`/`.`/空段、无 `\`、无 `%`、无控制字符，且前缀受限：
  - 预签名上传：`files`（含配置的 `NEXT_PUBLIC_S3_FILE_PATH`）、`import_config`、`ragEval`、`eval-datasets`、`skills`；已存在的对象拒绝覆盖（HEAD 非 404 一律失败关闭）。
  - 导入 `importByFile` 只读 `import_config/`；RAG 评测只读 `ragEval/`；Agent 评测只读 `eval-datasets/`。
  - OpenAPI 上传的 `directory` 走同一允许列表（默认 `files/`），文件名会清洗分隔符/`%`/控制字符。
- 已知遗留：`file.checkFileHash` 仍返回同哈希对象的存储键（内容寻址去重需要），下一步应改为服务端按哈希解析键并从响应中去掉 `url`。

## 其他跨账户面

- `GET /api/agent/stream` 需登录且仅操作发起者可订阅。
- `verify.getReportBundle` 改为登录 + 按归属查询；`/verify/:runId` 不再是匿名公开路由。
- 用户头像路由 `/webapi/user/avatar/...` 需登录（任何登录用户可看同事头像）。
- 知识库只能关联访问者可见的文件；话题分享 ID 使用加密安全随机（21 位）。
