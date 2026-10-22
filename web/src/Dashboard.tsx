import { useState } from 'react'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudRain,
  FileImage,
  GitBranch,
  Layers3,
  LoaderCircle,
  MapPin,
  Maximize2,
  Minus,
  Mountain,
  Navigation,
  Plus,
  Radio,
  Route,
  Signal,
  Sparkles,
  Wifi,
} from 'lucide-react'
import type { AppState, Plan, Region } from './types'
import { Badge, Dot, roles, stageNames, statuses } from './common'

export function Metrics({ state: s }: { state: AppState }) {
  const cards = [
    {
      label: '演练覆盖区域',
      value: s.metrics.total_regions,
      unit: '个',
      icon: MapPin,
      note: (
        <>
          <Dot kind="online" />
          {s.metrics.online} 个链路正常
        </>
      ),
      tone: '',
    },
    {
      label: '需要关注的区域',
      value: s.metrics.affected + s.metrics.unknown,
      unit: '个',
      icon: Signal,
      note: (
        <>
          <span className="note-orange">{s.metrics.affected} 个受影响</span>
          <span className="mini-divider" />
          {s.metrics.unknown} 个状态未知
        </>
      ),
      tone: 'attention',
    },
    {
      label: '可用保障资源',
      value: s.metrics.available_resources,
      unit: '项',
      icon: Layers3,
      note: (
        <>
          <span className="resource-dots">
            <i />
            <i />
            <i />
          </span>
          {s.resources.filter((r) => r.type === 'team' && r.status === 'available').length} 支队伍 ·{' '}
          {s.resources.filter((r) => r.type !== 'team' && r.status === 'available').length} 台设备
        </>
      ),
      tone: '',
    },
    {
      label: '人员确认',
      value: s.metrics.human_confirmed,
      unit: `/ ${s.metrics.targets}`,
      icon: CheckCheck,
      note: (
        <>
          终端已接收 <b>{s.metrics.terminal_received}</b> / {s.metrics.targets}
          <span className="micro-bar">
            <i style={{ width: `${(s.metrics.human_confirmed / s.metrics.targets) * 100}%` }} />
          </span>
        </>
      ),
      tone: '',
    },
  ]
  return (
    <section className="metrics" aria-label="演练指标">
      {cards.map((c) => (
        <div className={`metric-card ${c.tone}`} key={c.label}>
          <div className="metric-top">
            <span>{c.label}</span>
            <c.icon size={18} strokeWidth={1.6} />
          </div>
          <div className="metric-value">
            {c.value}
            <span>{c.unit}</span>
          </div>
          <div className="metric-note">{c.note}</div>
        </div>
      ))}
    </section>
  )
}

