"""新版 OB 界面的独立适配层，不改变原仪表盘 API 和插件记忆模型。"""

from __future__ import annotations

import itertools
import logging
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from starlette.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.routing import Route

from ..core.decay_engine import calculate_score
from ..core.models import VALID_BUCKET_TYPES
from ..core.plans_letters import DomainConflict, PlansLetters

logger = logging.getLogger(__name__)
PLUGIN_VERSION = "1.3.0"
STATIC_DIR = Path(__file__).parent / "static" / "ob"


def _iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat() if value else ""


def bucket_payload(bucket):
    """SQLite 记录转为 OB 列表和详情使用的形状；读取不触发激活。"""
    return {
        "id": bucket.id,
        "session_id": bucket.session_id,
        "name": bucket.name,
        "title": bucket.name,
        "type": bucket.bucket_type,
        "domain": bucket.domain,
        "tags": bucket.tags,
        "content": bucket.content,
        "content_preview": bucket.content[:200],
        "valence": bucket.valence,
        "arousal": bucket.arousal,
        "model_valence": bucket.model_valence,
        "importance": bucket.importance,
        "pinned": bucket.pinned,
        "resolved": bucket.resolved,
        "digested": bucket.digested,
        "dont_surface": bucket.digested,
        "triggered_by": bucket.source_bucket_id,
        "activation_count": bucket.activation_count,
        "created": _iso(bucket.created_at),
        "last_active": _iso(bucket.last_active_at),
        "created_epoch_ms": bucket.created_at * 1000,
        "last_active_epoch_ms": bucket.last_active_at * 1000,
        "score": round(calculate_score(bucket), 4),
    }


