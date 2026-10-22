"""Synthetic drill topology. No geographical or radio coverage claim is implied."""

from copy import deepcopy
from uuid import uuid4

REGIONS = [
    {"id": "R01", "name": "松林乡", "x": 152, "y": 125, "people": 860, "status": "online", "kind": "village", "station_id": "S01"},
    {"id": "R02", "name": "青石村", "x": 326, "y": 93, "people": 420, "status": "online", "kind": "village", "station_id": "S02"},
    {"id": "R03", "name": "云溪县城", "x": 458, "y": 207, "people": 4200, "status": "online", "kind": "center", "station_id": "S03"},
    {"id": "R04", "name": "白鹭镇", "x": 641, "y": 131, "people": 1230, "status": "online", "kind": "town", "station_id": "S04"},
    {"id": "R05", "name": "东桥村", "x": 778, "y": 244, "people": 560, "status": "online", "kind": "village", "station_id": "S05"},
    {"id": "R06", "name": "南湾村", "x": 629, "y": 340, "people": 780, "status": "online", "kind": "village", "station_id": "S04"},
    {"id": "R07", "name": "河畔社区", "x": 408, "y": 367, "people": 1160, "status": "online", "kind": "town", "station_id": "S03"},
    {"id": "R08", "name": "翠竹村", "x": 214, "y": 298, "people": 360, "status": "online", "kind": "village", "station_id": "S06"},
    {"id": "R09", "name": "南山村", "x": 114, "y": 448, "people": 290, "status": "online", "kind": "village", "station_id": "S06"},
    {"id": "R10", "name": "新桥镇", "x": 465, "y": 500, "people": 930, "status": "degraded", "kind": "town", "station_id": "S07"},
    {"id": "R11", "name": "溪口村", "x": 683, "y": 468, "people": 510, "status": "offline", "kind": "village", "station_id": "S08"},
    {"id": "R12", "name": "鹿鸣村", "x": 824, "y": 392, "people": 286, "status": "unknown", "kind": "village", "station_id": "S08"},
]

_EDGES = [
    ("R01", "R02", 12), ("R01", "R08", 14), ("R02", "R03", 10),
    ("R02", "R04", 18), ("R03", "R04", 12), ("R03", "R07", 9),
    ("R03", "R08", 15), ("R04", "R05", 11), ("R04", "R06", 16),
    ("R05", "R06", 10), ("R05", "R12", 18), ("R06", "R07", 13),
    ("R06", "R11", 10), ("R06", "R12", 12), ("R07", "R10", 12),
    ("R08", "R09", 11), ("R10", "R11", 13), ("R11", "R12", 9),
]


def initial_state():
    regions = deepcopy(REGIONS)
    for region in regions:
        region.update({"last_seen": "01:37" if region["id"] == "R12" else "02:16", "reports": 1 if region["id"] == "R10" else 0, "verified": region["status"] == "online", "recovery_kind": "deploy_portable" if region["id"] == "R12" else "repair_backhaul"})
    return {
        "drill_id": f"DRILL-{uuid4().hex[:12].upper()}",
        "title": "云溪县 · 暴雨通信保障演练",
        "scenario_version": "yunxi-1.0",
        "version": 1,
        "simulation_time": "02:17",
        "mode": "local_rules",
        # Kept separate from visible observations, and never returned to the client.
        "monitor_truth": {r["id"]: {"link_status": "offline" if r["id"] == "R12" else r["status"], "battery_minutes": 35 if r["id"] == "R12" else 90 if r["id"] == "R11" else 120 if r["id"] == "R10" else 240} for r in REGIONS},
        "regions": regions,
        "roads": [{"id": f"RD{i + 1:02}", "from": a, "to": b, "minutes": minutes, "open": True} for i, (a, b, minutes) in enumerate(_EDGES)],
        "resources": [
            {"id": "TEAM-01", "name": "通信保障一队", "type": "team", "location": "R03", "status": "available", "capacity": 1, "icon": "users"},
            {"id": "TEAM-02", "name": "通信保障二队", "type": "team", "location": "R07", "status": "available", "capacity": 1, "icon": "users"},
            {"id": "PORTABLE-01", "name": "便携通信设备", "type": "portable", "location": "R03", "status": "available", "battery": 180, "icon": "radio"},
            {"id": "POWER-01", "name": "移动电源", "type": "power", "location": "R03", "status": "available", "battery": 240, "icon": "battery"},
        ],
        "evidence": [
            {"id": "EV-001", "region_id": "R12", "title": "站点心跳停止更新", "modality": "telemetry", "source": "演练监测节点 S08", "time": "02:17", "event_time": "01:37", "text": "鹿鸣村最后一次心跳为 01:37，连续 40 个演练分钟未收到更新。当前链路及供电状态待核实。", "verification": "observed", "unknown_fields": ["链路状态", "剩余电量"], "facts": ["心跳缺失 40 分钟"], "stale": False},
            {"id": "EV-002", "region_id": "R11", "title": "溪口村链路异常", "modality": "telemetry", "source": "演练监测节点 S08", "time": "02:13", "event_time": "02:13", "text": "演练链路接口返回连接失败，需要通信保障。", "verification": "observed", "unknown_fields": [], "facts": ["节点链路异常"], "stale": False},
            {"id": "EV-003", "region_id": "R10", "title": "新桥镇网络拥塞", "modality": "text", "source": "现场演练报告", "time": "02:11", "event_time": "02:11", "text": "新桥镇网络连接间歇中断，文字消息可低速传输。", "verification": "reported", "unknown_fields": ["拥塞原因"], "facts": ["连接质量下降"], "stale": False},
        ],
        "assessment": None,
        "plans": [],
        "active_plan_id": None,
        "messages": [],
        "notices": [],
        "terminal_links": {r["id"]: r["status"] in ("online", "degraded") for r in regions},
        "agent_stages": {"assess": "idle", "probe": "idle", "plan": "idle", "verify": "idle"},
        "probe_budget": 2,
        "events": [],
        "traces": [],
        "tool_calls": [],
    }
