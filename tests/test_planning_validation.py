from copy import deepcopy

import pytest

from backend import engine
from backend.planning import solve
from backend.store import Store, drill_scope


def candidate():
    state = Store.fresh()
    next(r for r in state["regions"] if r["id"] == "R12")["status"] = "offline"
    result = solve(state, "balanced", engine.shortest_path)
    plan = {"id": "TEST-PLAN", "drill_id": state["drill_id"], "snapshot_version": state["version"], "policy": "balanced", "actions": result["actions"], "eta_minutes": 44, "constraints": {"reserve_minutes": 20, "one_task_per_team": True, "graph_version": state["scenario_version"], "knowledge_corpus_hash": engine.CORPUS_HASH}}
    plan["hash"] = engine.plan_hash(plan)
    return state, plan


@pytest.mark.parametrize("corruption", ["empty_route", "empty_tasks", "underbudget", "duplicate_region", "false_eta", "changed_rules"])
def test_validator_rejects_infeasibility_even_with_matching_digest(corruption):
    state, plan = candidate()
    assert engine.validate_plan(state, plan)["valid"]
    if corruption == "empty_route":
        plan["actions"][0]["route"]["nodes"] = []
    elif corruption == "empty_tasks":
        plan["actions"] = []
    elif corruption == "underbudget":
        next(a for a in plan["actions"] if a["type"] == "deploy_portable")["battery_required"] = 1
    elif corruption == "duplicate_region":
        plan["actions"][1] = deepcopy(plan["actions"][0])
    elif corruption == "false_eta":
        plan["eta_minutes"] = 1
    else:
        plan["constraints"]["knowledge_corpus_hash"] = "a-different-policy-version"
    plan["hash"] = engine.plan_hash(plan)
    result = engine.validate_plan(state, plan)
    assert result["valid"] is False and result["issues"]


def test_an_old_task_cannot_mutate_after_drill_reset(tmp_path):
    storage = Store(tmp_path / "isolated.db")
    old = storage.read()["drill_id"]
    storage.reset()
    with drill_scope(old), pytest.raises(engine.DomainError, match="演练已重置"):
        storage.mutate(lambda state: state.update({"version": 999}))
    assert storage.read()["version"] == 1