class ObDashboard:
    def __init__(self, server, require_auth):
        self.server = server
        self.plugin = server.plugin
        self.require_auth = require_auth
        self.started_at = time.time()

    def routes(self):
        return [
            Route("/ob", self.page, methods=["GET"]),
            Route("/ob/", self.page, methods=["GET"]),
            Route("/ob/static/{filename}", self.static, methods=["GET"]),
            Route(
                "/ob/api/{endpoint:path}",
                self.api,
                methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            ),
        ]

    async def page(self, request):
        return HTMLResponse(
            (STATIC_DIR / "dashboard.html").read_text(encoding="utf-8"),
            headers={"Cache-Control": "no-store"},
        )

    async def static(self, request):
        filename = request.path_params["filename"]
        allowed = {
            "adapter.js",
            "adapter.css",
            "lucide.min.js",
            "domain-ui.js",
            "explorer.js",
            "galaxy.html",
            "galaxy.css",
            "galaxy-host.js",
            "galaxy.js",
            "galaxy-engine.js",
            "brand-icon.png",
            "companion-idle.png",
            "companion-idle.webp",
            "companion-lifted.png",
            "favicon.svg",
            "icon.svg",
            "RRPL.ttf",
            "manifest.json",
        }
        if filename not in allowed:
            return JSONResponse({"error": "未找到资源"}, status_code=404)
        return FileResponse(
            STATIC_DIR / filename, headers={"Cache-Control": "no-cache"}
        )

    async def session(self, request):
        configured = str(
            self.plugin.config.get("dashboard_session_id", "") or ""
        ).strip()
        sessions = await self.plugin.manager.list_sessions_with_meta()
        requested = request.query_params.get("session", "").strip()
        if configured:
            if requested and requested != configured:
                raise ValueError("仪表盘已锁定到配置指定的会话")
            return configured
        if requested:
            if requested not in {s["session_id"] for s in sessions}:
                raise ValueError("该会话不存在，请刷新会话列表")
            return requested
        return sessions[0]["session_id"] if sessions else None

    async def buckets(self, session):
        if not session:
            return []
        return await self.plugin.manager.list_by_session(session, include_archived=True)

    async def api(self, request):
        error = self.require_auth(request)
        if error is not None:
            return error
        endpoint = request.path_params["endpoint"]
        method = request.method
        # 明确拒绝尚未实现的功能，不能把空结果伪装成支持。
        if endpoint == "capabilities" and method == "GET":
            return JSONResponse(
                {
                    "version": PLUGIN_VERSION,
                    "supported": [
                        "buckets",
                        "search",
                        "edit",
                        "pin",
                        "resolve",
                        "archive",
                        "network",
                        "appearance",
                        "plans",
                        "letters",
                        "permanent-delete",
                    ],
                    "unsupported": [
                        "breath",
                        "anchors",
                        "import",
                        "logs",
                        "self",
                        "forget",
                    ],
                }
            )
        if self.plugin.manager is None:
            return JSONResponse({"error": "记忆插件尚未初始化"}, status_code=503)
        try:
            session = await self.session(request)
            if endpoint in {"plans", "letters", "letter"} or endpoint.startswith(
                ("plans/", "letter/")
            ):
                return await self.domain_api(request, session or "dashboard")
            if endpoint == "sessions" and method == "GET":
                configured = str(
                    self.plugin.config.get("dashboard_session_id", "") or ""
                ).strip()
                rows = await self.plugin.manager.list_sessions_with_meta()
                if configured:
                    rows = [row for row in rows if row["session_id"] == configured]
                    if not rows:
                        rows = [
                            {
                                "session_id": configured,
                                "memory_count": 0,
                                "last_active_at": 0,
                            }
                        ]
                return JSONResponse(
                    {"sessions": rows, "current": session, "locked": bool(configured)}
                )
            if endpoint == "version" and method == "GET":
                return JSONResponse(
                    {"version": PLUGIN_VERSION, "source_frontend": "OB 3.7.0"}
                )
            if endpoint == "config" and method == "GET":
                # 不向新界面复制 API 密钥；Provider 继续由 AstrBot 配置管理。
                return JSONResponse(
                    {
                        "embedding": {
                            "enabled": bool(
                                self.plugin.embedding and self.plugin.embedding.enabled
                            )
                        },
                        "provider_id": str(
                            self.plugin.config.get("embedding_provider_id", "") or ""
                        ),
                        "tagging_enabled": bool(
                            self.plugin.config.get("tagging_enabled", True)
                        ),
                        "scope_mode": str(
                            self.plugin.config.get("scope_mode", "conversation")
                        ),
                    }
                )
            if endpoint == "heartbeat" and method == "GET":
                return JSONResponse(
                    {
                        "uptime_s": int(time.time() - self.started_at),
                        "last_op_ts": time.time(),
                        "decay_engine": "running"
                        if self.plugin.decay and self.plugin.decay.is_running
                        else "stopped",
                    }
                )
            if endpoint == "buckets" and method == "GET":
                rows = [bucket_payload(b) for b in await self.buckets(session)]
                sort = request.query_params.get("sort", "score")
                if sort not in {"score", "created_desc", "created_asc"}:
                    raise ValueError("不支持的排序方式")
                key = "score" if sort == "score" else "created_epoch_ms"
                rows.sort(
                    key=lambda b: (b[key], b["id"]), reverse=sort != "created_asc"
                )
                return JSONResponse(rows)
            if endpoint == "search" and method == "GET":
                query = request.query_params.get("q", "").strip()
                if not query or not session:
                    return JSONResponse([])
                if self.plugin.search is not None:
                    hits = await self.plugin.search.search(
                        session, query, limit=100, include_archived=True
                    )
                    return JSONResponse([bucket_payload(hit.bucket) for hit in hits])
                rows = [
                    bucket_payload(b)
                    for b in await self.buckets(session)
                    if query.casefold()
                    in " ".join([b.name, b.content, *b.tags, *b.domain]).casefold()
                ]
                return JSONResponse(rows)
            if endpoint == "network" and method == "GET":
                if request.query_params.get("mode", "concept") != "concept":
                    return JSONResponse(
                        {"error": "插件版暂不提供向量投影网络，请使用概念网络"},
                        status_code=501,
                    )
                return JSONResponse(await self.network(session))
            if endpoint == "buckets/batch" and method == "POST":
                return await self.batch(request, session)
            if endpoint == "buckets/forget" and method == "POST":
                return await self.batch_forget(request, session)
            if endpoint == "buckets/permanent-delete" and method == "POST":
                return await self.permanent_delete(request, session)
            match = re.fullmatch(
                r"bucket/([^/]+)(?:/(edit|pin|resolve|archive|forget))?", endpoint
            )
            if match:
                bucket_id, action = match.groups()
                bucket = (
                    await self.plugin.manager.get(session, bucket_id)
                    if session
                    else None
                )
                if bucket is None:
                    return JSONResponse(
                        {"error": "当前会话中未找到该记忆"}, status_code=404
                    )
                if method == "GET" and action is None:
                    payload = bucket_payload(bucket)
                    related = [
                        b
                        for b in await self.buckets(session)
                        if b.source_bucket_id == bucket_id
                    ]
                    return JSONResponse(
                        {
                            "id": bucket_id,
                            "content": bucket.content,
                            "display_content": bucket.content,
                            "score": payload["score"],
                            "metadata": payload,
                            "triggered_feels": [
                                {"id": b.id, "name": b.name} for b in related
                            ],
                        }
                    )
                if (method, action) in {
                    ("PATCH", "edit"),
                    ("POST", "pin"),
                    ("POST", "resolve"),
                    ("POST", "archive"),
                    ("POST", "forget"),
                }:
                    return await self.update(request, session, bucket, action)
            return JSONResponse(
                {
                    "error": "此功能尚未在 AstrBot 插件中实现，请切换原界面使用插件已有功能。"
                },
                status_code=501,
            )
        except DomainConflict as exc:
            return JSONResponse({"error": str(exc)}, status_code=409)
        except PermissionError as exc:
            return JSONResponse({"error": str(exc)}, status_code=403)
        except LookupError as exc:
            return JSONResponse({"error": str(exc)}, status_code=404)
        except (ValueError, TypeError, OverflowError) as exc:
            return JSONResponse({"error": str(exc) or "请求参数无效"}, status_code=400)

    async def domain_api(self, request, session):
        """Route persistent plans and letters for the authenticated human side.

        Args:
            request: The already authenticated dashboard request.
            session: The validated or initial dashboard session.

        Returns:
            A domain response with author-enforced letter visibility.
        """
        store = getattr(self.plugin, "correspondence", None)
        if not isinstance(store, PlansLetters):
            store = PlansLetters(self.plugin.manager.db)
            self.plugin.correspondence = store
        endpoint, method = request.path_params["endpoint"], request.method
        if endpoint == "plans" and method == "GET":
            groups = {"active": [], "resolved": [], "abandoned": []}
            for plan in await store.plans(session):
                groups[plan["status"]].append(plan)
            return JSONResponse({**groups, "total": sum(map(len, groups.values()))})
        if endpoint == "plans" and method == "POST":
            body = await request.json()
            if not isinstance(body, dict) or set(body) - {"content", "name", "weight"}:
                raise ValueError("计划只支持 content、name、weight 字段")
            plan = await store.create_plan(
                session,
                body.get("content"),
                name=body.get("name", ""),
                weight=body.get("weight", 0.5),
            )
            return JSONResponse(
                {"ok": True, "id": plan["id"], "plan": plan}, status_code=201
            )
        match = re.fullmatch(r"plans/([^/]+)/action", endpoint)
        if match and method == "POST":
            body = await request.json()
            if not isinstance(body, dict) or set(body) - {
                "action",
                "content",
                "name",
                "weight",
            }:
                raise ValueError("计划操作字段无效")
            plan = await store.change_plan(
                session,
                match[1],
                body.get("action"),
                content=body.get("content"),
                name=body.get("name"),
                weight=body.get("weight"),
            )
            return JSONResponse({"ok": True, "plan": plan})
        if endpoint == "letters" and method == "GET":
            letters = await store.letters(
                session,
                actor="human",
                author=request.query_params.get("author", ""),
                query=request.query_params.get("q", ""),
            )
            return JSONResponse({"letters": letters, "total": len(letters)})
        if endpoint == "letter" and method == "POST":
            body = await request.json()
            allowed = {
                "content",
                "title",
                "date",
                "user_name",
                "author",
                "lock_type",
                "unlock_date",
            }
            if not isinstance(body, dict) or set(body) - allowed:
                raise ValueError("写信字段无效")
            if body.get("author", "user") != "user":
                raise PermissionError("网页只能以用户身份写信；AI 的信由模型工具写入")
            letter = await store.write_letter(
                session,
                body.get("content"),
                actor="human",
                writer_name=body.get("user_name", ""),
                title=body.get("title", ""),
                letter_date=body.get("date", ""),
                lock_type=body.get("lock_type", "none"),
                unlock_date=body.get("unlock_date"),
            )
            return JSONResponse(
                {"ok": True, "id": letter["id"], "letter": letter}, status_code=201
            )
        match = re.fullmatch(r"letter/([^/]+)", endpoint)
        if match and method == "GET":
            return JSONResponse(
                await store.read_letter(session, match[1], actor="human")
            )
        if match and method in {"PATCH", "DELETE"}:
            body = {} if method == "DELETE" else await request.json()
            result = await store.change_letter(
                session, match[1], body, actor="human", archive=method == "DELETE"
            )
            return JSONResponse({"ok": True, **result})
        return JSONResponse({"error": "不支持的计划或信件操作"}, status_code=405)

    async def permanent_delete(self, request, session):
        """Delete confirmed ordinary memories atomically within one session.

        Args:
            request: The authenticated request containing IDs and confirmation.
            session: The validated dashboard session.

        Returns:
            A response listing the permanently deleted memory IDs.

        Raises:
            ValueError: Confirmation, IDs, or session ownership are invalid.
        """
        body = await request.json()
        if not isinstance(body, dict) or body.get("confirm") is not True:
            raise ValueError("请确认后再永久删除记忆")
        ids = body.get("ids")
        if (
            not isinstance(ids, list)
            or not 1 <= len(ids) <= 100
            or any(not isinstance(item, str) or not item.strip() for item in ids)
        ):
            raise ValueError("每次选择 1–100 条记忆")
        ids = list(dict.fromkeys(ids))
        db = self.plugin.manager.db
        async with db.transaction() as connection:
            for bucket_id in ids:
                bucket = await db.fetch_one(
                    "SELECT id FROM memories WHERE id=? AND session_id=?",
                    (bucket_id, session),
                )
                if bucket is None:
                    raise ValueError("所选记忆不属于当前会话或已不存在，请刷新后重试")
            await connection.executemany(
                "DELETE FROM memories WHERE id=? AND session_id=?",
                [(bucket_id, session) for bucket_id in ids],
            )
            # Keep the same defensive vector cleanup as MemoryManager.delete.
            await connection.executemany(
                "DELETE FROM embeddings WHERE bucket_id=?",
                [(bucket_id,) for bucket_id in ids],
            )
        return JSONResponse({"ok": True, "deleted": ids})

    async def batch(self, request, session):
        body = await request.json()
        if not isinstance(body, dict):
            raise TypeError("请求必须是 JSON 对象")
        ids, action = body.get("ids"), body.get("action")
        if action not in {"resolve", "archive"}:
            raise ValueError("插件版批量操作仅支持沉底和归档")
        if (
            not isinstance(ids, list)
            or not 1 <= len(ids) <= 100
            or any(not isinstance(i, str) or not i for i in ids)
        ):
            raise ValueError("每次选择 1–100 条记忆")
        ids = list(dict.fromkeys(ids))
        # 写入前核对所有目标，防止混入别的会话后只修改一半。
        for bucket_id in ids:
            bucket = (
                await self.plugin.manager.get(session, bucket_id) if session else None
            )
            if bucket is None:
                raise ValueError("所选记忆不属于当前会话或已不存在")
            if action == "archive" and bucket.pinned:
                raise ValueError("所选记忆中有钉选项，请先解除钉选")
        fields = (
            {"resolved": True} if action == "resolve" else {"bucket_type": "archived"}
        )
        async with self.plugin.manager.db.transaction():
            for bucket_id in ids:
                if (
                    await self.plugin.manager.update(session, bucket_id, **fields)
                    is None
                ):
                    raise ValueError("记忆在操作过程中已不存在，请刷新后重试")
        return JSONResponse({"ok": True, "updated": ids})

    async def batch_forget(self, request, session):
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("请求必须是 JSON 对象")
        ids = body.get("ids")
        if (
            not isinstance(ids, list)
            or not 1 <= len(ids) <= 100
            or any(not isinstance(i, str) or not i for i in ids)
        ):
            raise ValueError("每次选择 1–100 条记忆")
        dont_surface = bool(body.get("dont_surface", True))
        ids = list(dict.fromkeys(ids))
        for bucket_id in ids:
            bucket = (
                await self.plugin.manager.get(session, bucket_id) if session else None
            )
            if bucket is None:
                raise ValueError("所选记忆不属于当前会话或已不存在")
        async with self.plugin.manager.db.transaction():
            for bucket_id in ids:
                if (
                    await self.plugin.manager.update(
                        session, bucket_id, digested=dont_surface
                    )
                    is None
                ):
                    raise ValueError("记忆在操作过程中已不存在，请刷新后重试")
        return JSONResponse({"ok": True, "updated": ids})

    async def update(self, request, session, bucket, action):
        fields = {}
        if action == "pin":
            fields = {"pinned": not bucket.pinned}
            if bucket.pinned:
                body = await request.json()
                if not isinstance(body, dict):
                    raise ValueError("请求必须是 JSON 对象")
                importance = body.get("importance", 5)
                if (
                    isinstance(importance, bool)
                    or not isinstance(importance, int)
                    or not 1 <= importance <= 10
                ):
                    raise ValueError("重要度必须为 1–10 的整数")
                fields.update(
                    importance=importance,
                    bucket_type="dynamic"
                    if bucket.bucket_type == "permanent"
                    else bucket.bucket_type,
                )
        elif action == "resolve":
            fields = {"resolved": not bucket.resolved}
        elif action == "archive":
            if bucket.pinned:
                raise ValueError("请先解除钉选，再归档记忆")
            fields = {"bucket_type": "archived"}
        elif action == "forget":
            fields = {"digested": not bucket.digested}
        else:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError("请求必须是 JSON 对象")
            unknown = set(body) - {
                "name",
                "title",
                "content",
                "domain",
                "tags",
                "importance",
                "resolved",
                "pinned",
                "digested",
                "type",
            }
            if unknown:
                raise ValueError("插件暂不支持这些字段：" + ", ".join(sorted(unknown)))
            for key in ("name", "content"):
                if key in body:
                    if not isinstance(body[key], str) or not body[key].strip():
                        raise ValueError("名称和正文不能为空")
                    fields[key] = body[key]
            if "title" in body:
                if not isinstance(body["title"], str) or not body["title"].strip():
                    raise ValueError("标题不能为空")
                fields["name"] = body["title"].strip()
            for key in ("pinned", "resolved", "digested"):
                if key in body:
                    if not isinstance(body[key], bool):
                        raise ValueError(key + " 必须为布尔值")
                    fields[key] = body[key]
            if "importance" in body:
                value = body["importance"]
                if (
                    isinstance(value, bool)
                    or not isinstance(value, int)
                    or not 1 <= value <= 10
                ):
                    raise ValueError("重要度必须为 1–10 的整数")
                fields["importance"] = value
            for key in ("domain", "tags"):
                if key in body:
                    raw = body[key]
                    if isinstance(raw, str):
                        raw = re.split(r"[,，]", raw)
                    if not isinstance(raw, list) or any(
                        not isinstance(item, str) for item in raw
                    ):
                        raise ValueError(key + " 必须为文本列表")
                    fields[key] = list(
                        dict.fromkeys(item.strip() for item in raw if item.strip())
                    )
            if "type" in body:
                if body["type"] not in VALID_BUCKET_TYPES:
                    raise ValueError("插件不支持该记忆类型")
                fields["bucket_type"] = body["type"]
            if not fields:
                raise ValueError("没有可更新的字段")
            if (
                bucket.pinned
                and fields.get("pinned") is False
                and "bucket_type" not in fields
            ):
                fields["bucket_type"] = (
                    "dynamic"
                    if bucket.bucket_type == "permanent"
                    else bucket.bucket_type
                )
        updated = await self.plugin.manager.update(session, bucket.id, **fields)
        if updated is None:
            return JSONResponse({"error": "记忆已不存在"}, status_code=404)
        warnings = []
        if (
            "content" in fields
            and self.plugin.embedding is not None
            and self.plugin.embedding.enabled
        ):
            try:
                await self.plugin.embedding.generate_and_store(
                    bucket.id, updated.content
                )
            except Exception:
                logger.exception("OB 界面保存正文后的向量更新失败")
                warnings.append("正文已保存，向量更新失败，请在原界面补建向量。")
        return JSONResponse(
            {"ok": True, "updated": sorted(fields), "warnings": warnings}
        )

    async def network(self, session):
        nodes = {}
        edges = Counter()
        for bucket in await self.buckets(session):
            concepts = set(
                bucket.tags
                + bucket.domain
                + re.findall(r"\[\[([^\[\]\n]+)\]\]", bucket.content)
            )
            concepts = sorted(c.strip() for c in concepts if c.strip())[:30]
            for concept in concepts:
                node = nodes.setdefault(
                    concept, {"id": concept, "label": concept, "kind": "tag", "freq": 0}
                )
                node["freq"] += 1
            edges.update(itertools.combinations(concepts, 2))
        # 限制图规模，保证历史记忆很多时画布仍可交互。
        visible = sorted(nodes.values(), key=lambda n: (-n["freq"], n["id"]))[:150]
        ids = {node["id"] for node in visible}
        return {
            "nodes": visible,
            "edges": [
                {"source": a, "target": b, "weight": count}
                for (a, b), count in edges.items()
                if a in ids and b in ids
            ],
        }
