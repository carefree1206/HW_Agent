"""Executable local drill rules, route optimization and independently checked receipts.

The four role workflows are deterministic local adapters, not model inference.
"""

import hashlib
import heapq
import json
from copy import deepcopy
from uuid import uuid4

from .store import business_changed, event, store, timestamp
from .errors import DomainError
from .planning import DEPLOY_MINUTES, RESERVE_MINUTES, solve
from .knowledge import CORPUS_HASH, DOCUMENTS as KNOWLEDGE, search as search_knowledge


def clock_after(clock, minutes):
    hour, minute = map(int, clock.split(":"))
    total = hour * 60 + minute + minutes
    return f"{total // 60 % 24:02}:{total % 60:02}"


def cached_command(state, namespace, args):
    key = f"{namespace}:{args['idempotency_key']}"
    fingerprint = hashlib.sha256(json.dumps(args, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    cached = state["command_cache"].get(key)
    if cached and cached["fingerprint"] != fingerprint:
        raise DomainError("IDEMPOTENCY_CONFLICT", "同一个幂等键已用于不同参数，请同步原请求或使用新的操作编号。")
    return key, fingerprint, deepcopy(cached["result"]) if cached else None


def save_command(state, key, fingerprint, result):
    state["command_cache"][key] = {"fingerprint": fingerprint, "result": deepcopy(result)}
    return result


def delivery_state(state):
    notice = state["notices"][-1] if state["notices"] else None
    messages = [m for m in state["messages"] if notice and m["notice_id"] == notice["id"]]
    return {"active_notice_id": notice["id"] if notice else None, "target_region_ids": notice["region_ids"] if notice else [], "messages": messages}


def get_region(state, region_id):
    region = next((r for r in state["regions"] if r["id"] == region_id), None)
    if not region:
        raise DomainError("NOT_FOUND", "区域不存在。", 404)
    return region


def get_plan(state, plan_id):
    plan = next((p for p in state["plans"] if p["id"] == plan_id), None)
    if not plan:
        raise DomainError("NOT_FOUND", "方案不存在。", 404)
    return plan


def metrics(state):
    total = len(state["regions"])
    delivery = delivery_state(state)
    messages = delivery["messages"]
    received = {m["region_id"] for m in messages if m["terminal_received_at"]}
    confirmed = {m["region_id"] for m in messages if m["human_confirmed_at"]}
    return {
        "total_regions": total,
        "online": sum(r["status"] == "online" for r in state["regions"]),
        "affected": sum(r["status"] in ("offline", "degraded") for r in state["regions"]),
        "unknown": sum(r["status"] == "unknown" for r in state["regions"]),
        "available_resources": sum(r["status"] == "available" for r in state["resources"]),
        "terminal_received": len(received), "human_confirmed": len(confirmed),
        "tool_calls": state.get("counters", {}).get("tool_calls_total", len(state["tool_calls"])),
        "reports": len(state["evidence"]),
        "targets": len(delivery["target_region_ids"]) if delivery["active_notice_id"] else total,
        "sent": sum(bool(m["sent_at"]) for m in messages), "queued": sum(not m["sent_at"] for m in messages),
        "probes_remaining": state["probe_budget"],
    }


def public_state(state=None):
    state = state or store.read()
    result = {key: deepcopy(value) for key, value in state.items() if key not in {"idempotency", "command_cache", "monitor_truth"}}
    result["metrics"] = metrics(state)
    result["app_version"] = "0.2.0"
    result["delivery"] = delivery_state(state)
    for plan in result["plans"]:
        if plan["status"] != "executed":
            plan["validation"] = validate_plan(state, plan)
    result["integrations"] = [
        {"id": "workflow", "name": "角色协作流程", "status": "local", "detail": "本地规则执行，未调用大模型"},
        {"id": "mcp", "name": "MCP 工具", "status": "local", "detail": "3 个 HTTP 服务 · 12 个业务工具"},
        {"id": "rag", "name": "知识检索", "status": "local", "detail": f"{len(KNOWLEDGE)} 条版本化规则 · 中文双字 BM25"},
        {"id": "agentarts", "name": "华为 AgentArts", "status": "pending", "detail": "待账号、API 与鉴权联调"},
        {"id": "multimodal", "name": "视觉 / SIS", "status": "pending", "detail": "支持素材保存，云端模型待接入"},
        {"id": "lora", "name": "领域 LoRA", "status": "pending", "detail": "训练尚未开展"},
    ]
    return result


def shortest_path(state, source, target):
    graph = {r["id"]: [] for r in state["regions"]}
    for edge in state["roads"]:
        if edge["open"]:
            graph[edge["from"]].append((edge["to"], edge["minutes"], edge["id"]))
            graph[edge["to"]].append((edge["from"], edge["minutes"], edge["id"]))
    queue = [(0, source, [source], [])]
    visited = set()
    while queue:
        minutes, node, nodes, edges = heapq.heappop(queue)
        if node == target:
            return {"minutes": minutes, "nodes": nodes, "edges": edges}
        if node in visited:
            continue
        visited.add(node)
        for other, cost, edge_id in graph.get(node, []):
            if other not in visited:
                heapq.heappush(queue, (minutes + cost, other, nodes + [other], edges + [edge_id]))
    return None


def _assessment(state):
    unknowns = [r for r in state["regions"] if r["status"] == "unknown"]
    stale = [e for e in state["evidence"] if e.get("stale")]
    return {
        "id": uuid4().hex[:12], "version": state["version"], "mode": "local_rules",
        "summary": f"{'、'.join(r['name'] for r in unknowns)}缺少有效链路观测，需先核实链路与供电。" if unknowns else "当前未知区域已完成核实，可依据最新道路和资源状态生成保障方案。",
        "unknown_region_ids": [r["id"] for r in unknowns],
        "affected_region_ids": [r["id"] for r in state["regions"] if r["status"] in ("offline", "degraded")],
        "evidence_ids": [e["id"] for e in state["evidence"]],
        "conflicts": [f"{e['title']}：缺少当前时效证明，不能直接用于当前通行判断。" for e in stale],
        "citations": search_knowledge("信息缺失 心跳 未知", 2),
        "next_action": "probe" if unknowns else "plan",
    }


def assess():
    def change(state):
        result = _assessment(state)
        state["assessment"] = result
        event(state, "态势分析完成", result["summary"], "info", "态势 Agent")
        return result
    return store.mutate(change)


def request_probe(args):
    def change(state):
        key, fingerprint, cached = cached_command(state, "probe", args)
        if cached is not None:
            return cached
        if args["snapshot_version"] != state["version"]:
            raise DomainError("STALE_SNAPSHOT", "事件状态已更新，请重新读取快照。")
        region = get_region(state, args["region_id"])
        if region["verified"] and region["status"] != "unknown":
            return save_command(state, key, fingerprint, {"status": "already_verified", "region_id": region["id"], "facts": {"link_status": region["status"]}, "snapshot_version": state["version"]})
        if state["probe_budget"] < 1:
            raise DomainError("BUDGET_EXCEEDED", "本轮核实预算已用尽。")
        truth = state["monitor_truth"].get(region["id"])
        if not truth:
            raise DomainError("NO_OBSERVATION", "监测节点没有返回有效观测，区域继续保持未知。")
        state["probe_budget"] -= 1
        state["simulation_time"] = clock_after(state["simulation_time"], 3)
        observed_at = state["simulation_time"]
        link_status, battery = truth["link_status"], truth["battery_minutes"]
        region.update({"status": link_status, "verified": True, "battery": battery, "last_seen": observed_at})
        state["terminal_links"][region["id"]] = link_status in {"online", "degraded"}
        link_label = {"online": "链路正常", "offline": "链路中断", "degraded": "链路拥塞"}[link_status]
        evidence = {"id": f"EV-{uuid4().hex[:6].upper()}", "region_id": region["id"], "title": "链路与供电核实结果", "modality": "probe", "source": f"演练站点控制器 {region['station_id']} · 合成传感器", "time": observed_at, "event_time": observed_at, "text": f"{region['name']}演练监测节点回报：{link_label}，备用电源剩余 {battery} 个演练分钟。", "verification": "verified_in_drill", "facts": [f"演练{link_label}", f"备用电源剩余 {battery} 分钟"], "unknown_fields": [], "stale": False}
        state["evidence"].insert(0, evidence)
        business_changed(state)
        result = {"id": f"PROBE-{uuid4().hex[:8]}", "status": "completed", "region_id": region["id"], "source_kind": "synthetic_drill_monitor", "evidence_id": evidence["id"], "facts": deepcopy(truth), "snapshot_version": state["version"]}
        state.setdefault("probes", []).append(result)
        event(state, f"{region['name']}状态已核实", f"{link_label}。已消耗 1 次核实预算，新增可追溯证据。", "warning" if link_status != "online" else "success", "核实 Agent", region["id"])
        return save_command(state, key, fingerprint, result)
    return store.mutate(change)


def plan_hash(plan):
    content = {k: plan[k] for k in ("id", "snapshot_version", "policy", "actions")}
    if "drill_id" in plan:
        content.update({k: plan[k] for k in ("drill_id", "eta_minutes", "constraints")})
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def make_plan(args):
    state = store.read()
    if args["snapshot_version"] != state["version"]:
        raise DomainError("STALE_SNAPSHOT", "请基于最新事件状态生成方案。")
    if any(r["status"] == "unknown" for r in state["regions"]):
        raise DomainError("VERIFICATION_REQUIRED", "还有未知区域，请先完成态势分析和关键核实。")
    targets = [r for r in state["regions"] if r["status"] == "offline"]
    if not targets:
        raise DomainError("NO_TASKS", "当前没有需要恢复的离线区域。", 400)
    policy = args.get("policy", "balanced")
    if policy not in {"balanced", "coverage"}:
        raise DomainError("INVALID_ARGUMENT", "未知的保障策略。", 400)
    try:
        solution = solve(state, policy, shortest_path)
    except DomainError as exc:
        def save_failure(current):
            if current["version"] != state["version"]:
                raise DomainError("STALE_SNAPSHOT", "计算期间状态已变化，请重新规划。")
            current["planning_diagnostics"] = exc.context
        store.mutate(save_failure)
        raise
    actions = solution["actions"]
    previous = state["plans"][0] if state["plans"] else None
    plan = {"id": f"PLAN-{uuid4().hex[:8].upper()}", "drill_id": state["drill_id"], "snapshot_version": state["version"], "policy": policy, "status": "draft", "created_at": timestamp(), "solver": "exhaustive_assignment+dijkstra", "solver_status": "OPTIMAL_IN_DECLARED_FINITE_MODEL", "scope": "仅对当前演练的有限队伍分配与最短路模型求解", "actions": actions, "approval_id": None, "citations": deepcopy(KNOWLEDGE[1:3]), "eta_minutes": max(a["eta_minutes"] for a in actions), "affected_people_proxy": sum(r["people"] for r in targets), "coverage_kind": "synthetic_region_graph", "unresolved": [f"{r['name']}拥塞仍需观察" for r in state['regions'] if r['status'] == 'degraded'] + ["消息接收与人员确认将在执行后独立核验"], "alternatives": solution["alternatives"], "decision_rationale": solution["decision_rationale"], "constraints": {"reserve_minutes": RESERVE_MINUTES, "one_task_per_team": True, "graph_version": state["scenario_version"]}, "comparison": {"previous_plan_id": previous["id"], "previous_eta_minutes": previous["eta_minutes"], "eta_delta_minutes": max(a["eta_minutes"] for a in actions) - previous["eta_minutes"]} if previous else None}
    plan["constraints"]["knowledge_corpus_hash"] = CORPUS_HASH
    plan["hash"] = plan_hash(plan)
    def save(current):
        if current["version"] != plan["snapshot_version"]:
            raise DomainError("STALE_SNAPSHOT", "求解期间状态已更新，请重新规划。")
        for previous_plan in current["plans"]:
            if previous_plan["status"] in {"draft", "approved"}:
                previous_plan["status"] = "superseded"
                previous_plan["stale_reason"] = "已生成新的保障方案，旧批准不可用于执行当前方案。"
        current["plans"].insert(0, plan)
        current["plans"] = current["plans"][:30]
        current["active_plan_id"] = plan["id"]
        current["planning_diagnostics"] = solution["diagnostics"]
        event(current, "保障方案已生成", f"{len(actions)} 项任务，最长预计 {plan['eta_minutes']} 个演练分钟，等待人工审查。", "info", "调度 Agent")
        return plan
    return store.mutate(save)


def validate_plan(state, plan):
    issues = []
    required = {"id", "snapshot_version", "policy", "actions", "hash", "eta_minutes"}
    if not isinstance(plan, dict) or not required <= set(plan) or not isinstance(plan["actions"], list) or not plan["actions"]:
        return {"valid": False, "issues": ["计划结构无效或没有保障任务"], "checks": [], "snapshot_version": state["version"]}
    for action in plan["actions"]:
        keys = {"region_id", "team_id", "resource_ids", "route", "deploy_minutes", "eta_minutes", "battery_required", "type"}
        if not isinstance(action, dict) or not keys <= set(action):
            return {"valid": False, "issues": ["任务结构无效"], "checks": [], "snapshot_version": state["version"]}
        if not all(isinstance(action[key], str) for key in ("region_id", "team_id", "type")):
            return {"valid": False, "issues": ["任务标识或保障方式结构无效"], "checks": [], "snapshot_version": state["version"]}
        route = action["route"]
        if not isinstance(route, dict) or not {"nodes", "edges", "minutes"} <= set(route) or not isinstance(route["nodes"], list) or not route["nodes"] or not isinstance(route["edges"], list) or not all(isinstance(i, str) for i in route["nodes"] + route["edges"]) or not isinstance(action["resource_ids"], list) or not all(isinstance(i, str) for i in action["resource_ids"]):
            return {"valid": False, "issues": ["路径或资源清单结构无效"], "checks": [], "snapshot_version": state["version"]}
        if not all(type(n) is int and n >= 0 for n in (route["minutes"], action["eta_minutes"], action["deploy_minutes"], action["battery_required"])):
            return {"valid": False, "issues": ["路径时间或电量预算无效"], "checks": [], "snapshot_version": state["version"]}
    if plan.get("drill_id", state["drill_id"]) != state["drill_id"]:
        issues.append("演练编号不一致")
    if plan.get("status") == "superseded":
        issues.append("计划快照已被新方案替代")
    if "drill_id" in plan and not isinstance(plan.get("constraints"), dict):
        return {"valid": False, "issues": ["计划缺少约束版本信息"], "checks": [], "snapshot_version": state["version"]}
    if "drill_id" in plan:
        constraints = plan["constraints"]
        if constraints.get("knowledge_corpus_hash") != CORPUS_HASH:
            issues.append("事件快照关联的规则版本已变化")
        if constraints.get("reserve_minutes") != RESERVE_MINUTES:
            issues.append("电量预留规则与当前模型不一致")
        if constraints.get("one_task_per_team") is not True:
            issues.append("资源互斥规则与当前模型不一致")
        if constraints.get("graph_version") != state["scenario_version"]:
            issues.append("路径拓扑版本与当前模型不一致")
    if state["version"] != plan["snapshot_version"]:
        issues.append("事件快照已变化")
    if plan_hash(plan) != plan["hash"]:
        issues.append("计划内容与摘要不一致")
    resources = {r["id"]: r for r in state["resources"]}
    roads = {r["id"]: r for r in state["roads"]}
    regions = {r["id"]: r for r in state["regions"]}
    targets = [a["region_id"] for a in plan["actions"]]
    if len(targets) != len(set(targets)) or set(targets) != {r["id"] for r in state["regions"] if r["status"] == "offline"}:
        issues.append("任务范围没有完整且不重复地覆盖待保障区域")
    if any(r["status"] == "unknown" for r in state["regions"]):
        issues.append("任务范围内仍存在未核实状态")
    if plan["eta_minutes"] != max(a["eta_minutes"] for a in plan["actions"]):
        issues.append("任务总预计时间不一致")
    used = set()
    for action in plan["actions"]:
        route = action["route"]
        if not route["nodes"] or route["nodes"][-1] != action["region_id"]:
            issues.append("路径终点与任务不一致")
        team = resources.get(action["team_id"])
        if not team or team["type"] != "team" or route["nodes"][0] != team["location"]:
            issues.append("队伍位置与路径不一致")
        region = regions.get(action["region_id"])
        if not region or action["type"] != region.get("recovery_kind", "repair_backhaul") or action["deploy_minutes"] != DEPLOY_MINUTES.get(action["type"]):
            issues.append("任务保障方式或部署时间与区域要求不一致")
        if action["team_id"] not in action["resource_ids"]:
            issues.append("资源清单未包含执行队伍")
        expected_travel = sum(roads[edge]["minutes"] for edge in route["edges"] if edge in roads)
        if expected_travel != route["minutes"] or action["eta_minutes"] != expected_travel + action["deploy_minutes"]:
            issues.append("路径耗时与任务预计时间不一致")
        if len(route["nodes"]) != len(route["edges"]) + 1:
            issues.append("路径节点与路段数量不一致")
        for index, edge_id in enumerate(route["edges"]):
            edge = roads.get(edge_id)
            if not edge or not edge["open"]:
                issues.append(f"路段 {edge_id} 已关闭")
            elif index + 1 >= len(route["nodes"]) or {edge["from"], edge["to"]} != {route["nodes"][index], route["nodes"][index + 1]}:
                issues.append("路径连接关系无效")
        for rid in action["resource_ids"]:
            if rid in used:
                issues.append("资源被重复分配")
            used.add(rid)
            if rid not in resources or resources[rid]["status"] != "available":
                issues.append(f"资源 {rid} 当前不可用")
        if action["type"] == "deploy_portable":
            resource = resources.get("PORTABLE-01")
            if "PORTABLE-01" not in action["resource_ids"] or action["battery_required"] != expected_travel + action["deploy_minutes"] + 20:
                issues.append("设备资源或电量预算无效")
            if not resource or resource["battery"] < action["battery_required"]:
                issues.append("便携设备电量不足")
            elif resource["location"] not in route["nodes"]:
                issues.append("路径未经过设备领取点")
    categories = [("snapshot", "演练与快照一致", ("快照", "演练编号")), ("integrity", "批准内容摘要完整", ("摘要",)), ("scope", "保障范围与方式正确", ("范围", "方式", "任务总")), ("route", "路径可达且耗时一致", ("路径", "路段", "耗时")), ("resources", "资源可用且不重复", ("资源", "队伍")), ("battery", "电量覆盖任务与预留", ("电量",))]
    checks = [{"id": key, "label": label, "passed": not any(any(word in issue for word in words) for issue in issues)} for key, label, words in categories]
    return {"valid": not issues, "issues": sorted(set(issues)), "checks": checks, "snapshot_version": state["version"]}


def approve(plan_id):
    def change(state):
        plan = get_plan(state, plan_id)
        if plan["status"] == "executed":
            raise DomainError("ALREADY_EXECUTED", "该方案已执行。")
        if plan["status"] == "superseded":
            raise DomainError("PLAN_SUPERSEDED", "已有更新的保障方案，请审查当前方案。")
        result = validate_plan(state, plan)
        if not result["valid"]:
            raise DomainError("STALE_OR_INVALID_PLAN", "；".join(result["issues"]))
        if plan["status"] == "approved":
            return plan
        plan["status"] = "approved"
        plan["approval_id"] = f"APPROVAL-{uuid4().hex[:10]}"
        plan["approved_at"] = timestamp()
        event(state, "方案已获人工批准", f"批准记录已绑定 {plan['id']} 与事件快照 v{plan['snapshot_version']}。", "success", "演练操作者")
        return plan
    return store.mutate(change)


def dispatch(args):
    def change(state):
        plan = get_plan(state, args["plan_id"])
        if plan["status"] == "superseded":
            raise DomainError("PLAN_SUPERSEDED", "已有更新的保障方案，旧批准不可用于执行。")
        if not args.get("approval_id") or args["approval_id"] != plan["approval_id"]:
            raise DomainError("APPROVAL_REQUIRED", "批准记录与当前方案不匹配。")
        key, fingerprint, cached = cached_command(state, "dispatch", args)
        if cached is not None:
            return cached
        if plan["status"] == "executed":
            return save_command(state, key, fingerprint, {"plan_id": plan["id"], "status": "already_executed", "task_ids": [a["id"] for a in plan["actions"]]})
        if plan["status"] == "stale":
            raise DomainError("STALE_OR_INVALID_PLAN", "事件快照已变化，旧方案不可执行，请重新规划。")
        if plan["status"] != "approved" or not args.get("approval_id") or args["approval_id"] != plan["approval_id"]:
            raise DomainError("APPROVAL_REQUIRED", "请先由演练操作者批准当前方案。")
        check = validate_plan(state, plan)
        if not check["valid"]:
            raise DomainError("STALE_OR_INVALID_PLAN", "；".join(check["issues"]))
        start_hour, start_minute = map(int, state["simulation_time"].split(":"))
        def finish_time(duration):
            total = start_hour * 60 + start_minute + duration
            return f"{total // 60 % 24:02}:{total % 60:02}"
        for action in plan["actions"]:
            region = get_region(state, action["region_id"])
            region.update({"status": "online", "verified": True, "last_seen": finish_time(action["eta_minutes"])})
            state["terminal_links"][region["id"]] = True
            # Keep the approved action payload immutable for digest verification.
            for resource in state["resources"]:
                if resource["id"] in action["resource_ids"]:
                    resource["status"] = "deployed"
                    resource["location"] = region["id"]
                    if resource["type"] == "portable":
                        resource["battery"] -= action["battery_required"] - 20
        plan["status"] = "executed"
        plan["executed_at"] = timestamp()
        plan["execution_results"] = [{"action_id": a["id"], "status": "completed_in_simulation", "finished_at_simulation": finish_time(a["eta_minutes"])} for a in plan["actions"]]
        state["simulation_time"] = finish_time(plan["eta_minutes"])
        business_changed(state)
        result = {"plan_id": plan["id"], "status": "completed_in_simulation", "task_ids": [a["id"] for a in plan["actions"]], "note": "资源投放与链路恢复为图模型仿真；消息回执独立由软件终端产生。"}
        event(state, "演练保障任务已完成", f"图模型中的 {len(plan['actions'])} 处链路已恢复。消息尚需终端接收和人员确认。", "success", "核验 Agent")
        return save_command(state, key, fingerprint, result)
    return store.mutate(change)


def publish_notice(args):
    def change(state):
        plan = get_plan(state, args["plan_id"])
        if plan["status"] != "executed" or args.get("approval_id") != plan["approval_id"]:
            raise DomainError("APPROVAL_REQUIRED", "演练消息需关联已批准并完成的方案。")
        region_ids = args.get("region_ids", [r["id"] for r in state["regions"]])
        if not region_ids or len(region_ids) != len(set(region_ids)):
            raise DomainError("INVALID_ARGUMENT", "通知目标不能为空或包含重复区域。", 400)
        for rid in region_ids:
            get_region(state, rid)
        normalized = {**args, "region_ids": sorted(region_ids)}
        key, fingerprint, cached = cached_command(state, "notice", normalized)
        if cached is not None:
            return cached
        if args["idempotency_key"] == f"ui-notice:{plan['id']}":
            existing = next((n for n in state["notices"] if n.get("plan_id") == plan["id"] and sorted(n["region_ids"]) == sorted(region_ids)), None)
            if existing:
                return save_command(state, key, fingerprint, {"notice_id": existing["id"], "target_count": len(region_ids), "status": "already_published"})
        notice_id = f"NOTICE-{uuid4().hex[:8]}"
        for rid in region_ids:
            state["messages"].append({"id": f"MSG-{uuid4().hex[:10]}", "notice_id": notice_id, "region_id": rid, "text": "【通信保障演练】本区域通信保障任务已完成。请终端接收演练消息，并由现场演练操作者确认。此消息不代表实际灾害处置通知。", "created_at": timestamp(), "sent_at": timestamp() if state["terminal_links"].get(rid) else None, "terminal_received_at": None, "human_confirmed_at": None, "client_id": None, "status": "sent" if state["terminal_links"].get(rid) else "queued"})
        state["notices"].append({"id": notice_id, "plan_id": plan["id"], "region_ids": region_ids, "created_at": timestamp()})
        state["agent_stages"]["verify"] = "waiting"
        result = {"notice_id": notice_id, "target_count": len(region_ids), "status": "published", "terminal_received": 0, "human_confirmed": 0}
        event(state, "演练消息已进入发送队列", f"{len(region_ids)} 个目标终端，实际接收和人员确认独立记录。", "info", "核验 Agent")
        return save_command(state, key, fingerprint, result)
    return store.mutate(change)


def receipt(message_id, region_id, stage, client_id):
    if stage not in {"terminal_received", "human_confirmed"} or not client_id:
        raise DomainError("INVALID_ARGUMENT", "回执阶段或终端标识无效。", 400)
    def change(state):
        message = next((m for m in state["messages"] if m["id"] == message_id and m["region_id"] == region_id), None)
        if not message:
            raise DomainError("NOT_FOUND", "该终端没有对应消息。", 404)
        if not state["terminal_links"].get(region_id):
            raise DomainError("TERMINAL_OFFLINE", "演练终端当前离线，恢复连接后可补发回执。", 503)
        if stage == "human_confirmed" and not message["terminal_received_at"]:
            raise DomainError("RECEIPT_REQUIRED", "请先由终端实际接收消息。")
        field = f"{stage}_at"
        if not message[field]:
            if not message["sent_at"]:
                message["sent_at"] = timestamp()
            message[field] = timestamp()
            message["client_id"] = client_id
            message["status"] = stage
            region = get_region(state, region_id)
            event(state, f"{region['name']} · {'人员已确认' if stage == 'human_confirmed' else '终端已接收'}", "此回执由演练终端请求实际写入。", "success", "演练终端", region_id)
            if stage == "human_confirmed" and delivery_state(state)["active_notice_id"] == message["notice_id"]:
                current = metrics(state)
                complete = current["human_confirmed"] == current["targets"]
                state["agent_stages"]["verify"] = "completed" if complete else "waiting"
                state["traces"].insert(0, {"id": f"LOCAL-{uuid4().hex[:12]}", "stage": "verify", "status": "completed" if complete else "waiting", "title": "收到人员确认回执", "detail": f"本轮已确认 {current['human_confirmed']}/{current['targets']} 个区域。", "references": [message["id"]], "at": timestamp(), "mode": "local_rules"})
                state["traces"] = state["traces"][:160]
        return message
    return store.mutate(change)


def add_report(text, region_id, modality="text", attachment=None):
    text = text.strip()
    if not text and not attachment:
        raise DomainError("INVALID_ARGUMENT", "请填写报告或选择素材。", 400)
    def change(state):
        region = get_region(state, region_id)
        stale = any(word in text for word in ("昨天", "旧照", "昨晚", "前天"))
        uncertain = any(word in text for word in ("不清楚", "没确认", "待核实", "不确定", "不知道"))
        evidence = {"id": f"EV-{uuid4().hex[:6].upper()}", "region_id": region_id, "title": "现场图像报告" if modality == "image" else "语音素材报告" if modality == "audio" else "现场文字报告", "modality": modality, "source": "演练操作者上传", "time": state["simulation_time"], "event_time": None if stale or uncertain else state["simulation_time"], "text": text or "素材已保存，云端视觉/语音模型尚未接入，请补充人工描述。", "verification": "reported", "unknown_fields": (["当前时效"] if stale else []) + (["报告中未确认的状态"] if uncertain else []) + (["模型自动解析结果"] if attachment else []), "facts": ["人工报告已记录"], "stale": stale, "attachment": attachment, "extraction_mode": "local_keyword_rules"}
        state["evidence"].insert(0, evidence)
        region["reports"] += 1
        business_changed(state)
        event(state, "新的现场证据已入库", f"{region['name']}：{evidence['text'][:90]}", "warning" if stale else "info", "演练操作者", region_id)
        return evidence
    return store.mutate(change)


def inject(kind):
    def change(state):
        if kind == "road":
            road = next(r for r in state["roads"] if r["id"] == "RD14")
            road["open"] = not road["open"]
            title = "南湾—鹿鸣路段" + ("已恢复" if road["open"] else "中断")
            detail = "道路状态已改变，旧方案需要重新校验，路径将重新计算。"
        elif kind == "battery":
            resource = next(r for r in state["resources"] if r["id"] == "PORTABLE-01")
            resource["battery"] = 15 if resource["battery"] > 15 else 180
            title = "便携设备电量已调整"
            detail = f"当前剩余 {resource['battery']} 个演练分钟。"
        else:
            raise DomainError("INVALID_ARGUMENT", "不支持的演练事件。", 400)
        business_changed(state)
        event(state, title, detail, "warning", "演练事件注入")
        return {"title": title, "snapshot_version": state["version"]}
    return store.mutate(change)


def terminal_link(region_id, online):
    def change(state):
        region = get_region(state, region_id)
        state["terminal_links"][region_id] = online
        event(state, f"{region['name']}演练终端{'恢复连接' if online else '离线'}", "应用层网络故障注入；离线期间回执请求返回不可用。", "info" if online else "warning", "演练操作者", region_id)
        return {"region_id": region_id, "online": online}
    return store.mutate(change)
