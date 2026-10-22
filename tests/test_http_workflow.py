"""Integration checks against a real HTTP server with an isolated SQLite database."""
import base64
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def service(tmp_path_factory):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    env = os.environ.copy()
    env.update(UNDELIVERED_DB=str(tmp_path_factory.mktemp("drill") / "state.db"), UNDELIVERED_INTERNAL_URL=base)
    process = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    client = httpx.Client(base_url=base, timeout=15, trust_env=False)
    try:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if process.poll() is not None:
                pytest.fail(process.stderr.read().decode(errors="replace"))
            try:
                if client.get("/api/health").is_success:
                    break
            except httpx.TransportError:
                time.sleep(.08)
        else:
            pytest.fail("HTTP server did not start")
        yield client
    finally:
        client.close()
        process.terminate()
        process.wait(timeout=10)


@pytest.fixture()
def client(service):
    assert service.post("/api/reset").is_success
    return service


def mcp(client, service, name, arguments=None):
    response = client.post(f"/mcp/{service}", json={"jsonrpc": "2.0", "id": f"TEST-{time.monotonic_ns()}", "method": "tools/call", "params": {"name": name, "arguments": arguments or {}}})
    assert response.is_success
    return response.json()["result"]


def run(client, expected="completed"):
    response = client.post("/api/run", json={"policy": "balanced"})
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        result = client.get(f"/api/jobs/{job_id}").json()
        if result["status"] != "running":
            assert result["status"] == expected, result
            return client.get("/api/state").json()
        time.sleep(.04)
    pytest.fail("workflow did not finish")


def execute(client):
    state = run(client)
    plan = state["plans"][0]
    assert client.post(f"/api/plans/{plan['id']}/approve").is_success
    assert client.post(f"/api/plans/{plan['id']}/execute").is_success
    return client.get("/api/state").json(), plan


def test_static_app_and_honest_initial_state(client):
    assert client.get("/").is_success
    page = client.get("/").text
    import re
    for url in re.findall(r'(?:src|href)="(/assets/[^\"]+)"', page):
        assert client.get(url).is_success, url
    health = client.get("/api/health").json()
    assert health["cloud_connected"] is False and health["model_trained"] is False
    state = client.get("/api/state").json()
    assert state["metrics"]["unknown"] == 1
    assert state["metrics"]["human_confirmed"] == 0
    assert not state["plans"] and not state["tool_calls"]


