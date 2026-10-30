"""双界面路由和 OB 适配层使用临时 SQLite 做集成验证。"""

import json
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from astrbot_plugin_ob_memory.core.memory_manager import MemoryManager
from astrbot_plugin_ob_memory.core.models import MemoryBucket
from astrbot_plugin_ob_memory.dashboard.server import DashboardServer
from astrbot_plugin_ob_memory.storage import Database, apply_migrations


@pytest_asyncio.fixture
async def dashboard(tmp_path):
    db = Database(tmp_path / "memory.db")
    await db.connect()
    await apply_migrations(db)
    manager = MemoryManager(db)
    now = time.time()
    for bid, session, created in [
        ("a-old", "private", now - 3600),
        ("a-new", "private", now),
        ("b-secret", "group", now + 1),
    ]:
        await manager.create(
            MemoryBucket(
                id=bid,
                session_id=session,
                name=bid,
                content="一起散步的测试记忆 " + bid,
                tags=["散步", "日常"],
                domain=["生活"],
                importance=6,
                created_at=created,
                last_active_at=created,
            )
        )
    plugin = SimpleNamespace(
        manager=manager,
        config={},
        search=None,
        embedding=None,
        decay=None,
        writer=None,
        tagger=None,
    )
    server = DashboardServer(plugin, tmp_path)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=server.build_app()), base_url="http://test"
    ) as client:
        yield client, plugin
    await db.close()


async def login(client):
    response = await client.post("/auth/setup", json={"password": "test-only-123"})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_shell_preserves_original_page_and_assets(dashboard):
    client, _ = dashboard
    shell = await client.get("/")
    assert shell.status_code == 200
    assert 'id="frontend-frame"' in shell.text
    assert 'id="frontend-toolbar"' not in shell.text
    assert 'id="current-frontend"' not in shell.text
    original = await client.get("/dashboard?ui=classic")
    original_path = Path(__file__).parents[1] / "dashboard/static/index.html"
    assert original.text == original_path.read_text(encoding="utf-8")
    ob = await client.get("/ob")
    assert ob.status_code == 200 and "/ob/static/adapter.js" in ob.text
    assert all(f'value="{palette}"' in ob.text for palette in ("lilac", "sand", "mist"))
    assert 'value="violet-mist"' not in ob.text and 'value="snowfall"' not in ob.text
    assert "/ob/static/dashboard-journal.js" in ob.text
    assert "/ob/static/login-cover.css" in ob.text
    assert "currentFilter = 'active'" in ob.text
    assert "/ob/static/companion-idle.webp" in ob.text
    assert (
        (await client.get("/ob/static/brand-icon.png"))
        .headers["content-type"]
        .startswith("image/png")
    )
    assert (await client.get("/ob/static/dashboard.html")).status_code == 404
    galaxy = await client.get("/ob/static/galaxy.html")
    assert galaxy.status_code == 200
    assert 'id="galaxy-picker"' in galaxy.text
    assert "https://" not in galaxy.text
    for asset in (
        "explorer.js",
        "lucide.min.js",
        "galaxy-host.js",
        "galaxy.js",
        "galaxy-engine.js",
        "galaxy.css",
        "dashboard-journal.js",
        "dashboard-journal.css",
        "dashboard-galaxy.js",
        "login-cover.css",
        "login-flower-photo.jpg",
        "app-icon-180.png",
    ):
        assert (await client.get("/ob/static/" + asset)).status_code == 200
    assert (await client.get("/ob/static/../auth.py")).status_code == 404
    assert "no-store" in shell.headers["cache-control"]


@pytest.mark.asyncio
async def test_shared_auth_and_original_api_contract(dashboard):
    client, _ = dashboard
    assert (await client.get("/ob/api/buckets")).status_code == 401
    await login(client)
    assert isinstance((await client.get("/api/buckets")).json(), dict)
    assert isinstance((await client.get("/ob/api/buckets")).json(), list)
    await client.post("/auth/logout")
    assert (await client.get("/ob/api/buckets")).status_code == 401


