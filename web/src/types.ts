export type RegionStatus = 'online' | 'degraded' | 'offline' | 'unknown'
export interface Region {
  id: string
  name: string
  x: number
  y: number
  people: number
  status: RegionStatus
  kind: string
  station_id: string
  last_seen: string
  reports: number
  verified: boolean
  recovery_kind?: string
}
export interface Road {
  id: string
  from: string
  to: string
  minutes: number
  open: boolean
}
export interface Resource {
  id: string
  name: string
  type: string
  location: string
  status: string
  battery?: number
}
export interface Citation {
  id: string
  section: string
  title: string
  text: string
  type: string
  version: string
  content_hash?: string
  source?: string
  score?: number
  matched_terms?: string[]
}
export interface Evidence {
  id: string
  region_id: string
  title: string
  modality: string
  source: string
  time: string
  event_time: string | null
  text: string
  verification: string
  unknown_fields: string[]
  facts: string[]
  stale: boolean
  attachment?: { url: string; name: string; mime: string; bytes: number } | null
}
export interface PlanAction {
  id: string
  region_id: string
  region_name: string
  team_id: string
  team_name: string
  type: string
  title: string
  resource_ids: string[]
  route: { minutes: number; nodes: string[]; edges: string[] }
  deploy_minutes: number
  eta_minutes: number
  battery_required: number
  status: string
}
export interface Plan {
  id: string
  snapshot_version: number
  policy: string
  status: string
  created_at: string
  actions: PlanAction[]
  approval_id: string | null
  citations: Citation[]
  eta_minutes: number
  affected_people_proxy: number
  solver: string
  scope: string
  hash: string
  stale_reason?: string
  unresolved: string[]
  alternatives?: {
    id: string
    selected: boolean
    eta_minutes: number
    travel_minutes: number
    weighted_wait_minutes: number
    safety_margin_minutes: number | null
    assignments: { region_name: string; team_name: string; eta_minutes: number }[]
  }[]
  decision_rationale?: string
  comparison?: {
    previous_plan_id: string
    previous_eta_minutes: number
    eta_delta_minutes: number
  } | null
  validation?: {
    valid: boolean
    issues: string[]
    checks: { id: string; label: string; passed: boolean }[]
  }
}
export interface Message {
  id: string
  region_id: string
  notice_id: string
  text: string
  status: string
  created_at: string
  sent_at: string | null
  terminal_received_at: string | null
  human_confirmed_at: string | null
}
export interface Trace {
  id: string
  stage: string
  status: string
  title: string
  detail: string
  references: string[]
  at: string
}
export interface ToolCall {
  id: string
  service: string
  tool: string
  arguments: Record<string, unknown>
  status: string
  at: string
  duration_ms: number
  transport: string
  result: string
  request_id?: string
  result_hash?: string
  result_truncated?: boolean
  result_summary?: boolean
}
export interface DrillEvent {
  id: string
  title: string
  detail: string
  kind: string
  actor: string
  time: string
  at: string
}
export interface AppState {
  app_version?: string
  drill_id: string
  title: string
  simulation_time: string
  version: number
  regions: Region[]
  roads: Road[]
  resources: Resource[]
  evidence: Evidence[]
  plans: Plan[]
  active_plan_id: string | null
  messages: Message[]
  terminal_links: Record<string, boolean>
  agent_stages: Record<string, string>
  probe_budget: number
  events: DrillEvent[]
  traces: Trace[]
  tool_calls: ToolCall[]
  jobs: Record<
    string,
    { id: string; status: string; error?: string; diagnostics?: PlanningDiagnostics }
  >
  planning_diagnostics: PlanningDiagnostics | null
  delivery: { active_notice_id: string | null; target_region_ids: string[]; messages: Message[] }
  assessment: { summary: string; unknown_region_ids: string[]; citations: Citation[] } | null
  metrics: {
    total_regions: number
    online: number
    affected: number
    unknown: number
    available_resources: number
    terminal_received: number
    human_confirmed: number
    tool_calls: number
    reports: number
    targets: number
    probes_remaining: number
    sent: number
    queued: number
  }
  integrations: { id: string; name: string; status: string; detail: string }[]
}
export interface PlanningDiagnostics {
  status: string
  snapshot_version: number
  drill_id: string
  reasons: {
    code: string
    detail: string
    required_minutes?: number
    available_minutes?: number
    shortfall_minutes?: number
    region_name?: string
    team_name?: string
  }[]
  suggestions: string[]
  assignments_checked: number
  feasible_count: number
}
