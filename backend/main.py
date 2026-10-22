import asyncio
import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Literal
from uuid import uuid4

import httpx
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import engine
from .engine import DomainError
from .knowledge import CORPUS_HASH, search as search_knowledge
from .store import ROOT, EXPECTED_DRILL, drill_scope, event, store, timestamp


def recover_interrupted_jobs():
    def recover(current):
        interrupted = [job for job in current["jobs"].values() if job["status"] == "running"]
        for job in interrupted:
            job.update({"status": "failed", "error": "服务重启中断了本轮流程，请基于当前快照重新运行。", "finished_at": timestamp()})
        if interrupted:
            for stage, status in current["agent_stages"].items():
                if status == "running":
                    current["agent_stages"][stage] = "error"
            event(current, "已恢复重启前的演练状态", "未完成流程标记为中断，已保存的证据、方案与回执仍可检查。", "warning")
    store.mutate(recover)


recover_interrupted_jobs()
app = FastAPI(title="未送达 · 本地演练 API", version="0.2.0")
ASSETS = store.path.parent / "uploads"
ASSETS.mkdir(parents=True, exist_ok=True)
INTERNAL_URL = os.environ.get("UNDELIVERED_INTERNAL_URL", "http://127.0.0.1:8000")
TASKS = set()


@app.middleware("http")
async def request_context(request: Request, call_next):
    if request.url.path.startswith(("/api/", "/mcp/")):
        origin = request.headers.get("origin")
        port = request.url.port or 80
        allowed = {f"http://{host}:{p}" for host in ("127.0.0.1", "localhost") for p in (port, 5173)}
        allowed.update(x.strip() for x in os.environ.get("UNDELIVERED_ALLOWED_ORIGINS", "").split(",") if x.strip())
        if origin and origin not in allowed:
            return JSONResponse(status_code=403, content={"error": "ORIGIN_REJECTED", "detail": "请求来源不在本地演练允许范围。"})
        expected = request.headers.get("X-Drill-ID")
        if request.url.path.startswith("/api/") and request.method in {"POST", "PUT", "PATCH", "DELETE"} and (origin or request.headers.get("Sec-Fetch-Site")) and not expected:
            return JSONResponse(status_code=409, content={"error": "REFRESH_REQUIRED", "detail": "页面版本已更新，请刷新页面后再操作。"})
        if not expected and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            expected = store.read()["drill_id"]
        with drill_scope(expected):
            response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
    else:
        response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError):
    return JSONResponse(status_code=exc.status, content={"error": exc.code, "detail": exc.message, "context": exc.context})


def schema(properties, required=()):
    fields = {k: {"type": v} for k, v in properties.items()}
    for name, definition in fields.items():
        if definition["type"] == "array":
            definition.update({"items": {"type": "string"}, "minItems": 1, "uniqueItems": True})
        if name == "policy":
            definition["enum"] = ["balanced", "coverage"]
        if name == "snapshot_version":
            definition["minimum"] = 1
    return {"type": "object", "properties": fields, "required": list(required), "additionalProperties": False}


