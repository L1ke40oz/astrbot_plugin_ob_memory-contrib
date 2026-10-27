"""Persistent plans and correspondence, isolated from ordinary memory recall."""

from __future__ import annotations

import json
import math
import sqlite3
import time
import uuid
from datetime import date, datetime, timezone

from ..storage.db import Database

MAX_CONTENT = 65536


class DomainConflict(ValueError):
    """An optimistic update conflicted with a newer revision."""


def _text(value, name, *, required=False, maximum=MAX_CONTENT):
    if not isinstance(value, str) or len(value.encode("utf-8")) > maximum:
        raise ValueError(f"{name} 必须为文本，最多 {maximum} 字节")
    if required and not value.strip():
        raise ValueError(f"{name} 不能为空")
    return value


def _iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


class PlansLetters:
    """Persist dedicated domains without adding them to the decay/search pool.

    Args:
        db: The plugin database after schema migrations have completed.
    """

    def __init__(self, db: Database):
        self.db = db

    async def plans(self, session, *, status=""):
        """List plans within one session, preserving the complete change history.

        Args:
            session: Trusted session identifier from the caller's context.
            status: Optional lifecycle state filter.

        Returns:
            Plans sorted by commitment weight and update time.
        """
        if status and status not in {"active", "resolved", "abandoned"}:
            raise ValueError("未知计划状态")
        rows = await self.db.fetch_all(
            "SELECT * FROM memory_plans WHERE session_id=? "
            + ("AND status=? " if status else "")
            + "ORDER BY weight DESC, updated_at DESC, id",
            (session, status) if status else (session,),
        )
        return [
            dict(
                row,
                change_log=json.loads(row["change_log"]),
                created_at=_iso(row["created_at"]),
                updated_at=_iso(row["updated_at"]),
            )
            for row in rows
        ]

    async def create_plan(
        self, session, content, *, name="", weight=0.5, actor="human"
    ):
        """Create an active plan, deduplicating identical active content.

        Args:
            session: Trusted session identifier.
            content: The full commitment text.
            name: Optional display title.
            weight: Commitment weight from zero to one.
            actor: Trusted actor for the audit history.

        Returns:
            The new or already existing active plan.
        """
        content = _text(content, "计划正文", required=True).strip()
        name = _text(name, "计划名称", maximum=480).strip() or content[:40]
        weight = self._weight(weight)
        now, plan_id = time.time(), uuid.uuid4().hex[:16]
        history = [{"ts": _iso(now), "action": "created", "to": "active", "by": actor}]
        await self.db.execute(
            "INSERT OR IGNORE INTO memory_plans "
            "(id,session_id,name,content,weight,change_log,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
            (
                plan_id,
                session,
                name,
                content,
                weight,
                json.dumps(history, ensure_ascii=False),
                now,
                now,
            ),
        )
        return next(
            p
            for p in await self.plans(session, status="active")
            if p["content"] == content
        )

    @staticmethod
    def _weight(value):
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or not 0 <= value <= 1
        ):
            raise ValueError("计划重量须为 0–1 的数字")
        return float(value)

    async def change_plan(
        self,
        session,
        plan_id,
        action,
        *,
        actor="human",
        content=None,
        name=None,
        weight=None,
    ):
        """Apply a plan transition or edit using an optimistic revision check.

        Args:
            session: Trusted session identifier.
            plan_id: Plan identifier scoped to this session.
            action: resolve, abandon, reopen, or edit.
            actor: Trusted actor recorded in history.
            content: Replacement text for edits.
            name: Optional replacement title.
            weight: Optional replacement weight.

        Returns:
            The updated plan.

        Raises:
            LookupError: The plan is absent from this session.
            DomainConflict: Another request updated the same plan first.
        """
        row = await self.db.fetch_one(
            "SELECT * FROM memory_plans WHERE session_id=? AND id=?", (session, plan_id)
        )
        if row is None:
            raise LookupError("当前会话未找到该计划")
        before = dict(row)
        after = dict(before)
        history = json.loads(before["change_log"])
        now = time.time()
        if action in {"resolve", "abandon", "reopen"}:
            target = {
                "resolve": "resolved",
                "abandon": "abandoned",
                "reopen": "active",
            }[action]
            if target == before["status"]:
                return next(p for p in await self.plans(session) if p["id"] == plan_id)
            after["status"] = target
            history.append(
                {
                    "ts": _iso(now),
                    "action": "status",
                    "from": before["status"],
                    "to": target,
                    "by": actor,
                }
            )
        elif action == "edit":
            if content is not None:
                after["content"] = _text(content, "计划正文", required=True)
            if name is not None:
                after["name"] = _text(name, "计划名称", required=True, maximum=480)
            if weight is not None:
                after["weight"] = self._weight(weight)
            changes = {
                key: {"from": before[key], "to": after[key]}
                for key in ("name", "content", "weight")
                if before[key] != after[key]
            }
            if not changes:
                return next(p for p in await self.plans(session) if p["id"] == plan_id)
            history.append(
                {"ts": _iso(now), "action": "edit", "by": actor, "changes": changes}
            )
        else:
            raise ValueError("不支持的计划操作")
        try:
            cursor = await self.db.execute(
                "UPDATE memory_plans SET name=?,content=?,weight=?,status=?,change_log=?,updated_at=?,revision=revision+1 "
                "WHERE session_id=? AND id=? AND revision=?",
                (
                    after["name"],
                    after["content"],
                    after["weight"],
                    after["status"],
                    json.dumps(history, ensure_ascii=False),
                    now,
                    session,
                    plan_id,
                    before["revision"],
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise DomainConflict("已有相同正文的进行中计划，请先处理重复项") from exc
        if cursor.rowcount != 1:
            raise DomainConflict("计划已被其他请求修改，请刷新后重试")
        return next(p for p in await self.plans(session) if p["id"] == plan_id)

    @staticmethod
    def _lock(lock_type, unlock_date):
        if lock_type not in {"none", "timed", "permanent"}:
            raise ValueError("锁类型须为 none、timed 或 permanent")
        if lock_type != "timed":
            return lock_type, None
        if not isinstance(unlock_date, str):
            raise ValueError("定时锁需要带时区的解锁时间")
        try:
            parsed = datetime.fromisoformat(unlock_date.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("解锁时间须为带时区的 ISO 8601 时间") from exc
        if (
            parsed.tzinfo is None
            or parsed.utcoffset() is None
            or parsed.timestamp() <= time.time()
        ):
            raise ValueError("解锁时间须带时区并且晚于当前时间")
        return lock_type, parsed.timestamp()

    @staticmethod
    def _letter(row, actor):
        owner = row["author_side"] == actor
        expired = (
            row["lock_type"] == "timed"
            and row["unlock_at"] is not None
            and row["unlock_at"] <= time.time()
        )
        lock_type = "none" if expired else row["lock_type"]
        locked = lock_type != "none" and not owner
        # Redact before any caller-side filtering or serialization.
        payload = {
            "id": row["id"],
            "author": "user" if row["author_side"] == "human" else "ai",
            "writer_name": row["writer_name"],
            "date": row["letter_date"],
            "lock_type": lock_type,
            "locked": locked,
            "lock_owner": owner,
            "unlock_date": _iso(row["unlock_at"]) if lock_type == "timed" else None,
            "created_at": _iso(row["created_at"]),
            "revision": row["revision"],
        }
        if not locked:
            payload.update(title=row["title"], content=row["content"])
        return payload

    async def write_letter(
        self,
        session,
        content,
        *,
        actor,
        writer_name="",
        title="",
        letter_date="",
        lock_type="none",
        unlock_date=None,
    ):
        """Store an uncompressed letter; only the trusted caller owns its lock.

        Args:
            session: Trusted session identifier.
            content: Full original text, never merged or summarized.
            actor: human for dashboard calls, ai for model tool calls.
            writer_name: Optional signature.
            title: Optional letter title.
            letter_date: Optional ISO date.
            lock_type: none, timed, or permanent.
            unlock_date: Future timezone-aware ISO datetime for timed locks.

        Returns:
            The author's readable letter payload.
        """
        if actor not in {"human", "ai"}:
            raise ValueError("未知写信身份")
        content = _text(content, "信件正文", required=True)
        title = _text(title, "信件标题", maximum=480)
        writer_name = _text(writer_name, "署名", maximum=240).strip() or (
            "我" if actor == "human" else "AI"
        )
        if not isinstance(letter_date, str):
            raise ValueError("日期须为 YYYY-MM-DD")
        letter_date = (
            date.fromisoformat(letter_date).isoformat()
            if letter_date
            else datetime.now(timezone.utc).date().isoformat()
        )
        lock_type, unlock_at = self._lock(lock_type, unlock_date)
        now, letter_id = time.time(), uuid.uuid4().hex[:16]
        await self.db.execute(
            "INSERT INTO memory_letters (id,session_id,author_side,writer_name,title,content,letter_date,lock_type,unlock_at,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                letter_id,
                session,
                actor,
                writer_name,
                title,
                content,
                letter_date,
                lock_type,
                unlock_at,
                now,
                now,
            ),
        )
        return await self.read_letter(session, letter_id, actor=actor)

    async def read_letter(self, session, letter_id, *, actor):
        """Read a letter with the same redaction policy used by list endpoints.

        Args:
            session: Trusted session identifier.
            letter_id: Letter identifier.
            actor: Trusted reader side.

        Returns:
            A readable or redacted payload.
        """
        row = await self.db.fetch_one(
            "SELECT * FROM memory_letters WHERE session_id=? AND id=? AND archived=0",
            (session, letter_id),
        )
        if row is None:
            raise LookupError("当前会话未找到该信件")
        return self._letter(row, actor)

    async def letters(self, session, *, actor, author="", query=""):
        """List letters, filtering only after inaccessible content is redacted.

        Args:
            session: Trusted session identifier.
            actor: Trusted reader side.
            author: Optional user/ai or signature filter.
            query: Optional search over information available to this reader.

        Returns:
            Letter payloads, newest first.
        """
        _text(query, "查询", maximum=1000)
        rows = await self.db.fetch_all(
            "SELECT * FROM memory_letters WHERE session_id=? AND archived=0 ORDER BY created_at DESC,id",
            (session,),
        )
        payloads = [self._letter(row, actor) for row in rows]
        return [
            p
            for p in payloads
            if (not author or author in {p["author"], p["writer_name"]})
            and (
                not query
                or query.casefold()
                in " ".join(
                    str(p.get(k, "")) for k in ("title", "content", "writer_name")
                ).casefold()
            )
        ]

    async def change_letter(self, session, letter_id, body, *, actor, archive=False):
        """Allow only the author to edit, change visibility, or archive a letter.

        Args:
            session: Trusted session identifier.
            letter_id: Letter identifier.
            body: Explicitly allowed replacement fields.
            actor: Trusted caller side; never taken from request data.
            archive: Preserve the text while removing it from the timeline.

        Returns:
            A successful archive result or updated letter payload.

        Raises:
            PermissionError: The caller is not the author.
            DomainConflict: Another request changed the same letter first.
        """
        if not isinstance(body, dict):
            raise TypeError("请求必须是 JSON 对象")
        unknown = set(body) - {"content", "title", "date", "lock_type", "unlock_date"}
        if unknown:
            raise ValueError("不支持的信件字段：" + ", ".join(sorted(unknown)))
        row = await self.db.fetch_one(
            "SELECT * FROM memory_letters WHERE session_id=? AND id=? AND archived=0",
            (session, letter_id),
        )
        if row is None:
            raise LookupError("当前会话未找到该信件")
        if row["author_side"] != actor:
            raise PermissionError("只有写信的一方可以修改原文、管理锁或归档")
        after = dict(row)
        for key in ("content", "title"):
            if key in body:
                after[key] = _text(
                    body[key],
                    "信件" + key,
                    required=key == "content",
                    maximum=MAX_CONTENT if key == "content" else 480,
                )
        if "date" in body:
            after["letter_date"] = date.fromisoformat(
                _text(body["date"], "日期", maximum=10)
            ).isoformat()
        if "unlock_date" in body and "lock_type" not in body:
            raise ValueError("修改解锁时间时必须同时提供 lock_type")
        if "lock_type" in body:
            after["lock_type"], after["unlock_at"] = self._lock(
                body["lock_type"], body.get("unlock_date")
            )
        cursor = await self.db.execute(
            "UPDATE memory_letters SET content=?,title=?,letter_date=?,lock_type=?,unlock_at=?,archived=?,updated_at=?,revision=revision+1 "
            "WHERE session_id=? AND id=? AND revision=?",
            (
                after["content"],
                after["title"],
                after["letter_date"],
                after["lock_type"],
                after["unlock_at"],
                int(archive),
                time.time(),
                session,
                letter_id,
                row["revision"],
            ),
        )
        if cursor.rowcount != 1:
            raise DomainConflict("信件已被其他请求修改，请刷新后重试")
        return (
            {"ok": True, "archived": True, "deleted": False}
            if archive
            else await self.read_letter(session, letter_id, actor=actor)
        )