export function SituationMap({
  state: s,
  selected,
  onSelect,
  plan,
}: {
  state: AppState
  selected: string
  onSelect: (id: string) => void
  plan?: Plan
}) {
  const [zoom, setZoom] = useState(1),
    [filter, setFilter] = useState('all'),
    [paths, setPaths] = useState(true)
  const locations = Object.fromEntries(s.regions.map((r) => [r.id, r]))
  return (
    <section className="panel map-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <MapPin size={17} />
            区域通信态势
          </h2>
          <span className="panel-sub">云溪县 · 12 个演练区域</span>
        </div>
        <div className="segmented">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            全部区域
          </button>
          <button
            className={filter === 'attention' ? 'active' : ''}
            onClick={() => setFilter('attention')}
          >
            重点关注 <span>{s.metrics.affected + s.metrics.unknown}</span>
          </button>
        </div>
      </div>
      <div className="map-canvas">
        <div className="map-weather">
          <CloudRain size={16} />
          <div>
            <strong>暴雨演练</strong>
            <span>山地 · 乡镇通信场景</span>
          </div>
        </div>
        <svg
          className="terrain-map"
          viewBox="0 0 940 590"
          role="group"
          aria-label="云溪县合成通信态势图，点击区域可查看详情"
        >
          <defs>
            <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.65" fill="#c9cfc3" opacity=".5" />
            </pattern>
            <linearGradient id="terrain" x2="1" y2="1">
              <stop stopColor="#e9ede2" />
              <stop offset="1" stopColor="#f1f1e8" />
            </linearGradient>
            <filter id="node-shadow" x="-70%" y="-70%" width="240%" height="240%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#193c30" floodOpacity=".1" />
            </filter>
          </defs>
          <rect width="940" height="590" fill="url(#terrain)" />
          <rect width="940" height="590" fill="url(#dots)" />
          <g
            transform={`translate(${locations[selected].x * (1 - zoom)} ${locations[selected].y * (1 - zoom)}) scale(${zoom})`}
          >
            <g fill="none" stroke="#c8d2bf" strokeWidth="1" opacity=".46">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <g key={i}>
                  <path
                    d={`M ${-60 + i * 20} 70 C ${95 + i * 8} ${-80 + i * 12},${275 - i * 10} ${-10 + i * 21},${260 - i * 11} ${150 - i * 4} S ${110 + i * 7} ${300 - i * 10},${30 - i * 2} ${240 + i * 13}`}
                  />
                  <path
                    d={`M ${710 + i * 13} -20 C ${660 + i * 22} ${110 - i * 7},${925 - i * 15} ${120 + i * 11},${1000 - i * 18} ${220 + i * 12}`}
                  />
                  <path
                    d={`M ${-40 + i * 17} 470 C ${175 - i * 10} ${390 + i * 22},${240 + i * 5} ${480 + i * 9},${260 + i * 22} 650`}
                  />
                </g>
              ))}
            </g>
            <path
              d="M387 -20 C397 75 514 90 510 161 S445 258 490 302 S579 349 554 410 S510 522 598 620"
              fill="none"
              stroke="#fff"
              strokeWidth="20"
              opacity=".7"
            />
            <path
              d="M387 -20 C397 75 514 90 510 161 S445 258 490 302 S579 349 554 410 S510 522 598 620"
              fill="none"
              stroke="#bbd6d2"
              strokeWidth="13"
            />
            <path
              d="M32 158 Q156 43 365 47 T682 45 Q834 48 877 169 T911 387 Q883 548 707 552 T405 566 Q138 579 51 515 T32 158"
              fill="none"
              stroke="#bfcbb7"
              strokeWidth="1.5"
              strokeDasharray="5 6"
            />
            <text x="518" y="285" className="river-label" transform="rotate(38 518 285)">
              云 溪
            </text>
            <text x="85" y="236" className="terrain-label">
              松岭山地
            </text>
            <text x="720" y="61" className="terrain-label">
              白鹭山
            </text>
            <text x="253" y="549" className="terrain-label">
              云 溪 县 界
            </text>
            {s.roads.map((road) => {
              const a = locations[road.from],
                b = locations[road.to]
              return (
                <g key={road.id}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={road.open ? '#fafbf6' : '#c07055'}
                    strokeWidth={road.open ? 7 : 3}
                    strokeDasharray={road.open ? undefined : '5 6'}
                  />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={road.open ? '#c4cabb' : 'transparent'}
                    strokeWidth="1.5"
                  />
                  {!road.open && (
                    <g transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`}>
                      <circle r="11" fill="#fff6ec" stroke="#ce886b" />
                      <path d="m-3 -3 6 6 m0 -6 -6 6" stroke="#b76145" strokeWidth="1.6" />
                    </g>
                  )}
                </g>
              )
            })}
            {paths &&
              plan &&
              plan.status !== 'stale' &&
              plan.actions.map((a, i) => (
                <polyline
                  key={a.id}
                  points={a.route.nodes
                    .map((id) => `${locations[id].x},${locations[id].y}`)
                    .join(' ')}
                  fill="none"
                  stroke={i === 0 ? '#c78253' : '#4b8376'}
                  strokeWidth="3.8"
                  strokeDasharray="8 5"
                  opacity=".9"
                />
              ))}
            {s.regions.map((r) => (
              <g
                key={r.id}
                className={`map-node ${r.status} ${r.id === selected ? 'selected' : ''}`}
                transform={`translate(${r.x} ${r.y})`}
                opacity={filter === 'all' || r.status !== 'online' ? 1 : 0.25}
                role="button"
                tabIndex={0}
                aria-label={`${r.name}，${statuses[r.status]}`}
                onClick={() => onSelect(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(r.id)
                  }
                }}
              >
                <circle r="30" fill="transparent" />
                {r.id === selected && (
                  <>
                    <circle r="34" className="selection-halo" />
                    <circle r="25" className="selection-ring" />
                  </>
                )}
                <circle
                  r={r.kind === 'center' ? 13 : 10}
                  className="node-bg"
                  filter="url(#node-shadow)"
                />
                <circle r={r.kind === 'center' ? 6 : 4.5} className="node-center" />
                {r.status === 'unknown' && (
                  <text y="4" textAnchor="middle" className="node-question">
                    ?
                  </text>
                )}
                <text
                  y={r.id === selected ? 49 : 30}
                  textAnchor="middle"
                  className={`node-label ${r.id === selected ? 'selected-label' : ''}`}
                >
                  {r.name}
                </text>
                {r.id === selected && (
                  <g transform="translate(-43 -67)">
                    <rect width="86" height="26" rx="6" className="map-callout-bg" />
                    <text x="43" y="17" textAnchor="middle" className="map-callout-text">
                      {statuses[r.status]}
                    </text>
                    <path d="M38 26 43 31 48 26" className="map-callout-bg" />
                  </g>
                )}
                {r.kind === 'center' && (
                  <text y="-23" textAnchor="middle" className="node-center-label">
                    指挥中心
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
        <div className="map-compass">
          <Navigation size={18} fill="currentColor" />
          <span>N</span>
        </div>
        <div className="map-controls">
          <button
            aria-label="放大地图"
            disabled={zoom >= 1.4}
            onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(1)))}
          >
            <Plus size={16} />
          </button>
          <button
            aria-label="缩小地图"
            disabled={zoom <= 0.8}
            onClick={() => setZoom((z) => Math.max(0.8, +(z - 0.1).toFixed(1)))}
          >
            <Minus size={16} />
          </button>
          <button aria-label="复位地图" onClick={() => setZoom(1)}>
            <Maximize2 size={15} />
          </button>
        </div>
        <div className="map-bottom">
          <span>
            <Mountain size={13} />
            合成地理示意 · 非实际覆盖图
          </span>
          <span className="map-scale">
            <i />5 km（示意）
          </span>
        </div>
      </div>
      <div className="map-region-picker">
        <label htmlFor="map-region">查看区域</label>
        <select id="map-region" value={selected} onChange={(event) => onSelect(event.target.value)}>
          {s.regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name} · {statuses[region.status]}
            </option>
          ))}
        </select>
      </div>
      <div className="map-legend">
        <div>
          {(['online', 'offline', 'degraded', 'unknown'] as const).map((key) => (
            <span key={key}>
              <Dot kind={key} />
              {statuses[key]}
            </span>
          ))}
        </div>
        <button
          className={paths ? 'layer-toggle active' : 'layer-toggle'}
          onClick={() => setPaths(!paths)}
        >
          <Layers3 size={14} />
          保障路径 {paths ? '开' : '关'}
        </button>
      </div>
    </section>
  )
}

export function RegionPanel({
  state: s,
  region: r,
  onRun,
  disabled,
  plan,
  onPlan,
}: {
  state: AppState
  region: Region
  onRun: () => void
  disabled: boolean
  plan?: Plan
  onPlan: () => void
}) {
  const evidence = s.evidence.filter((e) => e.region_id === r.id),
    unknown = r.status === 'unknown'
  return (
    <aside className="panel region-panel">
      <div className="region-heading">
        <div className="eyebrow">REGION PROFILE / 区域详情</div>
        <span className="region-code">{r.id}</span>
      </div>
      <div className="region-title">
        <h2>{r.name}</h2>
        <Badge tone={r.status}>
          <Dot kind={r.status} />
          {statuses[r.status]}
        </Badge>
      </div>
      <div className="region-location">
        <MapPin size={13} />
        云溪县 · {r.kind === 'center' ? '县级保障中心' : '乡镇保障网格'}
        <span>{r.station_id}</span>
      </div>
      <div
        className={`region-alert ${unknown ? '' : r.status === 'online' ? 'resolved' : 'affected'}`}
      >
        <span className="alert-icon">
          {unknown ? (
            <CircleHelp size={20} />
          ) : r.status === 'online' ? (
            <Wifi size={20} />
          ) : (
            <Signal size={20} />
          )}
        </span>
        <div>
          <strong>
            {unknown
              ? '没有报告，不等于一切正常。'
              : r.status === 'online'
                ? '链路已可达，回执仍需独立核验。'
                : '链路受影响，需要通信保障。'}
          </strong>
          <p>
            {unknown
              ? '该区域长时间没有更新，优先核实连接状态。'
              : r.verified
                ? '状态已在演练中核实，下一步检查消息是否抵达。'
                : '当前证据已记录，等待核实与调度。'}
          </p>
        </div>
      </div>
      <div className="region-facts">
        <div>
          <span>最近观测</span>
          <strong>
            {r.last_seen}
            <small>演练时刻</small>
          </strong>
        </div>
        <div>
          <span>区域人口</span>
          <strong>
            {r.people.toLocaleString()}
            <small>合成代理值</small>
          </strong>
        </div>
        <div>
          <span>现场报告</span>
          <strong>
            {r.reports}
            <small>条</small>
          </strong>
        </div>
      </div>
      <div className="evidence-heading">
        <h3>关键证据</h3>
        <span>{evidence.length} 条</span>
      </div>
      <div className="region-evidence">
        {evidence.slice(0, 2).map((e) => (
          <div className="evidence-compact" key={e.id}>
            <div className="evidence-icon">
              {e.modality === 'probe' ? (
                <Radio size={15} />
              ) : e.modality === 'image' ? (
                <FileImage size={15} />
              ) : (
                <Activity size={15} />
              )}
            </div>
            <div>
              <strong>{e.title}</strong>
              <p>{e.text}</p>
              <span>
                {e.source} <b>·</b> {e.time}
              </span>
            </div>
          </div>
        ))}
        {!evidence.length && <p className="muted">当前没有单独现场证据，可在现场报告中补充。</p>}
      </div>
      <div className="region-bottom">
        <div className="priority-note">
          <span className="priority-mark" />
          <span>
            {unknown
              ? '建议：主动核实链路与供电'
              : plan && plan.status !== 'stale'
                ? '方案已生成，可查看资源与路径'
                : '继续协同核实并生成保障方案'}
          </span>
        </div>
        {plan && plan.status !== 'stale' ? (
          <button className="button primary full" onClick={onPlan}>
            <Route size={16} />
            {plan.status === 'executed' ? '查看已执行方案' : '查看保障方案'}
            <ArrowRight size={17} />
          </button>
        ) : (
          <button className="button primary full" onClick={onRun} disabled={disabled}>
            {disabled ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
            开始协同研判
            <ArrowRight size={17} />
          </button>
        )}
        <p className="honesty-note">本地规则流程 · 核实数据来自合成演练节点</p>
      </div>
    </aside>
  )
}

export function AgentFlow({
  state: s,
  onRun,
  disabled,
  onPlan,
}: {
  state: AppState
  onRun: () => void
  disabled: boolean
  onPlan: () => void
}) {
  return (
    <section className="panel flow-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <GitBranch size={17} />
            协同处理流程 <Badge>4 个角色</Badge>
          </h2>
          <span className="panel-sub">本地规则编排 · 实际 HTTP MCP 调用</span>
        </div>
        <button className="text-button" onClick={onRun} disabled={disabled}>
          {disabled ? '正在处理' : '运行一轮'}
          <ArrowRight size={14} />
        </button>
      </div>
      <div className="role-flow">
        {roles.map((role, i) => {
          const status = s.agent_stages[role.id]
          return (
            <div className={`role-step ${status}`} key={role.id}>
              <div className="role-step-top">
                <span className="role-number">{role.no}</span>
                <span className="role-icon">
                  {status === 'running' ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <role.icon size={18} />
                  )}
                </span>
                {i < roles.length - 1 && <ChevronRight className="role-arrow" size={16} />}
              </div>
              <h3>{role.label}</h3>
              <p>{role.task}</p>
              <span className="role-state">
                <Dot
                  kind={
                    status === 'completed'
                      ? 'online'
                      : status === 'error'
                        ? 'offline'
                        : status === 'waiting'
                          ? 'unknown'
                          : 'idle'
                  }
                />
                {stageNames[status]}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flow-summary">
        <span>
          <span className="local-dot" />
          {s.traces[0]?.title || '准备就绪，等待启动协同研判'}
        </span>
        {s.plans.length > 0 ? (
          <button className="text-button" onClick={onPlan}>
            查看方案
            <ArrowUpRight size={14} />
          </button>
        ) : (
          <span className="flow-call-count">{s.tool_calls.length} 次实际工具调用</span>
        )}
      </div>
    </section>
  )
}
export function EventFeed({ state: s, onAll }: { state: AppState; onAll: () => void }) {
  return (
    <section className="panel event-panel">
      <div className="panel-heading">
        <h2>
          <Bell size={17} />
          演练动态
        </h2>
        <button className="text-button" onClick={onAll}>
          全部
          <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="event-list">
        {s.events.slice(0, 3).map((e, i) => (
          <div className={`event-row ${i === 0 ? 'new' : ''}`} key={e.id}>
            <span className={`event-dot ${e.kind}`} />
            <div>
              <strong>{e.title}</strong>
              <p>{e.detail}</p>
            </div>
            <time>{e.time}</time>
          </div>
        ))}
      </div>
      <div className="event-foot">
        <Clock3 size={13} />
        业务状态与回执已持久化保存
      </div>
    </section>
  )
}