TOOLS = {
    "observation": [
        {"name": "obs_get_snapshot", "description": "读取当前演练可见状态，不提供隐藏真值。", "inputSchema": schema({})},
        {"name": "obs_query_station", "description": "查询指定站点在演练状态中的观测。", "inputSchema": schema({"station_id": "string"}, ["station_id"])},
        {"name": "obs_query_route", "description": "查询当前道路开放状态。", "inputSchema": schema({})},
        {"name": "obs_get_evidence", "description": "读取已记录证据与来源。", "inputSchema": schema({"region_id": "string"})},
        {"name": "obs_request_probe", "description": "在预算内核实演练区域，返回合成监测节点结果；会改变业务快照。", "inputSchema": schema({"region_id": "string", "snapshot_version": "integer", "idempotency_key": "string"}, ["region_id", "snapshot_version", "idempotency_key"])},
        {"name": "obs_get_probe_result", "description": "读取已完成的核实任务。", "inputSchema": schema({"probe_id": "string"}, ["probe_id"])},
    ],
    "planning": [
        {"name": "plan_get_resources", "description": "读取队伍、设备位置、电量和占用状态。", "inputSchema": schema({})},
        {"name": "plan_optimize", "description": "对有限队伍分配枚举并求最短路，在当前约束下生成演练方案。", "inputSchema": schema({"snapshot_version": "integer", "policy": "string"}, ["snapshot_version"])},
        {"name": "plan_validate", "description": "独立检查方案版本、路径、资源占用和电量。", "inputSchema": schema({"plan_id": "string"}, ["plan_id"])},
    ],
    "delivery": [
        {"name": "delivery_dispatch_drill", "description": "执行有人工批准记录的演练方案；资源部署为仿真。", "inputSchema": schema({"plan_id": "string", "approval_id": "string", "idempotency_key": "string"}, ["plan_id", "approval_id", "idempotency_key"])},
        {"name": "delivery_publish_notice", "description": "为已获准演练方案发布测试消息，接收及人员确认由真实终端独立回报。", "inputSchema": schema({"plan_id": "string", "approval_id": "string", "idempotency_key": "string", "region_ids": "array"}, ["plan_id", "approval_id", "idempotency_key"])},
        {"name": "delivery_query_receipts", "description": "查询测试消息各阶段的实际软件回执。", "inputSchema": schema({})},
    ],
}


def tool_action(name, args):
    state = store.read()
    if name == "obs_get_snapshot":
        return {"drill_id": state["drill_id"], "version": state["version"], "simulation_time": state["simulation_time"], "regions": state["regions"], "evidence": state["evidence"], "probe_budget": state["probe_budget"]}
    if name == "obs_query_station":
        matches = [r for r in state["regions"] if r["station_id"] == args["station_id"]]
        if not matches:
            raise DomainError("NOT_FOUND", "未找到站点。", 404)
        return {"station_id": args["station_id"], "regions": matches, "source_kind": "synthetic_drill_state"}
    if name == "obs_query_route":
        return {"roads": state["roads"], "snapshot_version": state["version"]}
    if name == "obs_get_evidence":
        return {"evidence": [e for e in state["evidence"] if not args.get("region_id") or e["region_id"] == args["region_id"]]}
    if name == "obs_request_probe":
        return engine.request_probe(args)
    if name == "obs_get_probe_result":
        result = next((p for p in state.get("probes", []) if p["id"] == args["probe_id"]), None)
        if not result:
            raise DomainError("NOT_FOUND", "未找到核实任务。", 404)
        return result
    if name == "plan_get_resources":
        return {"resources": state["resources"], "snapshot_version": state["version"]}
    if name == "plan_optimize":
        return engine.make_plan(args)
    if name == "plan_validate":
        return engine.validate_plan(state, engine.get_plan(state, args["plan_id"]))
    if name == "delivery_dispatch_drill":
        return engine.dispatch(args)
    if name == "delivery_publish_notice":
        return engine.publish_notice(args)
    if name == "delivery_query_receipts":
        return {**engine.delivery_state(state), "metrics": engine.metrics(state)}
    raise DomainError("INVALID_TOOL", "工具不存在。", 404)


def validate_tool_args(tool, args):
    if not isinstance(args, dict):
        raise DomainError("INVALID_ARGUMENT", "工具参数应为对象。", 400)
    definition = tool["inputSchema"]
    if set(args) - set(definition["properties"]):
        raise DomainError("INVALID_ARGUMENT", "包含未声明的工具参数。", 400)
    for field in definition["required"]:
        if field not in args:
            raise DomainError("INVALID_ARGUMENT", f"缺少参数 {field}。", 400)
    for field, value in args.items():
        kind = definition["properties"][field]["type"]
        valid = (kind == "string" and isinstance(value, str) and 0 < len(value) <= 200) or (kind == "integer" and type(value) is int) or (kind == "array" and isinstance(value, list) and all(isinstance(item, str) for item in value))
        if not valid:
            raise DomainError("INVALID_ARGUMENT", f"参数 {field} 类型或内容无效。", 400)


