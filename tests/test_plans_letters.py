"""Exercise persistent domain semantics against isolated SQLite databases."""

import asyncio
import json
import time
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
import pytest_asyncio
from astrbot_plugin_ob_memory.core.memory_manager import MemoryManager
from astrbot_plugin_ob_memory.core.plans_letters import DomainConflict, PlansLetters
from astrbot_plugin_ob_memory.storage import Database, apply_migrations
from astrbot_plugin_ob_memory.storage.schema import (
    SCHEMA_V1,
    SCHEMA_V2,
    SCHEMA_VERSION_TABLE,
)


@pytest_asyncio.fixture
async def domain(tmp_path):
    db = Database(tmp_path / "memory.db")
    await db.connect()
    await apply_migrations(db)
    try:
        yield PlansLetters(db)
    finally:
        await db.close()


@pytest.mark.asyncio
async def test_version_two_upgrade_preserves_existing_memory(tmp_path):
    db = Database(tmp_path / "old.db")
    await db.connect()
    try:
        for sql in (*SCHEMA_V1, *SCHEMA_V2, SCHEMA_VERSION_TABLE):
            await db.execute(sql)
        await db.execute("INSERT INTO schema_version VALUES (1,1),(2,2)")
        await db.execute(
            "INSERT INTO memories(id,session_id,content,created_at,last_active_at) VALUES('old','private','原来的记忆',1,2)"
        )
        await apply_migrations(db)
        await apply_migrations(db)
        assert (await db.fetch_one("SELECT content FROM memories WHERE id='old'"))[
            "content"
        ] == "原来的记忆"
        assert (await db.fetch_one("SELECT MAX(version) AS v FROM schema_version"))[
            "v"
        ] == 3
        store = PlansLetters(db)
        await store.create_plan("private", "迁移后的计划")
        letter = await store.write_letter(
            "private", "不压缩的原文\n第二行", actor="human"
        )
        await db.close()
        await db.connect()
        assert (await store.read_letter("private", letter["id"], actor="human"))[
            "content"
        ] == "不压缩的原文\n第二行"
    finally:
        await db.close()


@pytest.mark.asyncio
async def test_plan_lifecycle_dedup_and_full_change_history(domain):
    first = await domain.create_plan("private", "周末一起散步", weight=0.8, actor="ai")
    duplicate = await domain.create_plan("private", "周末一起散步", weight=0.1)
    assert first["id"] == duplicate["id"]
    changed = await domain.change_plan(
        "private", first["id"], "edit", content="下周末一起散步", weight=0.9
    )
    assert changed["change_log"][-1]["changes"]["content"]["from"] == "周末一起散步"
    for action, status in [
        ("resolve", "resolved"),
        ("reopen", "active"),
        ("abandon", "abandoned"),
    ]:
        changed = await domain.change_plan("private", first["id"], action)
        assert changed["status"] == status
    assert len(changed["change_log"]) == 5
    assert len(await MemoryManager(domain.db).list_by_session("private")) == 0
    assert changed["content"] == "下周末一起散步"
    with pytest.raises(LookupError):
        await domain.change_plan("other", first["id"], "resolve")


@pytest.mark.asyncio
async def test_reopening_duplicate_active_plan_is_rejected(domain):
    first = await domain.create_plan("private", "同一个承诺")
    await domain.change_plan("private", first["id"], "abandon")
    await domain.create_plan("private", "同一个承诺")
    with pytest.raises(DomainConflict):
        await domain.change_plan("private", first["id"], "reopen")


