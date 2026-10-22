"""Finite, deterministic scheduling model. Returns explanations alongside decisions."""
import itertools
from copy import deepcopy

from .errors import DomainError

RESERVE_MINUTES = 20
DEPLOY_MINUTES = {"deploy_portable": 10, "repair_backhaul": 12}


def solve(state, policy, route_fn):
    targets = [r for r in state["regions"] if r["status"] == "offline"]
    teams = [r for r in state["resources"] if r["type"] == "team" and r["status"] == "available"]
    portable = next((r for r in state["resources"] if r["type"] == "portable"), None)
    diagnostics = {"status": "infeasible", "snapshot_version": state["version"], "drill_id": state["drill_id"], "reasons": [], "suggestions": [], "assignments_checked": 0, "feasible_count": 0}
    choices = {}

    def reject(code, detail, **fields):
        diagnostics["reasons"].append({"code": code, "detail": detail, **fields})

    if len(teams) < len(targets):
        reject("TEAM_SHORTFALL", f"需 {len(targets)} 支队伍，当前仅 {len(teams)} 支可用。", required=len(targets), available=len(teams))
        diagnostics["suggestions"].append("补充保障队伍，或人工缩小本时窗保障范围后再规划。")

    for target in targets:
        for team in teams:
            fields = {"region_id": target["id"], "region_name": target["name"], "team_id": team["id"], "team_name": team["name"]}
            kind = target.get("recovery_kind", "repair_backhaul")
            needs_device = kind == "deploy_portable"
            if kind not in DEPLOY_MINUTES:
                reject("UNKNOWN_RECOVERY", f"{target['name']}的保障方式尚未定义。", **fields)
                continue
            if needs_device and (portable is None or portable["status"] != "available"):
                reject("DEVICE_UNAVAILABLE", f"{target['name']}需要便携设备，当前没有可用设备。", **fields)
                continue
            if needs_device:
                first = route_fn(state, team["location"], portable["location"])
                last = route_fn(state, portable["location"], target["id"])
                route = {"minutes": first["minutes"] + last["minutes"], "nodes": first["nodes"] + last["nodes"][1:], "edges": first["edges"] + last["edges"]} if first and last else None
            else:
                route = route_fn(state, team["location"], target["id"])
            if not route:
                reject("ROAD_UNREACHABLE", f"{team['name']}到{target['name']}没有可通行路径。", **fields)
                continue
            deploy = DEPLOY_MINUTES[kind]
            required = route["minutes"] + deploy + RESERVE_MINUTES if needs_device else 0
            if needs_device and portable["battery"] < required:
                reject("BATTERY_SHORTFALL", f"{team['name']}保障{target['name']}需 {required} 分钟电量，现有 {portable['battery']} 分钟，缺少 {required - portable['battery']} 分钟。", required_minutes=required, available_minutes=portable["battery"], shortfall_minutes=required-portable["battery"], **fields)
                continue
            choices[target["id"], team["id"]] = {"region_id": target["id"], "region_name": target["name"], "team_id": team["id"], "team_name": team["name"], "type": kind, "title": "部署便携通信节点" if needs_device else "修复演练回传链路", "resource_ids": [team["id"]] + ([portable["id"]] if needs_device else []), "route": route, "deploy_minutes": deploy, "eta_minutes": route["minutes"] + deploy, "battery_required": required, "status": "planned"}

    candidates = []
    weights = {r["id"]: r["people"] for r in targets}
    for assignment in itertools.permutations(teams, len(targets)):
        diagnostics["assignments_checked"] += 1
        actions = [deepcopy(choices.get((target["id"], team["id"]))) for target, team in zip(targets, assignment)]
        if not all(actions):
            continue
        resource_ids = [rid for action in actions for rid in action["resource_ids"]]
        if len(resource_ids) != len(set(resource_ids)):
            reject("RESOURCE_CONFLICT", "同一设备被分配给多个同时进行的任务。")
            continue
        for index, action in enumerate(actions):
            action["id"] = f"ACT-{index + 1}"
        max_eta = max(a["eta_minutes"] for a in actions)
        travel = sum(a["route"]["minutes"] for a in actions)
        weighted_wait = sum(weights[a["region_id"]] * a["eta_minutes"] for a in actions)
        score = max_eta if policy == "balanced" else weighted_wait
        margins = [portable["battery"] - a["battery_required"] for a in actions if a["battery_required"]]
        candidates.append({"score": score, "eta_minutes": max_eta, "travel_minutes": travel, "weighted_wait_minutes": weighted_wait, "safety_margin_minutes": min(margins) if margins else None, "actions": actions})
    diagnostics["feasible_count"] = len(candidates)
    if not candidates:
        minimum = min((r["required_minutes"] for r in diagnostics["reasons"] if r["code"] == "BATTERY_SHORTFALL"), default=None)
        if minimum is not None:
            diagnostics["suggestions"].append(f"至少一种可达分配需要 {minimum} 分钟设备电量（含 {RESERVE_MINUTES} 分钟预留）；补充电量后仍须重新校验全部约束。")
        if any(r["code"] == "ROAD_UNREACHABLE" for r in diagnostics["reasons"]):
            diagnostics["suggestions"].append("核实并恢复路段通行，或补充其他部署方式；当前图模型无法给出可达路线。")
        if any(r["code"] == "DEVICE_UNAVAILABLE" for r in diagnostics["reasons"]):
            diagnostics["suggestions"].append("核实设备占用并补充可用便携设备。")
        details = diagnostics["reasons"][0]["detail"] if diagnostics["reasons"] else "资源分配不满足当前约束。"
        raise DomainError("INFEASIBLE", details, context=diagnostics)
    candidates.sort(key=lambda c: (c["score"], c["travel_minutes"]))
    diagnostics["status"] = "feasible"
    best = candidates[0]
    alternatives = [{"id": f"C{index+1}", "selected": index == 0, "eta_minutes": c["eta_minutes"], "travel_minutes": c["travel_minutes"], "weighted_wait_minutes": c["weighted_wait_minutes"], "safety_margin_minutes": c["safety_margin_minutes"], "assignments": [{"region_name": a["region_name"], "team_name": a["team_name"], "eta_minutes": a["eta_minutes"]} for a in c["actions"]]} for index, c in enumerate(candidates)]
    return {"actions": best["actions"], "alternatives": alternatives, "diagnostics": diagnostics, "decision_rationale": f"已遍历 {diagnostics['assignments_checked']} 种队伍分配，其中 {len(candidates)} 种可行。按{'最晚恢复时间' if policy == 'balanced' else '人口加权等待时间'}选取首位，最长预计 {best['eta_minutes']} 分钟，总行程 {best['travel_minutes']} 分钟。"}