@app.post("/mcp/{service}")
async def mcp_endpoint(service: str, request: Request):
    if service not in TOOLS:
        return JSONResponse(status_code=404, content={"error": "MCP service not found"})
    if "application/json" not in request.headers.get("content-type", ""):
        return JSONResponse(status_code=415, content={"error": "application/json required"})
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
    if not isinstance(body, dict) or body.get("jsonrpc") != "2.0":
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}})
    rid, method = body.get("id"), body.get("method")
    if not isinstance(method, str) or (rid is not None and type(rid) not in (str, int)):
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid id or method"}})
    if method != "initialize" and request.headers.get("MCP-Protocol-Version", "2025-11-25") != "2025-11-25":
        return JSONResponse(status_code=400, content={"error": "Unsupported protocol version"})
    if not isinstance(body.get("params", {}), dict):
        return JSONResponse({"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": "Params must be an object"}})
    if method == "notifications/initialized":
        return Response(status_code=202)
    if rid is None:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Request id required"}})
    if method == "initialize":
        result = {"protocolVersion": "2025-11-25", "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": f"undelivered-{service}", "version": "0.2.0"}, "instructions": "Local synthetic drill. No cloud model inference or real radio deployment."}
    elif method == "tools/list":
        result = {"tools": TOOLS[service]}
    elif method == "ping":
        result = {}
    elif method == "tools/call":
        params = body.get("params", {})
        name, args = params.get("name"), params.get("arguments", {})
        tool = next((t for t in TOOLS[service] if t["name"] == name), None)
        if not tool:
            return JSONResponse({"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": "Unknown tool"}})
        started = time.perf_counter()
        error = None
        try:
            validate_tool_args(tool, args)
            output = tool_action(name, args)
            result = {"content": [{"type": "text", "text": json.dumps(output, ensure_ascii=False)}], "structuredContent": output, "isError": False}
        except DomainError as exc:
            error = exc.code
            output = {"error": exc.code, "detail": exc.message, "context": exc.context}
            result = {"content": [{"type": "text", "text": exc.message}], "structuredContent": output, "isError": True}
        duration = round((time.perf_counter() - started) * 1000, 2)
        if name == "obs_get_snapshot" and not error:
            summary = {"version": output["version"], "regions": len(output["regions"]), "evidence": len(output["evidence"])}
        else:
            summary = output
        result_text = json.dumps(summary, ensure_ascii=False)
        content_hash = hashlib.sha256(json.dumps(output, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        call = {"id": f"CALL-{uuid4().hex[:12]}", "request_id": str(rid), "service": service, "tool": name, "arguments": args, "status": "error" if error else "success", "at": timestamp(), "duration_ms": duration, "transport": "HTTP JSON-RPC", "result": result_text[:4000], "result_hash": content_hash, "result_truncated": len(result_text) > 4000, "result_summary": name == "obs_get_snapshot"}
        store.record_tool_call(call, output)
    else:
        return JSONResponse({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "Method not found"}})
    return JSONResponse({"jsonrpc": "2.0", "id": rid, "result": result})


@app.api_route("/mcp/{service}", methods=["GET", "DELETE"])
def mcp_no_stream(service: str):
    if service not in TOOLS:
        return JSONResponse(status_code=404, content={"error": "MCP service not found"})
    return JSONResponse(status_code=405, headers={"Allow": "POST"}, content={"detail": "Stateless JSON responses only; SSE and session deletion are not supported."})


async def call_tool(service, tool, arguments=None):
    drill_id = EXPECTED_DRILL.get() or store.read()["drill_id"]
    async with httpx.AsyncClient(timeout=20, trust_env=False, headers={"X-Drill-ID": drill_id, "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25"}) as client:
        endpoint = f"{INTERNAL_URL}/mcp/{service}"
        initialized = await client.post(endpoint, json={"jsonrpc": "2.0", "id": f"INIT-{uuid4().hex[:8]}", "method": "initialize", "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "undelivered-local-workflow", "version": "0.1.0"}}})
        initialized.raise_for_status()
        await client.post(endpoint, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
        response = await client.post(f"{INTERNAL_URL}/mcp/{service}", json={"jsonrpc": "2.0", "id": f"LOCAL-{uuid4().hex[:12]}", "method": "tools/call", "params": {"name": tool, "arguments": arguments or {}}}, headers={"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25"})
        payload = response.json()
        if response.status_code == 409 and payload.get("error") == "DRILL_CHANGED":
            raise DomainError("DRILL_CHANGED", payload["detail"])
        response.raise_for_status()
    if "error" in payload:
        raise DomainError("MCP_ERROR", payload["error"]["message"])
    result = payload["result"]
    if result.get("isError"):
        error = result["structuredContent"]
        raise DomainError(error["error"], error["detail"], context=error.get("context"))
    return result["structuredContent"]


def trace(stage, status, title, detail, references=None):
    def change(state):
        state["agent_stages"][stage] = status
        row = {"id": f"LOCAL-{uuid4().hex[:12]}", "stage": stage, "status": status, "title": title, "detail": detail, "references": references or [], "at": timestamp(), "mode": "local_rules"}
        state["traces"].insert(0, row)
        state["traces"] = state["traces"][:160]
    store.mutate(change)


async def run_pipeline(job_id, policy, drill_id):
    with drill_scope(drill_id):
        try:
            await _run_pipeline(job_id, policy)
        except DomainError as exc:
            if exc.code != "DRILL_CHANGED":
                raise


async def _run_pipeline(job_id, policy):
    current_stage = "assess"
    try:
        trace("assess", "running", "读取多源证据", "经本地 HTTP MCP 读取快照；采用可解释规则处理。")
        snapshot = await call_tool("observation", "obs_get_snapshot")
        analysis = engine.assess()
        trace("assess", "completed", "已识别信息空白", analysis["summary"], analysis["evidence_ids"])
        current_stage = "probe"
        trace("probe", "running", "核实关键未知项", "按缺失心跳与未知状态筛选核实对象。")
        for region_id in analysis["unknown_region_ids"]:
            snapshot = await call_tool("observation", "obs_get_snapshot")
            await call_tool("observation", "obs_request_probe", {"region_id": region_id, "snapshot_version": snapshot["version"], "idempotency_key": f"{job_id}:{region_id}"})
        trace("probe", "completed", "关键状态已核实", "核实结果来自合成演练监测节点，可追溯到新增证据。" if analysis["unknown_region_ids"] else "已有有效观测，本轮不重复消耗核实预算。")
        current_stage = "plan"
        trace("plan", "running", "计算资源与路径", "实际查询道路和资源，枚举队伍分配，计算开放道路上的最短路。")
        snapshot = await call_tool("observation", "obs_get_snapshot")
        await call_tool("observation", "obs_query_route")
        await call_tool("planning", "plan_get_resources")
        if not any(r["status"] == "offline" for r in snapshot["regions"]):
            trace("plan", "completed", "当前无需新增恢复任务", "已有链路恢复，继续独立核验终端与人员回执。")
        else:
            plan = await call_tool("planning", "plan_optimize", {"snapshot_version": snapshot["version"], "policy": policy})
            check = await call_tool("planning", "plan_validate", {"plan_id": plan["id"]})
            if not check["valid"]:
                raise DomainError("INVALID_PLAN", "；".join(check["issues"]))
            trace("plan", "completed", "可行方案等待人工审查", f"{len(plan['actions'])} 项任务，最长预计 {plan['eta_minutes']} 个演练分钟。", [plan["id"]])
        current_stage = "verify"
        current = store.read()
        counters = engine.metrics(current)
        complete = bool(current["notices"]) and counters["human_confirmed"] == counters["targets"] and not any(r["status"] == "offline" for r in current["regions"])
        trace("verify", "completed" if complete else "waiting", "本轮通知回执已齐备" if complete else "等待人工批准与实际回执", "终端接收和人员确认按当前通知分别核验。")
        store.mutate(lambda s: s["jobs"][job_id].update({"status": "completed", "finished_at": timestamp()}))
    except Exception as exc:
        if isinstance(exc, DomainError) and exc.code == "DRILL_CHANGED":
            raise
        if not isinstance(exc, DomainError):
            logging.exception("Local workflow failed: %s", job_id)
        message = exc.message if isinstance(exc, DomainError) else "本地执行出现异常，请查看服务日志并重试。"
        trace(current_stage, "error", "本轮流程已停止", message)
        def fail(state):
            state["jobs"][job_id].update({"status": "failed", "error": message, "diagnostics": exc.context if isinstance(exc, DomainError) else {}, "finished_at": timestamp()})
            event(state, "流程需要处理", message, "warning", "本地角色流程")
        store.mutate(fail)


class RunRequest(BaseModel):
    policy: Literal["balanced", "coverage"] = "balanced"


class ReportRequest(BaseModel):
    text: str = Field(min_length=1, max_length=6000)
    region_id: str = "R12"
    modality: Literal["text", "image", "audio", "transcript"] = "text"


class ReceiptRequest(BaseModel):
    message_id: str
    region_id: str
    stage: Literal["terminal_received", "human_confirmed"]
    client_id: str = Field(min_length=1, max_length=200)


class LinkRequest(BaseModel):
    online: bool


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "0.2.0", "mode": "local_rules", "database": "sqlite", "mcp_services": 3, "mcp_tools": 12, "cloud_connected": False, "model_trained": False}


@app.get("/api/state")
def state():
    return engine.public_state()


@app.get("/api/tool-calls/{call_id}")
def full_tool_response(call_id: str, drill_id: str | None = None):
    identity = drill_id or store.read()["drill_id"]
    result = store.tool_response(call_id, identity)
    digest = hashlib.sha256(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"call_id": call_id, "drill_id": identity, "result": result, "content_hash": digest}


@app.get("/api/history")
def history():
    return {"drills": [{"drill_id": s["drill_id"], "title": s["title"], "archived_at": at, "simulation_time": s["simulation_time"], "metrics": engine.metrics(s), "plan_count": len(s["plans"]), "event_count": len(s["events"])} for at, s in store.archives()]}


@app.get("/api/history/{drill_id}")
def archived_drill(drill_id: str):
    return engine.public_state(store.archive(drill_id))


@app.get("/api/history/{drill_id}/export")
def export_archive(drill_id: str):
    return JSONResponse(engine.public_state(store.archive(drill_id)), headers={"Content-Disposition": 'attachment; filename="undelivered-archived-drill.json"'})


@app.post("/api/run", status_code=202)
async def run(body: RunRequest):
    job_id = f"JOB-{uuid4().hex[:10]}"
    def change(current):
        if any(j["status"] == "running" for j in current["jobs"].values()):
            raise DomainError("BUSY", "已有流程在运行。")
        current["agent_stages"] = {name: "idle" for name in current["agent_stages"]}
        current["jobs"][job_id] = {"id": job_id, "drill_id": current["drill_id"], "status": "running", "started_at": timestamp(), "policy": body.policy}
        event(current, "协同流程已启动", "采用本地角色规则，通过真实 HTTP MCP 查询和计算。", "info", "演练操作者")
        return current["drill_id"]
    drill_id = store.mutate(change)
    task = asyncio.create_task(run_pipeline(job_id, body.policy, drill_id))
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)
    return {"job_id": job_id, "status": "running"}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    row = store.read()["jobs"].get(job_id)
    if not row:
        raise DomainError("NOT_FOUND", "任务不存在。", 404)
    return row


@app.post("/api/plans/{plan_id}/approve")
def approve_plan(plan_id: str):
    return engine.approve(plan_id)


@app.post("/api/plans/{plan_id}/execute")
async def execute_plan(plan_id: str):
    current = store.read()
    token = EXPECTED_DRILL.set(current["drill_id"])
    try:
        return await _execute_plan(plan_id, current)
    finally:
        EXPECTED_DRILL.reset(token)


async def _execute_plan(plan_id, current):
    plan = engine.get_plan(current, plan_id)
    arguments = {"plan_id": plan_id, "approval_id": plan["approval_id"] or "", "idempotency_key": f"ui-execute:{plan_id}"}
    # Empty approval is rejected by the service rather than being treated as a model approval.
    if not plan["approval_id"]:
        raise DomainError("APPROVAL_REQUIRED", "请先审查并批准方案。")
    result = await call_tool("delivery", "delivery_dispatch_drill", arguments)
    notice = await call_tool("delivery", "delivery_publish_notice", {"plan_id": plan_id, "approval_id": plan["approval_id"], "idempotency_key": f"ui-notice:{plan_id}"})
    receipts = await call_tool("delivery", "delivery_query_receipts")
    if plan["status"] != "executed" or notice["notice_id"] not in {n["id"] for n in current["notices"]}:
        complete = receipts["metrics"]["human_confirmed"] == receipts["metrics"]["targets"]
        trace("verify", "completed" if complete else "waiting", "本轮通知回执已齐备" if complete else "演练消息已发出，等待终端回执", "资源恢复采用图模型仿真；实际接收与人员确认由终端请求产生。")
    return result


@app.post("/api/reports")
def report(body: ReportRequest):
    return engine.add_report(body.text, body.region_id, body.modality)


@app.post("/api/reports/upload")
async def upload_report(file: UploadFile = File(...), region_id: str = Form("R12"), text: str = Form("")):
    allowed = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mpeg": ".mp3", "audio/webm": ".webm", "video/webm": ".webm", "audio/mp4": ".m4a", "audio/ogg": ".ogg"}
    if file.content_type not in allowed:
        raise DomainError("INVALID_FILE", "支持 PNG、JPG、WebP 和常见音频格式。", 400)
    data = await file.read(8 * 1024 * 1024 + 1)
    if len(data) > 8 * 1024 * 1024:
        raise DomainError("FILE_TOO_LARGE", "素材需小于 8 MB。", 413)
    if not data:
        raise DomainError("EMPTY_FILE", "素材为空。", 400)
    mime = file.content_type
    valid = ((mime == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n")) or
             (mime == "image/jpeg" and data.startswith(b"\xff\xd8\xff")) or
             (mime == "image/webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP") or
             (mime in {"audio/wav", "audio/x-wav"} and data.startswith(b"RIFF") and data[8:12] == b"WAVE") or
             (mime == "audio/mpeg" and (data.startswith(b"ID3") or len(data) > 1 and data[0] == 255 and data[1] & 224 == 224)) or
             (mime in {"audio/webm", "video/webm"} and data.startswith(b"\x1a\x45\xdf\xa3")) or
             (mime == "audio/mp4" and data[4:8] == b"ftyp") or
             (mime == "audio/ogg" and data.startswith(b"OggS")))
    if not valid:
        raise DomainError("INVALID_FILE", "文件内容与声明格式不一致，请上传原始图片或音频。", 400)
    if len(text) > 6000:
        raise DomainError("INVALID_ARGUMENT", "报告描述过长。", 400)
    engine.get_region(store.read(), region_id)
    filename = uuid4().hex + allowed[file.content_type]
    path = ASSETS / filename
    path.write_bytes(data)
    try:
        return engine.add_report(text, region_id, "image" if file.content_type.startswith("image/") else "audio", {"url": f"/uploads/{filename}", "name": (file.filename or "素材").replace("\\", "/").split("/")[-1], "mime": file.content_type, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "processing": "stored_only_cloud_model_pending"})
    except Exception:
        path.unlink(missing_ok=True)
        raise


@app.post("/api/inject/{kind}")
def inject_event(kind: str):
    return engine.inject(kind)


@app.post("/api/terminal/{region_id}/link")
def set_terminal_link(region_id: str, body: LinkRequest):
    return engine.terminal_link(region_id, body.online)


@app.get("/api/terminal/{region_id}/messages")
def terminal_messages(region_id: str):
    current = store.read()
    engine.get_region(current, region_id)
    if not current["terminal_links"].get(region_id):
        raise DomainError("TERMINAL_OFFLINE", "演练链路离线，恢复后同步。", 503)
    delivery = engine.delivery_state(current)
    return {"drill_id": current["drill_id"], "notice_id": delivery["active_notice_id"], "messages": [m for m in delivery["messages"] if m["region_id"] == region_id]}


@app.post("/api/receipts")
def record_receipt(body: ReceiptRequest):
    return engine.receipt(body.message_id, body.region_id, body.stage, body.client_id)


@app.get("/api/knowledge")
def knowledge(q: str = ""):
    if len(q) > 500:
        raise DomainError("INVALID_ARGUMENT", "检索文本请控制在 500 字以内。", 400)
    return {"mode": "sqlite_fts5_bm25_cjk_bigrams", "corpus_hash": CORPUS_HASH, "documents": search_knowledge(q)}


@app.post("/api/integrations/ping")
async def integration_ping():
    result = await call_tool("observation", "obs_get_snapshot")
    return {"status": "ok", "transport": "HTTP JSON-RPC", "snapshot_version": result["version"], "cloud_connected": False}


@app.post("/api/reset")
def reset():
    store.reset()
    with drill_scope(None):
        return engine.public_state()


@app.get("/api/export")
def export():
    current = engine.public_state()
    lines = ["# 未送达 · 演练运行记录", "", f"导出时间：{timestamp()}", "", "运行模式：本地确定性规则 + HTTP MCP。华为云模型、AgentArts 和 LoRA 尚未接入。", "", "场景为合成演练；资源恢复为图模型仿真，消息及回执为真实软件请求。", "", "## 当前指标", "", "```json", json.dumps(current["metrics"], ensure_ascii=False, indent=2), "```", "", "## 事件记录", ""]
    for row in reversed(current["events"]):
        lines.append(f"- {row['at']} / 演练 {row['time']} / {row['actor']}：{row['title']}。{row['detail']}")
    lines.extend(["", "## MCP 实际调用", ""])
    for call in reversed(current["tool_calls"]):
        lines.append(f"- {call['id']} · {call['service']}/{call['tool']} · {call['status']} · {call['duration_ms']} ms")
    lines.extend(["", "## 方案与批准记录", ""])
    for plan in current["plans"]:
        lines.extend([f"### {plan['id']}", "", f"快照 v{plan['snapshot_version']}；状态 {plan['status']}；批准记录 {plan['approval_id'] or '未批准'}。", "", f"方案摘要 SHA-256：`{plan['hash']}`", ""])
        for action in plan["actions"]:
            names = [engine.get_region(current, rid)["name"] for rid in action["route"]["nodes"]]
            lines.append(f"- {action['team_name']} → {action['region_name']}：{' → '.join(names)}，预计 {action['eta_minutes']} 个演练分钟。")
    lines.extend(["", "## 独立软件回执", "", "| 区域 | 消息 | 终端收到 | 人员确认 |", "| --- | --- | --- | --- |"])
    for message in current["messages"]:
        lines.append(f"| {engine.get_region(current, message['region_id'])['name']} | {message['id']} | {message['terminal_received_at'] or '等待'} | {message['human_confirmed_at'] or '等待'} |")
    return Response("\n".join(lines), media_type="text/markdown; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="undelivered-drill-report.md"'})


app.mount("/uploads", StaticFiles(directory=str(ASSETS)), name="uploads")
if (ROOT / "dist").is_dir():
    app.mount("/", StaticFiles(directory=str(ROOT / "dist"), html=True), name="frontend")