@pytest.mark.asyncio
async def test_session_scoping_sort_search_and_no_read_activation(dashboard):
    client, plugin = dashboard
    await login(client)
    before = await plugin.manager.get("private", "a-old")
    response = await client.get("/ob/api/buckets?session=private&sort=created_asc")
    assert [row["id"] for row in response.json()] == ["a-old", "a-new"]
    response = await client.get("/ob/api/buckets?session=private&sort=created_desc")
    assert [row["id"] for row in response.json()] == ["a-new", "a-old"]
    results = (await client.get("/ob/api/search?session=private&q=散步")).json()
    assert {row["id"] for row in results} == {"a-old", "a-new"}
    assert (
        await client.get("/ob/api/bucket/b-secret?session=private")
    ).status_code == 404
    assert (await client.get("/ob/api/buckets?session=missing")).status_code == 400
    after = await plugin.manager.get("private", "a-old")
    assert (before.activation_count, before.last_active_at) == (
        after.activation_count,
        after.last_active_at,
    )


@pytest.mark.asyncio
async def test_configured_session_cannot_be_overridden(dashboard):
    client, plugin = dashboard
    plugin.config["dashboard_session_id"] = "private"
    await login(client)
    sessions = (await client.get("/ob/api/sessions")).json()
    assert sessions["locked"] is True
    assert [s["session_id"] for s in sessions["sessions"]] == ["private"]
    response = await client.patch(
        "/ob/api/bucket/b-secret/edit?session=group", json={"name": "不应修改"}
    )
    assert response.status_code == 400
    assert (await plugin.manager.get("group", "b-secret")).name == "b-secret"


@pytest.mark.asyncio
async def test_edit_pin_resolve_archive_persist_and_reject_unsupported_fields(
    dashboard,
):
    client, plugin = dashboard
    await login(client)
    base = "/ob/api/bucket/a-old"
    result = await client.patch(
        base + "/edit?session=private",
        json={
            "name": "新标题",
            "content": "正文完整保留\n第二行",
            "tags": "紫雾， 散步,紫雾",
        },
    )
    assert result.status_code == 200
    bucket = await plugin.manager.get("private", "a-old")
    assert bucket.name == "新标题" and bucket.content.endswith("第二行")
    assert bucket.tags == ["紫雾", "散步"]
    assert (
        await client.post(base + "/pin?session=private", json={})
    ).status_code == 200
    bucket = await plugin.manager.get("private", "a-old")
    assert (
        bucket.pinned and bucket.bucket_type == "permanent" and bucket.importance == 10
    )
    assert (await client.post(base + "/archive?session=private")).status_code == 400
    await client.post(base + "/pin?session=private", json={"importance": 6})
    await client.post(base + "/resolve?session=private")
    bucket = await plugin.manager.get("private", "a-old")
    assert not bucket.pinned and bucket.bucket_type == "dynamic" and bucket.resolved
    assert (await client.post(base + "/archive?session=private")).status_code == 200
    bucket = await plugin.manager.get("private", "a-old")
    assert bucket.bucket_type == "archived" and bucket.content.endswith("第二行")
    for body in [
        {"dont_surface": True},
        {"type": "letter"},
        {"importance": 20},
        {"pinned": "false"},
        {"content": ""},
        [],
    ]:
        assert (
            await client.patch(base + "/edit?session=private", json=body)
        ).status_code == 400
    assert (
        await client.post(
            "/ob/api/buckets/permanent-delete?session=private",
            json={"ids": ["a-old"], "confirm": False},
        )
    ).status_code == 400
    assert await plugin.manager.get("private", "a-old") is not None