def test_mcp_handshake_discovery_and_rejected_arguments(client):
    names = []
    for name in ("observation", "planning", "delivery"):
        result = client.post(f"/mcp/{name}", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25"}}).json()["result"]
        assert result["capabilities"]["tools"]
        assert client.post(f"/mcp/{name}", json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code == 202
        result = client.post(f"/mcp/{name}", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()["result"]
        names.extend(t["name"] for t in result["tools"])
    assert len(names) == len(set(names)) == 12
    bad = mcp(client, "observation", "obs_request_probe", {"region_id": "R12"})
    assert bad["isError"] is True and bad["structuredContent"]["error"] == "INVALID_ARGUMENT"
    invalid = client.post("/mcp/planning", json={"jsonrpc": "2.0", "id": 3, "method": "initialize", "params": []})
    assert invalid.json()["error"]["code"] == -32602


def test_probe_budget_is_idempotent_and_plan_is_real(client):
    before = client.get("/api/state").json()
    args = {"region_id": "R12", "snapshot_version": before["version"], "idempotency_key": "test-probe"}
    first = mcp(client, "observation", "obs_request_probe", args)
    again = mcp(client, "observation", "obs_request_probe", args)
    assert first["structuredContent"] == again["structuredContent"]
    state = run(client)
    assert state["probe_budget"] == 1 and state["metrics"]["unknown"] == 0
    assert len(state["probes"]) == 1
    plan = state["plans"][0]
    action = next(a for a in plan["actions"] if a["region_id"] == "R12")
    assert action["route"]["edges"] == ["RD06", "RD12", "RD14"]
    assert action["route"]["minutes"] == 9 + 13 + 12
    assert action["eta_minutes"] == 44
    assert len({a["team_id"] for a in plan["actions"]}) == 2
    assert all(c["transport"] == "HTTP JSON-RPC" for c in state["tool_calls"])


def test_approval_and_snapshot_protect_execution(client):
    state = run(client)
    plan = state["plans"][0]
    rejected = client.post(f"/api/plans/{plan['id']}/execute")
    assert rejected.status_code == 409 and rejected.json()["error"] == "APPROVAL_REQUIRED"
    assert client.post(f"/api/plans/{plan['id']}/approve").is_success
    assert client.post("/api/inject/road").is_success
    rejected = client.post(f"/api/plans/{plan['id']}/execute")
    assert rejected.status_code == 409
    assert not client.get("/api/state").json()["messages"]
    state = run(client)
    replacement = state["plans"][0]
    action = next(a for a in replacement["actions"] if a["region_id"] == "R12")
    assert "RD14" not in action["route"]["edges"] and action["eta_minutes"] == 51
    assert replacement["snapshot_version"] == state["version"]
    assert replacement["approval_id"] is None and state["plans"][1]["status"] == "stale"


def test_low_battery_reports_infeasible_without_fabricated_plan(client):
    assert client.post("/api/inject/battery").is_success
    state = run(client, "failed")
    assert not state["plans"]
    assert state["agent_stages"]["plan"] == "error"
    assert any(c["status"] == "error" and 'INFEASIBLE' in c["result"] for c in state["tool_calls"])
    assert not state["messages"]


def test_dispatch_and_receipts_are_separate_idempotent_stages(client):
    state, plan = execute(client)
    assert state["plans"][0]["actions"] == plan["actions"]  # approved payload stays immutable
    assert state["plans"][0]["hash"] == plan["hash"]
    assert state["simulation_time"] == "03:04"  # 02:20 + the computed 44 minutes
    assert len(state["messages"]) == 12
    assert state["metrics"]["terminal_received"] == state["metrics"]["human_confirmed"] == 0
    assert client.post(f"/api/plans/{plan['id']}/execute").is_success
    assert len(client.get("/api/state").json()["messages"]) == 12
    message = next(m for m in state["messages"] if m["region_id"] == "R12")
    body = {"message_id": message["id"], "region_id": "R12", "client_id": "TEST-TERMINAL", "stage": "human_confirmed"}
    assert client.post("/api/receipts", json=body).json()["error"] == "RECEIPT_REQUIRED"
    assert client.get("/api/terminal/R12/messages").is_success
    body["stage"] = "terminal_received"
    first = client.post("/api/receipts", json=body).json()
    assert client.post("/api/receipts", json=body).json()["terminal_received_at"] == first["terminal_received_at"]
    client.post("/api/terminal/R12/link", json={"online": False})
    assert client.get("/api/terminal/R12/messages").status_code == 503
    body["stage"] = "human_confirmed"
    assert client.post("/api/receipts", json=body).status_code == 503
    client.post("/api/terminal/R12/link", json={"online": True})
    confirmed = client.post("/api/receipts", json=body).json()
    assert confirmed["human_confirmed_at"]
    assert client.post("/api/receipts", json=body).json()["human_confirmed_at"] == confirmed["human_confirmed_at"]
    state = client.get("/api/state").json()
    assert state["metrics"]["terminal_received"] == state["metrics"]["human_confirmed"] == 1
    assert state["agent_stages"]["verify"] == "waiting"  # one village is not all targets


def test_reports_upload_and_stale_evidence_are_persisted(client):
    state = run(client)
    result = client.post("/api/reports", json={"region_id": "R12", "text": "昨天拍的旧照，现在道路能否通行还没确认。", "modality": "text"})
    assert result.is_success and result.json()["stale"] is True
    assert client.get("/api/state").json()["plans"][0]["status"] == "stale"
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvB0AAAAASUVORK5CYII=")
    result = client.post("/api/reports/upload", data={"region_id": "R12", "text": "现场演练图片"}, files={"file": ("evidence.png", png, "image/png")})
    assert result.is_success
    attachment = result.json()["attachment"]
    assert attachment["processing"] == "stored_only_cloud_model_pending"
    assert client.get(attachment["url"]).content == png
    assert client.get("/api/state").json()["version"] == state["version"] + 2
    assert client.post("/api/reports/upload", files={"file": ("unsafe.svg", b"<svg/>", "image/svg+xml")}).status_code == 400


def test_export_contains_actual_calls_and_capability_boundaries(client):
    run(client)
    response = client.get("/api/export")
    assert response.is_success
    assert "obs_request_probe" in response.text and "plan_optimize" in response.text
    assert "尚未接入" in response.text and "合成演练" in response.text


def test_new_notice_does_not_inherit_historical_confirmation(client):
    state, plan = execute(client)
    message = next(m for m in state["messages"] if m["region_id"] == "R12")
    body = {"message_id": message["id"], "region_id": "R12", "client_id": "TEST-SCOPED"}
    for stage in ("terminal_received", "human_confirmed"):
        assert client.post("/api/receipts", json={**body, "stage": stage}).is_success
    approval = state["plans"][0]["approval_id"]
    result = mcp(client, "delivery", "delivery_publish_notice", {"plan_id": plan["id"], "approval_id": approval, "idempotency_key": "notice-2", "region_ids": ["R12"]})
    assert not result["isError"]
    current = client.get("/api/state").json()
    assert current["metrics"]["targets"] == 1
    assert current["metrics"]["human_confirmed"] == current["metrics"]["terminal_received"] == 0
    assert current["delivery"]["active_notice_id"] == result["structuredContent"]["notice_id"]
    assert len(client.get("/api/terminal/R12/messages").json()["messages"]) == 1
    before = len(current["traces"])
    client.post("/api/receipts", json={**body, "stage": "human_confirmed"})
    current = client.get("/api/state").json()
    assert current["metrics"]["human_confirmed"] == 0 and len(current["traces"]) == before


def test_old_page_cannot_write_after_reset(client):
    old = client.get("/api/state").json()["drill_id"]
    response = client.post("/api/reset", headers={"X-Drill-ID": old})
    assert response.is_success and response.json()["drill_id"] != old
    response = client.post("/api/reports", headers={"X-Drill-ID": old}, json={"region_id": "R12", "text": "旧终端迟到的报告"})
    assert response.status_code == 409 and response.json()["error"] == "DRILL_CHANGED"
    response = client.post("/api/run", headers={"X-Drill-ID": old}, json={})
    assert response.status_code == 409
    state = client.get("/api/state").json()
    assert state["version"] == 1 and len(state["evidence"]) == 3 and not state["jobs"]


def test_idempotency_key_rejects_changed_probe_arguments(client):
    version = client.get("/api/state").json()["version"]
    args = {"region_id": "R12", "snapshot_version": version, "idempotency_key": "same-key"}
    assert not mcp(client, "observation", "obs_request_probe", args)["isError"]
    result = mcp(client, "observation", "obs_request_probe", {**args, "region_id": "R11"})
    assert result["isError"] and result["structuredContent"]["error"] == "IDEMPOTENCY_CONFLICT"
    assert client.get("/api/state").json()["probe_budget"] == 1


def test_approval_still_checked_when_retry_hits_cache(client):
    state, plan = execute(client)
    result = mcp(client, "delivery", "delivery_dispatch_drill", {"plan_id": plan["id"], "approval_id": "wrong-approval", "idempotency_key": f"ui-execute:{plan['id']}"})
    assert result["isError"] and result["structuredContent"]["error"] == "APPROVAL_REQUIRED"
    args = {"plan_id": plan["id"], "approval_id": state["plans"][0]["approval_id"], "idempotency_key": "one-cohort", "region_ids": ["R12"]}
    assert not mcp(client, "delivery", "delivery_publish_notice", args)["isError"]
    result = mcp(client, "delivery", "delivery_publish_notice", {**args, "region_ids": ["R11"]})
    assert result["isError"] and result["structuredContent"]["error"] == "IDEMPOTENCY_CONFLICT"
    assert len(client.get("/api/state").json()["messages"]) == 13


def test_probe_uses_requested_region_observation_not_a_fixed_story(client):
    state = client.get("/api/state").json()
    assert "monitor_truth" not in state
    result = mcp(client, "observation", "obs_request_probe", {"region_id": "R10", "snapshot_version": state["version"], "idempotency_key": "probe-newbridge"})
    assert result["structuredContent"]["facts"] == {"link_status": "degraded", "battery_minutes": 120}
    state = client.get("/api/state").json()
    assert state["evidence"][0]["region_id"] == "R10"
    assert "新桥镇" in state["evidence"][0]["text"] and "鹿鸣村" not in state["evidence"][0]["text"]
    visible = mcp(client, "observation", "obs_get_snapshot")["structuredContent"]
    assert "monitor_truth" not in visible and "command_cache" not in visible


def test_media_and_origin_checks_reject_misleading_requests(client):
    response = client.post("/api/reports/upload", files={"file": ("fake.png", b"this is not an image", "image/png")})
    assert response.status_code == 400
    response = client.post("/mcp/observation", headers={"Origin": "https://outside.invalid"}, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert response.status_code == 403
    assert not client.get("/api/state").json()["tool_calls"]


def test_plan_explains_alternatives_and_independent_checks(client):
    state = run(client)
    plan = state["plans"][0]
    assert [(c["eta_minutes"], c["travel_minutes"]) for c in plan["alternatives"]] == [(44, 57), (53, 75)]
    assert plan["alternatives"][0]["selected"] is True
    assert plan["alternatives"][0]["safety_margin_minutes"] == 116
    assert len(plan["validation"]["checks"]) == 6 and all(c["passed"] for c in plan["validation"]["checks"])
    assert state["planning_diagnostics"]["assignments_checked"] == state["planning_diagnostics"]["feasible_count"] == 2
    first = client.post(f"/api/plans/{plan['id']}/approve").json()
    second = client.post(f"/api/plans/{plan['id']}/approve").json()
    assert first["approval_id"] == second["approval_id"]


def test_infeasible_plan_records_specific_energy_shortfall(client):
    client.post("/api/inject/battery")
    state = run(client, "failed")
    diagnosis = state["planning_diagnostics"]
    assert diagnosis["status"] == "infeasible" and diagnosis["feasible_count"] == 0
    shortages = diagnosis["reasons"]
    assert all(r["code"] == "BATTERY_SHORTFALL" for r in shortages)
    best = min(shortages, key=lambda r: r["required_minutes"])
    assert best["required_minutes"] == 64 and best["available_minutes"] == 15 and best["shortfall_minutes"] == 49
    assert diagnosis["suggestions"] and not state["plans"]


def test_reset_archives_records_and_export_never_leaks_hidden_truth(client):
    old, _ = execute(client)
    response = client.post("/api/reset", headers={"X-Drill-ID": old["drill_id"]})
    assert response.is_success and response.json()["drill_id"] != old["drill_id"]
    history = client.get("/api/history").json()["drills"]
    assert history[0]["drill_id"] == old["drill_id"]
    archived = client.get(f"/api/history/{old['drill_id']}").json()
    assert archived["messages"] == old["messages"] and archived["plans"][0]["approval_id"] == old["plans"][0]["approval_id"]
    assert "monitor_truth" not in archived and "command_cache" not in archived
    exported = client.get(f"/api/history/{old['drill_id']}/export")
    assert exported.is_success and "attachment" in exported.headers["content-disposition"]
    assert exported.json()["drill_id"] == old["drill_id"]


def test_knowledge_is_versioned_ranked_and_returns_no_irrelevant_fill(client):
    documents = client.get("/api/knowledge").json()["documents"]
    assert len(documents) == 8 and all(len(d["content_hash"]) == 64 for d in documents)
    results = client.get("/api/knowledge", params={"q": "电量"}).json()
    assert results["mode"] == "sqlite_fts5_bm25_cjk_bigrams"
    assert "DRILL-SOP-02" in {d["id"] for d in results["documents"]}
    assert all(d["score"] > 0 and d["matched_terms"] for d in results["documents"])
    assert client.get("/api/knowledge", params={"q": "火星银河飞船"}).json()["documents"] == []
    exact = client.get("/api/knowledge", params={"q": "DRILL-SOP-04"}).json()["documents"]
    assert len(exact) == 1 and exact[0]["id"] == "DRILL-SOP-04"
    assert client.get("/api/knowledge", params={"q": '"*) OR ("'}).is_success


def test_mcp_explicitly_rejects_unsupported_transport_and_invalid_id(client):
    assert client.get("/mcp/observation").status_code == 405
    response = client.post("/mcp/observation", json={"jsonrpc": "2.0", "id": [], "method": "tools/list"})
    assert response.json()["error"]["code"] == -32600
    response = client.post("/mcp/observation", headers={"MCP-Protocol-Version": "unsupported"}, json={"jsonrpc": "2.0", "id": 0, "method": "tools/list"})
    assert response.status_code == 400


def test_complete_tool_responses_survive_truncation_reused_rpc_ids_and_archival(client):
    description = "完整现场证据" * 600
    assert client.post("/api/reports", json={"text": description, "region_id": "R12"}).is_success
    for name in ("obs_get_evidence", "obs_query_route"):
        response = client.post("/mcp/observation", json={"jsonrpc": "2.0", "id": "reused-rpc-id", "method": "tools/call", "params": {"name": name, "arguments": {}}})
        assert not response.json()["result"]["isError"]
    state = client.get("/api/state").json()
    route_call, evidence_call = state["tool_calls"]
    assert route_call["id"] != evidence_call["id"] and route_call["request_id"] == evidence_call["request_id"] == "reused-rpc-id"
    assert evidence_call["result_truncated"] is True and len(evidence_call["result"]) == 4000
    full = client.get(f"/api/tool-calls/{evidence_call['id']}").json()
    assert full["result"]["evidence"][0]["text"] == description
    assert full["content_hash"] == evidence_call["result_hash"]
    assert state["metrics"]["tool_calls"] == 2
    client.post("/api/reset")
    after = client.get(f"/api/tool-calls/{evidence_call['id']}", params={"drill_id": state["drill_id"]}).json()
    assert after == full


def test_legacy_browser_must_refresh_before_unscoped_mutation(client):
    origin = str(client.base_url).rstrip("/")
    response = client.post("/api/reports", headers={"Origin": origin}, json={"text": "旧页面无演练编号"})
    assert response.status_code == 409 and response.json()["error"] == "REFRESH_REQUIRED"
    current = client.get("/api/state").json()
    response = client.post("/api/reports", headers={"Origin": origin, "X-Drill-ID": current["drill_id"]}, json={"text": "已刷新页面的现场报告"})
    assert response.is_success


def test_new_proposal_supersedes_old_approval_even_without_world_change(client):
    state = run(client)
    first = state["plans"][0]
    assert client.post(f"/api/plans/{first['id']}/approve").is_success
    replacement = run(client)
    assert replacement["version"] == state["version"]
    assert replacement["plans"][1]["status"] == "superseded"
    response = client.post(f"/api/plans/{first['id']}/execute")
    assert response.status_code == 409 and response.json()["error"] == "PLAN_SUPERSEDED"
    assert not client.get("/api/state").json()["messages"]


def test_repeated_execution_or_reassessment_does_not_regress_completed_receipts(client):
    state, plan = execute(client)
    args = {"plan_id": plan["id"], "approval_id": state["plans"][0]["approval_id"], "idempotency_key": "single-target", "region_ids": ["R12"]}
    result = mcp(client, "delivery", "delivery_publish_notice", args)["structuredContent"]
    message = next(m for m in client.get("/api/state").json()["messages"] if m["notice_id"] == result["notice_id"])
    for stage in ("terminal_received", "human_confirmed"):
        assert client.post("/api/receipts", json={"message_id": message["id"], "region_id": "R12", "stage": stage, "client_id": "TEST-COMPLETE"}).is_success
    before = client.get("/api/state").json()
    assert before["agent_stages"]["verify"] == "completed"
    assert client.post(f"/api/plans/{plan['id']}/execute").is_success
    after = client.get("/api/state").json()
    assert after["agent_stages"]["verify"] == "completed" and len(after["traces"]) == len(before["traces"])
    assert run(client)["agent_stages"]["verify"] == "completed"
