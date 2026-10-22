import initial from '../fixtures/initial-state.json'
import type { AppState, Message, Plan } from '../../web/src/types'

export function seed(): AppState {
  return structuredClone(initial) as unknown as AppState
}
export function message(region = 'R12', suffix = '1'): Message {
  return {
    id: `MSG-${region}-${suffix}`,
    region_id: region,
    notice_id: 'NOTICE-1',
    text: `${region} 的通信保障演练消息`,
    status: 'sent',
    created_at: '2026-10-22T02:30:00+08:00',
    sent_at: '2026-10-22T02:30:00+08:00',
    terminal_received_at: null,
    human_confirmed_at: null,
  }
}
export function delivery(regions = ['R12']): AppState {
  const state = seed()
  state.delivery = {
    active_notice_id: 'NOTICE-1',
    target_region_ids: regions,
    messages: regions.map((r) => message(r)),
  }
  state.messages = state.delivery.messages
  state.metrics.targets = regions.length
  state.metrics.sent = regions.length
  for (const region of regions) state.terminal_links[region] = true
  return state
}
export function plan(): Plan {
  return {
    id: 'PLAN-1',
    snapshot_version: 2,
    policy: 'balanced',
    status: 'draft',
    created_at: '2026-10-22T02:20:00+08:00',
    actions: [],
    approval_id: null,
    citations: [],
    eta_minutes: 44,
    affected_people_proxy: 796,
    solver: 'exhaustive_assignment+dijkstra',
    scope: 'finite model',
    hash: 'hash',
    unresolved: [],
    decision_rationale: '比较两种分配后，选择最长恢复 44 分钟的方案。',
    alternatives: [
      {
        id: 'C1',
        selected: true,
        eta_minutes: 44,
        travel_minutes: 57,
        weighted_wait_minutes: 30434,
        safety_margin_minutes: 116,
        assignments: [{ region_name: '鹿鸣村', team_name: '通信保障一队', eta_minutes: 44 }],
      },
      {
        id: 'C2',
        selected: false,
        eta_minutes: 53,
        travel_minutes: 75,
        weighted_wait_minutes: 37598,
        safety_margin_minutes: 107,
        assignments: [{ region_name: '鹿鸣村', team_name: '通信保障二队', eta_minutes: 53 }],
      },
    ],
  }
}