@pytest.mark.asyncio
async def test_graph_and_missing_features_are_honest(dashboard):
    client, _ = dashboard
    await login(client)
    detail = (await client.get("/ob/api/bucket/a-old?session=private")).json()
    assert detail["metadata"]["created_epoch_ms"] > 0
    assert detail["metadata"]["type"] == "dynamic"
    graph = (await client.get("/ob/api/network?session=private")).json()
    assert {n["id"] for n in graph["nodes"]} == {"生活", "散步", "日常"}
    assert all(edge["weight"] == 2 for edge in graph["edges"])
    assert (await client.get("/ob/api/network?mode=embedding")).status_code == 501
    assert (await client.get("/ob/api/letters")).status_code == 200
    caps = (await client.get("/ob/api/capabilities")).json()
    assert "letters" in caps["supported"] and "edit" in caps["supported"]
    assert "permanent-delete" in caps["supported"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {},
        {"ids": ["a-old"]},
        {"ids": ["a-old"], "confirm": "true"},
        {"ids": ["a-old"], "confirm": 1},
        {"ids": [], "confirm": True},
        {"ids": "a-old", "confirm": True},
        {"ids": [False], "confirm": True},
        {"ids": [" "], "confirm": True},
        {"ids": ["a-old"] * 101, "confirm": True},
    ],
)
async def test_permanent_delete_rejects_unconfirmed_or_invalid_requests(
    dashboard, body
):
    client, plugin = dashboard
    await login(client)
    response = await client.post(
        "/ob/api/buckets/permanent-delete?session=private", json=body
    )
    assert response.status_code == 400
    assert await plugin.manager.get("private", "a-old") is not None


@pytest.mark.asyncio
async def test_permanent_delete_auth_scope_confirmation_and_vector_cleanup(dashboard):
    client, plugin = dashboard
    endpoint = "/ob/api/buckets/permanent-delete?session=private"
    assert (
        await client.post(endpoint, json={"ids": ["a-old"], "confirm": True})
    ).status_code == 401
    await login(client)
    for bad_id in ("b-secret", "missing"):
        response = await client.post(
            endpoint, json={"ids": ["a-old", bad_id], "confirm": True}
        )
        assert response.status_code == 400
        assert await plugin.manager.get("private", "a-old") is not None
    await plugin.manager.update("private", "a-old", pinned=True)
    await plugin.manager.db.executemany(
        "INSERT INTO embeddings(bucket_id,vector,dim,updated_at) VALUES(?,?,?,?)",
        [(bid, b"1234", 1, time.time()) for bid in ("a-old", "a-new", "b-secret")],
    )
    response = await client.post(
        endpoint, json={"ids": ["a-old", "a-new", "a-old"], "confirm": True}
    )
    assert response.status_code == 200
    assert response.json()["deleted"] == ["a-old", "a-new"]
    assert await plugin.manager.list_by_session("private", include_archived=True) == []
    vectors = await plugin.manager.db.fetch_all("SELECT bucket_id FROM embeddings")
    assert [row["bucket_id"] for row in vectors] == ["b-secret"]
    assert await plugin.manager.get("group", "b-secret") is not None


@pytest.mark.asyncio
async def test_permanent_delete_honors_configured_session_lock(dashboard):
    client, plugin = dashboard
    plugin.config["dashboard_session_id"] = "private"
    await login(client)
    response = await client.post(
        "/ob/api/buckets/permanent-delete?session=group",
        json={"ids": ["b-secret"], "confirm": True},
    )
    assert response.status_code == 400
    assert await plugin.manager.get("group", "b-secret") is not None


@pytest.mark.asyncio
async def test_permanent_delete_rolls_back_all_memories_on_cleanup_failure(
    dashboard, monkeypatch
):
    client, plugin = dashboard
    await login(client)
    db = plugin.manager.db
    await db.execute(
        "INSERT INTO embeddings(bucket_id,vector,dim,updated_at) VALUES(?,?,?,?)",
        ("a-old", b"1234", 1, time.time()),
    )
    connection = db._require_conn()
    original = connection.executemany

    async def fail_cleanup(sql, parameters):
        if "DELETE FROM embeddings" in sql:
            raise RuntimeError("Simulated vector cleanup failure")
        return await original(sql, parameters)

    monkeypatch.setattr(connection, "executemany", fail_cleanup)
    with pytest.raises(RuntimeError, match="Simulated vector cleanup failure"):
        await client.post(
            "/ob/api/buckets/permanent-delete?session=private",
            json={"ids": ["a-old", "a-new"], "confirm": True},
        )
    assert await plugin.manager.get("private", "a-old") is not None
    assert await plugin.manager.get("private", "a-new") is not None
    assert await db.fetch_one(
        "SELECT bucket_id FROM embeddings WHERE bucket_id='a-old'"
    )


