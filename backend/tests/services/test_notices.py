import services.llm_client as llm_mod
from services import notices


def test_fallback_hook_records_notice_under_scope_and_notifies(monkeypatch):
    pings = []
    monkeypatch.setattr(notices.db_client, "notify", lambda: pings.append(1))
    with notices.record_fallbacks("s-test", course="c", lecture="l"):
        llm_mod.fallback_hook.get()("a", "b")
        llm_mod.fallback_hook.get()("b", "a")
    assert llm_mod.fallback_hook.get() is None
    got = notices.recent("s-test")
    assert [n["params"] for n in got] == [
        {"from": "a", "to": "b"},
        {"from": "b", "to": "a"},
    ]
    assert got[0]["code"] == "model_fallback" and got[0]["course"] == "c"
    assert got[0]["id"] < got[1]["id"]
    assert len(pings) == 2
    assert notices.recent("other") == []


def test_notices_expire(monkeypatch):
    monkeypatch.setattr(notices.db_client, "notify", lambda: None)
    notices.add("s-exp", "model_fallback", {})
    monkeypatch.setattr(notices, "_TTL", -1)
    assert notices.recent("s-exp") == []


def test_ids_are_seeded_from_the_clock():
    import importlib
    import time

    before = int(time.time() * 1000)
    fresh = importlib.reload(notices)
    assert fresh._next_id >= before
