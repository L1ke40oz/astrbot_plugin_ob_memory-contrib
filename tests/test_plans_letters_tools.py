"""Verify trusted actor and session boundaries of AstrBot-facing tools."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from astrbot_plugin_ob_memory.handlers.llm_hooks import MemoryHooksMixin
from astrbot_plugin_ob_memory.handlers.llm_tools import MemoryToolsMixin
from astrbot_plugin_ob_memory.main import MemoryPlugin
from astrbot_plugin_ob_memory.tests.test_plans_letters import domain as domain


@pytest.mark.asyncio
async def test_model_tools_follow_resolved_session_and_manage_plan_lifecycle(domain):
    resolver = SimpleNamespace(resolve=AsyncMock(return_value="configured-session"))
    plugin = SimpleNamespace(correspondence=domain, session_resolver=resolver)
    event = SimpleNamespace(unified_msg_origin="raw-origin")
    created = json.loads(
        await MemoryToolsMixin.memory_plan(
            plugin, event, action="create", content="记得兑现承诺"
        )
    )
    assert await domain.plans("raw-origin") == []
    assert (await domain.plans("configured-session"))[0]["id"] == created["id"]
    finished = json.loads(
        await MemoryToolsMixin.memory_plan(
            plugin, event, action="resolve", plan_id=created["id"]
        )
    )
    assert finished["status"] == "resolved" and finished["change_log"][-1]["by"] == "ai"


@pytest.mark.asyncio
async def test_model_letter_tool_never_reads_or_unlocks_human_secret(domain):
    plugin = SimpleNamespace(correspondence=domain)
    event = SimpleNamespace(unified_msg_origin="private")
    human = await domain.write_letter(
        "private",
        "用户保密正文",
        title="用户保密标题",
        actor="human",
        lock_type="permanent",
    )
    read = json.loads(
        await MemoryToolsMixin.memory_letter(
            plugin, event, action="read", letter_id=human["id"]
        )
    )
    assert read["locked"] and "content" not in read and "title" not in read
    attempted = json.loads(
        await MemoryToolsMixin.memory_letter(
            plugin, event, action="lock", letter_id=human["id"], lock_type="none"
        )
    )
    assert "error" in attempted
    own = json.loads(
        await MemoryToolsMixin.memory_letter(
            plugin,
            event,
            action="write",
            content="模型自己的原文",
            title="模型署名",
            lock_type="permanent",
        )
    )
    assert (
        own["author"] == "ai"
        and own["lock_owner"]
        and own["content"] == "模型自己的原文"
    )
    assert (await domain.read_letter("private", own["id"], actor="human"))["locked"]
    other = SimpleNamespace(unified_msg_origin="other")
    assert "error" in json.loads(
        await MemoryToolsMixin.memory_letter(
            plugin, other, action="read", letter_id=own["id"]
        )
    )


@pytest.mark.asyncio
async def test_context_injection_contains_active_plans_but_no_locked_letter_text(
    domain, monkeypatch
):
    monkeypatch.setattr(MemoryHooksMixin, "memory_on_llm_request", AsyncMock())
    active = await domain.create_plan("private", "下一次一起散步")
    closed = await domain.create_plan("private", "已经做完的事")
    await domain.change_plan("private", closed["id"], "resolve")
    await domain.write_letter(
        "private",
        "不应注入的正文",
        title="不应注入的标题",
        actor="human",
        lock_type="permanent",
    )
    plugin = SimpleNamespace(
        correspondence=domain,
        session_resolver=SimpleNamespace(resolve=AsyncMock(return_value="private")),
        _is_session_disabled=lambda sid: False,
    )
    req = SimpleNamespace(system_prompt="原有系统提示")
    await MemoryPlugin.memory_on_llm_request(plugin, SimpleNamespace(), req)
    assert active["content"] in req.system_prompt
    assert closed["content"] not in req.system_prompt
    assert "不应注入" not in req.system_prompt
    assert req.system_prompt.startswith("原有系统提示")