@pytest.mark.asyncio
async def test_locked_letters_redact_both_list_and_detail_and_search(domain):
    human = await domain.write_letter(
        "private",
        "human-secret-正文",
        title="human-secret-标题",
        actor="human",
        lock_type="permanent",
    )
    ai_view = await domain.read_letter("private", human["id"], actor="ai")
    assert ai_view["locked"] and "content" not in ai_view and "title" not in ai_view
    assert "human-secret" not in json.dumps(await domain.letters("private", actor="ai"))
    assert await domain.letters("private", actor="ai", query="human-secret") == []
    assert (await domain.read_letter("private", human["id"], actor="human"))[
        "content"
    ] == "human-secret-正文"
    with pytest.raises(PermissionError):
        await domain.change_letter(
            "private", human["id"], {"lock_type": "none"}, actor="ai"
        )
    ai = await domain.write_letter(
        "private",
        "ai-secret-正文",
        title="ai-secret-标题",
        actor="ai",
        lock_type="permanent",
    )
    human_view = await domain.read_letter("private", ai["id"], actor="human")
    assert (
        human_view["locked"]
        and "content" not in human_view
        and "title" not in human_view
    )
    with pytest.raises(LookupError):
        await domain.read_letter("other", ai["id"], actor="ai")


@pytest.mark.asyncio
async def test_timed_letter_unlocks_at_boundary_and_only_owner_controls_lock(domain):
    now = time.time()
    unlock = datetime.fromtimestamp(now + 60, timezone.utc).isoformat()
    letter = await domain.write_letter(
        "private", "到时才能读", actor="human", lock_type="timed", unlock_date=unlock
    )
    assert (await domain.read_letter("private", letter["id"], actor="ai"))["locked"]
    with patch(
        "astrbot_plugin_ob_memory.core.plans_letters.time.time", return_value=now + 61
    ):
        opened = await domain.read_letter("private", letter["id"], actor="ai")
        assert not opened["locked"] and opened["content"] == "到时才能读"
        with pytest.raises(PermissionError):
            await domain.change_letter(
                "private", letter["id"], {"content": "不应覆盖"}, actor="ai"
            )
    for unlock in ["2020-01-01T00:00:00+00:00", "2099-01-01T00:00:00", "invalid"]:
        with pytest.raises(ValueError):
            await domain.write_letter(
                "private", "正文", actor="human", lock_type="timed", unlock_date=unlock
            )


@pytest.mark.asyncio
async def test_letter_archive_preserves_original_and_readable_recipient_cannot_edit(
    domain,
):
    letter = await domain.write_letter("private", "完整原文", actor="ai")
    assert not (await domain.read_letter("private", letter["id"], actor="human"))[
        "locked"
    ]
    with pytest.raises(PermissionError):
        await domain.change_letter(
            "private", letter["id"], {}, actor="human", archive=True
        )
    await domain.change_letter("private", letter["id"], {}, actor="ai", archive=True)
    assert await domain.letters("private", actor="ai") == []
    assert (await MemoryManager(domain.db).list_sessions_with_meta())[0][
        "session_id"
    ] == "private"
    assert (
        await domain.db.fetch_one(
            "SELECT content FROM memory_letters WHERE id=?", (letter["id"],)
        )
    )["content"] == "完整原文"


@pytest.mark.asyncio
async def test_domain_only_session_is_discoverable_with_zero_ordinary_memories(domain):
    await domain.create_plan("plans-only", "没有普通记忆也能保存计划")
    await domain.write_letter("letters-only", "单独写信", actor="human")
    manager = MemoryManager(domain.db)
    assert set(await manager.list_sessions()) == {"plans-only", "letters-only"}
    assert all(s["memory_count"] == 0 for s in await manager.list_sessions_with_meta())


@pytest.mark.asyncio
async def test_concurrent_plan_edits_detect_revision_conflict(domain, monkeypatch):
    plan = await domain.create_plan("private", "起点")
    original = domain.db.fetch_one
    gate = asyncio.Event()
    reads = 0

    async def synchronized_read(sql, params=None):
        nonlocal reads
        row = await original(sql, params)
        if sql.startswith("SELECT * FROM memory_plans"):
            reads += 1
            if reads == 2:
                gate.set()
            await gate.wait()
        return row

    monkeypatch.setattr(domain.db, "fetch_one", synchronized_read)
    results = await asyncio.gather(
        domain.change_plan("private", plan["id"], "edit", content="改动 A"),
        domain.change_plan("private", plan["id"], "edit", content="改动 B"),
        return_exceptions=True,
    )
    assert sum(isinstance(result, DomainConflict) for result in results) == 1
    final = (await domain.plans("private"))[0]
    assert final["revision"] == 2 and len(final["change_log"]) == 2