@pytest.mark.asyncio
async def test_batch_validates_all_targets_before_writing(dashboard):
    client, plugin = dashboard
    await login(client)
    response = await client.post(
        "/ob/api/buckets/batch?session=private",
        json={"ids": ["a-old", "b-secret"], "action": "archive"},
    )
    assert response.status_code == 400
    assert (await plugin.manager.get("private", "a-old")).bucket_type == "dynamic"
    response = await client.post(
        "/ob/api/buckets/batch?session=private",
        json={"ids": ["a-old", "a-new"], "action": "resolve"},
    )
    assert response.status_code == 200
    assert (await plugin.manager.get("private", "a-old")).resolved
    assert (await plugin.manager.get("private", "a-new")).resolved


@pytest.mark.asyncio
async def test_feel_source_and_reverse_link_survive_conversion(dashboard):
    client, plugin = dashboard
    await plugin.manager.create(
        MemoryBucket(
            id="feel-1",
            session_id="private",
            name="散步后的感受",
            content="很平静",
            bucket_type="feel",
            source_bucket_id="a-old",
            created_at=time.time(),
            last_active_at=time.time(),
        )
    )
    await login(client)
    feel = (await client.get("/ob/api/bucket/feel-1?session=private")).json()
    assert feel["metadata"]["triggered_by"] == "a-old"
    source = (await client.get("/ob/api/bucket/a-old?session=private")).json()
    assert source["triggered_feels"] == [{"id": "feel-1", "name": "散步后的感受"}]


@pytest.mark.asyncio
async def test_embedding_failure_keeps_saved_text_and_returns_warning(dashboard):
    client, plugin = dashboard
    plugin.embedding = SimpleNamespace(
        enabled=True,
        generate_and_store=AsyncMock(side_effect=RuntimeError("测试向量服务不可用")),
    )
    await login(client)
    response = await client.patch(
        "/ob/api/bucket/a-old/edit?session=private",
        json={"content": "向量服务故障时仍保存的正文"},
    )
    assert response.status_code == 200 and response.json()["warnings"]
    assert (
        await plugin.manager.get("private", "a-old")
    ).content == "向量服务故障时仍保存的正文"
    plugin.embedding.generate_and_store.assert_awaited_once_with(
        "a-old", "向量服务故障时仍保存的正文"
    )


@pytest.mark.asyncio
async def test_plan_and_letter_endpoints_enforce_session_and_authorship(dashboard):
    from astrbot_plugin_ob_memory.core.plans_letters import PlansLetters

    client, plugin = dashboard
    assert (await client.get("/ob/api/plans")).status_code == 401
    await login(client)
    plan = (
        await client.post(
            "/ob/api/plans?session=private",
            json={"content": "网页上的承诺", "weight": 0.7},
        )
    ).json()["plan"]
    assert (
        await client.post(
            f"/ob/api/plans/{plan['id']}/action?session=group",
            json={"action": "resolve"},
        )
    ).status_code == 404
    assert (
        await client.post(
            f"/ob/api/plans/{plan['id']}/action?session=private",
            json={"action": "resolve"},
        )
    ).json()["plan"]["status"] == "resolved"
    store = PlansLetters(plugin.manager.db)
    letter = await store.write_letter(
        "private",
        "隐藏的 AI 原文",
        title="隐藏的 AI 标题",
        actor="ai",
        lock_type="permanent",
    )
    listing = (await client.get("/ob/api/letters?session=private")).json()
    assert "隐藏的 AI" not in json.dumps(listing, ensure_ascii=False)
    assert (
        await client.patch(
            f"/ob/api/letter/{letter['id']}?session=private", json={"lock_type": "none"}
        )
    ).status_code == 403
    assert (
        await client.delete(f"/ob/api/letter/{letter['id']}?session=private")
    ).status_code == 403
    assert (
        await client.post(
            "/ob/api/letter?session=private", json={"author": "ai", "content": "伪造"}
        )
    ).status_code == 403
    own = await client.post(
        "/ob/api/letter?session=private",
        json={"content": "网页的原始信件", "author": "user", "lock_type": "none"},
    )
    assert own.status_code == 201
    assert (await client.get("/ob/api/letters?session=group")).json()["letters"] == []
    assert (await client.get("/api/buckets")).json()["total"] == 3
