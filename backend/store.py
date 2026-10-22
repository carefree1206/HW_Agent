import json
import os
import sqlite3
import threading
from copy import deepcopy
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from .scenario import initial_state
from .errors import DomainError

ROOT = Path(__file__).resolve().parent.parent
EXPECTED_DRILL = ContextVar("expected_drill", default=None)


@contextmanager
def drill_scope(drill_id):
    token = EXPECTED_DRILL.set(drill_id)
    try:
        yield
    finally:
        EXPECTED_DRILL.reset(token)


def assert_current(state):
    expected = EXPECTED_DRILL.get()
    if expected and expected != state["drill_id"]:
        raise DomainError("DRILL_CHANGED", "演练已重置。旧页面或旧请求不能写入新演练，请同步最新状态。")


def timestamp():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="milliseconds")


def event(state, title, detail="", kind="info", actor="系统", region_id=None):
    row = {"id": uuid4().hex[:12], "at": timestamp(), "time": state["simulation_time"], "title": title, "detail": detail, "kind": kind, "actor": actor, "region_id": region_id}
    state["events"].insert(0, row)
    state["events"] = state["events"][:240]
    return row


def business_changed(state):
    state["version"] += 1
    for plan in state["plans"]:
        if plan["status"] in ("draft", "approved"):
            plan["status"] = "stale"
            plan["stale_reason"] = "事件状态已变化，请基于最新快照重新规划。"


class Store:
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get("UNDELIVERED_DB", str(ROOT / "var" / "undelivered.db")))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS drill_archives (drill_id TEXT PRIMARY KEY, archived_at TEXT NOT NULL, document TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS tool_responses (drill_id TEXT NOT NULL, call_id TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY (drill_id, call_id))")
            row = connection.execute("SELECT document FROM app_state WHERE id=1").fetchone()
            if not row:
                state = self.fresh()
                connection.execute("INSERT INTO app_state VALUES (1, ?)", (json.dumps(state, ensure_ascii=False),))
            elif json.loads(row[0]).get("schema_version", 1) < 2:
                # Back up once before updating the saved prototype state.
                backup_path = self.path.with_name(f"{self.path.stem}.v1-{uuid4().hex[:8]}.bak.db")
                with sqlite3.connect(str(backup_path)) as backup:
                    connection.backup(backup)
                state = json.loads(row[0])
                state.update({"schema_version": 2, "command_cache": {}, "planning_diagnostics": None})
                state["monitor_truth"] = initial_state()["monitor_truth"]
                for region in state["regions"]:
                    region.setdefault("recovery_kind", "deploy_portable" if region["id"] == "R12" else "repair_backhaul")
                for notice in state["notices"]:
                    candidates = [p for p in state["plans"] if p.get("executed_at", "~") <= notice["created_at"]]
                    notice.setdefault("plan_id", max(candidates, key=lambda p: p["executed_at"])["id"] if candidates else None)
                event(state, "演练数据已升级至 v0.2", "升级前数据库已保留备份，历史证据、方案与回执继续可查。")
                connection.execute("UPDATE app_state SET document=? WHERE id=1", (json.dumps(state, ensure_ascii=False),))

    def connect(self):
        return sqlite3.connect(str(self.path), timeout=15)

    @staticmethod
    def fresh():
        state = initial_state()
        state.update({"schema_version": 2, "jobs": {}, "idempotency": {}, "command_cache": {}, "planning_diagnostics": None, "counters": {"tool_calls_total": 0}})
        event(state, "云溪演练已就绪", "9 个区域链路可达，2 个区域受影响，鹿鸣村状态待核实。所有地名及监测数据均为演练合成。", "info")
        return state

    def read(self):
        with self.lock, self.connect() as connection:
            state = json.loads(connection.execute("SELECT document FROM app_state WHERE id=1").fetchone()[0])
            assert_current(state)
            return state

    def mutate(self, callback):
        return self._transaction(lambda connection, state: callback(state))

    def _transaction(self, callback):
        with self.lock, self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = json.loads(connection.execute("SELECT document FROM app_state WHERE id=1").fetchone()[0])
            assert_current(state)
            result = callback(connection, state)
            connection.execute("UPDATE app_state SET document=? WHERE id=1", (json.dumps(state, ensure_ascii=False),))
            return deepcopy(result)

    def record_tool_call(self, call, full_result):
        def change(connection, state):
            counters = state.setdefault("counters", {"tool_calls_total": len(state["tool_calls"])})
            counters["tool_calls_total"] += 1
            state["tool_calls"].insert(0, call)
            state["tool_calls"] = state["tool_calls"][:240]
            connection.execute("INSERT INTO tool_responses VALUES (?, ?, ?)", (state["drill_id"], call["id"], json.dumps(full_result, ensure_ascii=False)))
        self._transaction(change)

    def tool_response(self, call_id, drill_id):
        with self.lock, self.connect() as connection:
            row = connection.execute("SELECT document FROM tool_responses WHERE drill_id=? AND call_id=?", (drill_id, call_id)).fetchone()
            if not row:
                raise DomainError("NOT_FOUND", "该调用没有保留完整响应。旧版记录仅包含摘要。", 404)
            return json.loads(row[0])

    def reset(self):
        with self.lock, self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = json.loads(connection.execute("SELECT document FROM app_state WHERE id=1").fetchone()[0])
            assert_current(current)
            if any(job["status"] == "running" for job in current["jobs"].values()):
                raise DomainError("BUSY", "请等待当前流程结束后重置。")
            connection.execute("INSERT OR REPLACE INTO drill_archives VALUES (?, ?, ?)", (current["drill_id"], timestamp(), json.dumps(current, ensure_ascii=False)))
            connection.execute("UPDATE app_state SET document=? WHERE id=1", (json.dumps(self.fresh(), ensure_ascii=False),))

    def archives(self):
        with self.lock, self.connect() as connection:
            return [(row[0], json.loads(row[1])) for row in connection.execute("SELECT archived_at, document FROM drill_archives ORDER BY archived_at DESC, rowid DESC LIMIT 30")]

    def archive(self, drill_id):
        with self.lock, self.connect() as connection:
            row = connection.execute("SELECT document FROM drill_archives WHERE drill_id=?", (drill_id,)).fetchone()
            if not row:
                raise DomainError("NOT_FOUND", "未找到历史演练。", 404)
            return json.loads(row[0])


store = Store()
