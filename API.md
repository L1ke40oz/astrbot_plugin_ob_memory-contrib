# Dashboard API 文档

本文档描述记忆插件内嵌 HTTP 服务的全部 API 端点，供前端开发者或 LLM 参考。

**Base URL**: `http://{dashboard_host}:{dashboard_port}` (默认 `http://localhost:2140`)

---

## 认证机制

除 `/health`、`/auth/*`、`/dashboard`、`/static/*` 外，所有 `/api/*` 端点需要有效的 session cookie。

- Cookie 名称: `memory_dashboard_session`
- 有效期: 7 天
- 属性: `httpOnly`, `SameSite=Lax`
- 未认证请求返回: `401 {"detail": "auth required"}`

---

## 双界面与新版 OB 适配（v1.3.0）

`GET /` 与 `GET /dashboard` 返回固定地址的界面容器。容器把切换按钮放到两套界面顶部的「退出」右侧，通过同源 iframe 切换，外层 URL 不变。`GET /dashboard?ui=classic` 返回原版页面，`GET /ob` 返回 OB 页面，`GET /ob/static/{filename}` 只提供白名单资源。页面本身可公开读取，业务 API 全部复用 `memory_dashboard_session` 认证。OB 的六项状态统计直接使用当前会话已加载的完整记忆数组，不额外读取其他会话。

原有 `/api/*` 响应结构保持不变。新版界面将请求发送到独立的 `/ob/api/*` 命名空间，所有业务请求可携带 `session` 查询参数；配置指定 `dashboard_session_id` 时优先执行锁定，拒绝其他会话。省略会话时采用最近活跃会话。

OB 折叠筛选面板在当前会话完整数组上执行状态、时间范围、最低重要度、领域及标签的交集筛选，并与搜索结果取交集。最新创建、回想次数、重要性和权重四种排序在前端完成，无需增加 API 排序参数。记忆星河复用 `GET /ob/api/buckets?sort=created_asc`；父页面完成共享认证和会话解析后，将记录发送给同源星河 iframe。消息同时校验 origin 和父子窗口来源；换会话会销毁旧 iframe，过期响应不再投递。不生成可公开读取的记忆 JSON，星河静态资源中不含示例或真实记忆。`/ob/api/network` 概念图接口继续保留兼容，OB 导航展示星河。

The Galaxy tab reuses the authenticated bucket API and validates same-origin parent/frame messages. Static assets contain no memory data; there is no public JSON export or new data endpoint. The legacy concept-network API remains available.

- `GET /ob/api/sessions`：返回会话摘要、默认会话和 `locked` 状态。
- `GET /ob/api/capabilities`：明确列出支持与未支持的功能。
- `GET /ob/api/buckets?sort=score|created_desc|created_asc`：返回 OB 形状的当前会话记忆数组。
- `GET /ob/api/bucket/{id}`：返回 `metadata`、原始正文、活跃分和关联感受。读取不触发记忆激活。
- `GET /ob/api/search?q=...`：当前会话搜索；已接入搜索服务时使用其关键词 / 向量检索，否则回退文本搜索。
- `PATCH /ob/api/bucket/{id}/edit`：支持名称、正文、域、标签、重要度、类型和 pinned / resolved / digested；不支持字段返回 400，不静默丢弃。更新正文时复用已有 embedding 服务。
- `POST /ob/api/bucket/{id}/pin|resolve|archive`：切换钉选、切换已解决、归档；钉选记忆需先解除钉选才能归档。
- `POST /ob/api/buckets/batch`：`{"ids":["..."],"action":"resolve|archive"}`；最多 100 条，写入前检查所有目标属于当前会话，事务内保存。
- `POST /ob/api/buckets/permanent-delete`：`{"ids":["..."],"confirm":true}`；共享登录认证，执行配置会话锁。需提供 1–100 个非空字符串 ID，confirm 必须是布尔 true。事务内先核对全部目标属于当前会话且仍存在，再删除普通记忆与关联向量；任一步失败整批回滚。成功返回 `{"ok":true,"deleted":["..."]}`，重复 ID 去重；未确认、无效 ID、跨会话或已不存在的目标返回 400，未登录返回 401。不会删除计划、信件或已有导出 / 备份。
- `GET /ob/api/network?mode=concept`：基于标签、域和正文双链的概念网络；最多 150 节点。向量投影尚未实现，返回 501。
- `GET /ob/api/config`：仅返回提供给新界面的插件能力摘要，不返回 API 密钥。
- `GET /ob/api/heartbeat`、`GET /ob/api/version`：插件运行和版本摘要。
- `GET /ob/api/plans`：按 active / resolved / abandoned 返回当前会话的计划和变更记录。
- `POST /ob/api/plans`：`{"content":"承诺正文","name":"可选名称","weight":0.5}`；重量范围 0–1，进行中的相同正文计划精确去重。
- `POST /ob/api/plans/{id}/action`：`{"action":"resolve|abandon|reopen|edit"}`；edit 可附 content、name、weight。历史记录包含操作者和变更前后值。
- `GET /ob/api/letters?author=user|ai&q=...`：当前会话信件列表。锁检查先于搜索；不可读信件不含 title 和 content。
- `GET /ob/api/letter/{id}`：采用相同权限规则的单封信件读取。
- `POST /ob/api/letter`：content 必填，支持 title、user_name、date、lock_type、unlock_date。网页作者固定为 human，author 只接受 user。
- `PATCH /ob/api/letter/{id}`：仅作者可修改 content、title、date 或 lock_type / unlock_date；另一方即使已可读也不能改写原文。
- `DELETE /ob/api/letter/{id}`：仅作者可归档，原文仍保留于数据库，不执行物理删除。

锁类型为 none、timed、permanent。timed 的 unlock_date 必须是未来且包含时区的 ISO 8601 时间，到期后对方可读。身份由可信调用入口决定：网页为 human，模型工具为 ai，不从请求体接受锁所有者。跨会话 ID 返回 404；无权改写或解锁返回 403；无效参数返回 400；并发版本冲突返回 409。

Schema v3 使用 `memory_plans`、`memory_letters` 专表；普通记忆 API、网络和历史 ZIP 导出不包含信件正文，防止绕过锁。新增模型工具 `memory_plan`（list/create/edit/resolve/abandon/reopen）与 `memory_letter`（list/read/write/edit/lock/archive），会话由 AstrBot SessionResolver 解析，模型不能传入其他会话 ID。

For clients: plans and correspondence use separate persistent tables. Dashboard callers are always the human side; model tools always use the AI side. Locked titles and bodies are redacted before filtering or serialization. Original memory endpoints never expose correspondence. Only authors may edit or archive letters. Optimistic revision checks reject concurrent lost updates with HTTP 409.

Permanent deletion requires authenticated, session-scoped IDs and a literal boolean confirmation. All selected memories and vectors are deleted in one transaction, with full rollback on failure; plans and correspondence are separate. Remaining unsupported OB features return 501 rather than simulating success.

其余新版 OB 功能返回 501；不以空列表或成功响应伪装能力。永久删除执行数据库删除，不映射为归档或已解决；主动遗忘等未适配语义仍不开放。

---

## 认证端点

### GET /auth/status

返回当前认证状态。

**响应**:
```json
{
  "setup_needed": false,
  "env_locked": false,
  "authenticated": true
}
```

| 字段 | 说明 |
|------|------|
| `setup_needed` | `true` 表示尚未设置密码，需要先调用 `/auth/setup` |
| `env_locked` | `true` 表示密码由环境变量 `MEMORY_DASHBOARD_PASSWORD` 控制，不可在 UI 修改 |
| `authenticated` | 当前请求是否已认证 |

---

### POST /auth/setup

首次设置密码（仅在 `setup_needed=true` 时可用）。

**请求体**:
```json
{ "password": "your_password" }
```

**成功响应**: `200 {"ok": true}` + Set-Cookie  
**失败响应**: `400 {"error": "密码至少4位"}` 或 `400 {"error": "已配置"}`

---

### POST /auth/login

登录。

**请求体**:
```json
{ "password": "your_password" }
```

**成功响应**: `200 {"ok": true}` + Set-Cookie  
**失败响应**: `401 {"error": "密码错误"}`

---

### POST /auth/logout

登出，清除 session。

**响应**: `200 {"ok": true}` + Delete-Cookie

---

### POST /auth/change-password

修改密码（需已认证，且非 env_locked）。

**请求体**:
```json
{ "current": "old_password", "new": "new_password" }
```

**成功响应**: `200 {"ok": true}` + 新 Set-Cookie  
**失败响应**: `400 {"error": "当前密码错误或新密码太短"}` 或 `400 {"error": "密码由环境变量控制，无法在此修改"}`

---

## 健康检查

### GET /health

无需认证。

**响应**:
```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

---

## 数据 API

以下所有端点需要有效的 session cookie。

---

### GET /api/buckets

列出记忆桶，支持过滤。

**查询参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `session` | string | 按 session_id 过滤（留空返回所有 session） |
| `type` | string | 按 bucket_type 过滤：`dynamic` / `permanent` / `feel` / `archived` |
| `q` | string | 全文搜索（匹配 name / content / tags） |
| `limit` | int | 最多返回条数（默认 100） |

**响应**:
```json
{
  "total": 17,
  "buckets": [
    {
      "id": "ab12cd34ef56",
      "session_id": "conv:xxx",
      "name": "实习offer获得",
      "domain": ["成长", "求职"],
      "tags": ["实习", "offer"],
      "valence": 0.8,
      "arousal": 0.7,
      "importance": 7,
      "bucket_type": "dynamic",
      "pinned": false,
      "resolved": false,
      "digested": false,
      "activation_count": 3.0,
      "score": 4.82,
      "created_at": 1747000000.0,
      "last_active_at": 1747200000.0,
      "content_preview": "你告诉我你拿到了实习offer..."
    }
  ]
}
```

桶按 `score`（Activation_Score）降序排列。`content_preview` 截取前 200 字符。

---

### GET /api/bucket/{bucket_id}

获取单个桶的完整详情。

**响应**:
```json
{
  "id": "ab12cd34ef56",
  "session_id": "conv:xxx",
  "name": "实习offer获得",
  "content": "完整内容...",
  "domain": ["成长", "求职"],
  "tags": ["实习", "offer"],
  "valence": 0.8,
  "arousal": 0.7,
  "importance": 7,
  "bucket_type": "dynamic",
  "pinned": false,
  "resolved": false,
  "digested": false,
  "model_valence": null,
  "source_bucket_id": null,
  "activation_count": 3.0,
  "score": 4.82,
  "created_at": 1747000000.0,
  "last_active_at": 1747200000.0
}
```

**404**: `{"error": "未找到"}`

---

### PATCH /api/bucket/{bucket_id}

更新桶的元数据。通过 `MemoryManager.update` 执行，自动应用 clamp 规则。

**请求体**（只传需要修改的字段）:
```json
{
  "name": "新名称",
  "content": "新内容",
  "domain": ["新主题"],
  "tags": ["tag1", "tag2"],
  "valence": 0.7,
  "arousal": 0.5,
  "importance": 8,
  "pinned": true,
  "resolved": false,
  "digested": false
}
```

**可更新字段**: `name`, `content`, `domain`, `tags`, `valence`, `arousal`, `importance`, `pinned`, `resolved`, `digested`

**业务规则**:
- `valence` / `arousal` 自动 clamp 到 [0.0, 1.0]
- `importance` 自动 clamp 到 [1, 10]
- `pinned=true` 会自动设置 `importance=10` 和 `bucket_type="permanent"`
- 修改 `content` 时会自动刷新 embedding 向量

**成功响应**: `200 {"ok": true, "id": "ab12cd34ef56"}`  
**失败响应**: `404 {"error": "未找到"}` / `400 {"error": "无更新字段"}` / `500 {"error": "更新失败"}`

---

### DELETE /api/bucket/{bucket_id}

永久删除一个桶及其 embedding。

**成功响应**: `200 {"ok": true}`  
**失败响应**: `404 {"error": "未找到"}` / `500 {"error": "删除失败"}`

---

### GET /api/stats

全局统计信息。

**响应**:
```json
{
  "sessions": 3,
  "counts": {
    "dynamic": 15,
    "permanent": 2,
    "feel": 5,
    "archived": 8
  },
  "total": 30,
  "today_new": 2,
  "week_new": 9,
  "max_activation": 4.3,
  "decay_engine": "运行中",
  "embedding": "已启用"
}
```

| 字段 | 说明 |
|------|------|
| `sessions` | 不同 session_id 的数量 |
| `counts` | 按 bucket_type 分类的桶数量 |
| `total` | 所有桶总数 |
| `today_new` | 今日新增桶数 |
| `week_new` | 近 7 天新增桶数 |
| `max_activation` | 当前全局最高 activation_count |
| `decay_engine` | `"运行中"` / `"已停止"` |
| `embedding` | `"已启用"` / `"未启用"` |

---

### GET /api/search

双通道搜索（关键词 + 向量）。

**查询参数**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `q` | string | **必填**，搜索关键词 |
| `session` | string | 指定 session_id（留空使用第一个可用 session） |

**响应**:
```json
{
  "results": [
    {
      "id": "ab12cd34ef56",
      "name": "实习offer获得",
      "score": 72.5,
      "via": "both",
      "domain": ["成长", "求职"],
      "content_preview": "你告诉我你拿到了实习offer...",
      "importance": 7,
      "resolved": false,
      "pinned": false
    }
  ]
}
```

| `via` 值 | 含义 |
|-----------|------|
| `"keyword"` | 仅通过关键词匹配命中 |
| `"vector"` | 仅通过向量相似度命中 |
| `"both"` | 两个通道都命中 |

---

## 前端页面

### GET /

重定向到 `/dashboard`。

### GET /dashboard

返回单页 HTML 前端。

### GET /static/{filename}

静态资源（CSS / JS）。当前文件：
- `style.css` — 暗色调样式
- `app.js` — 前端逻辑（vanilla JS）

---

## 数据模型参考

### MemoryBucket 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 12 位 hex，UUID4 前 12 字符 |
| `session_id` | string | 隔离键，格式取决于 scope_mode |
| `name` | string | 记忆名称（≤80 字符） |
| `content` | string | 记忆正文 |
| `domain` | string[] | 主题域标签（1-2 个） |
| `tags` | string[] | 关键词标签（5-10 个） |
| `valence` | float | Russell 效价 [0.0, 1.0]，0=极负 1=极正 |
| `arousal` | float | Russell 唤醒度 [0.0, 1.0]，0=平静 1=激动 |
| `importance` | int | 重要度 [1, 10] |
| `bucket_type` | string | `dynamic` / `permanent` / `feel` / `archived` |
| `pinned` | bool | 钉选（永不衰减，importance 锁 10） |
| `resolved` | bool | 已解决（权重 ×0.05，不主动浮现） |
| `digested` | bool | 已消化（写过 feel，权重 ×0.02） |
| `model_valence` | float? | 模型对此记忆的主观效价 |
| `source_bucket_id` | string? | feel 桶指向的源事件桶 id |
| `activation_count` | float | 被召回次数（含 time_ripple 的小数增量） |
| `score` | float | 当前 Activation_Score（由 API 计算返回） |
| `created_at` | float | 创建时间（Unix 时间戳） |
| `last_active_at` | float | 最后激活时间（Unix 时间戳） |

### bucket_type 含义

| 类型 | 说明 |
|------|------|
| `dynamic` | 普通记忆，参与衰减 |
| `permanent` | 钉选/核心准则，永不衰减 |
| `feel` | 模型感受，永不衰减，不参与普通浮现 |
| `archived` | 已归档（衰减分低于阈值），不参与搜索和浮现 |
