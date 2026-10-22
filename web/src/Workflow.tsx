import { useRef, useState } from 'react'
import {
  ArrowRight,
  AudioLines,
  Battery,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  FileImage,
  FileText,
  Flag,
  GitBranch,
  Layers3,
  LoaderCircle,
  MapPin,
  MessageSquare,
  Navigation,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  Unplug,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { api } from './api'
import type { AppState, Evidence, Plan } from './types'
import { Badge, Dot, Empty, dateText, regionName, planNames, type Act } from './common'
import { PlanInsights, PlanningFailure } from './PlanInsights'

function EvidenceCard({ evidence: e, state: s }: { evidence: Evidence; state: AppState }) {
  const Icon =
    e.modality === 'image'
      ? FileImage
      : e.modality === 'audio' || e.modality === 'transcript'
        ? AudioLines
        : e.modality === 'probe'
          ? Radio
          : FileText
  return (
    <article className="evidence-card">
      <div className="evidence-card-top">
        <span className="evidence-type">
          <Icon size={17} />
          {regionName(s, e.region_id)}
        </span>
        <Badge tone={e.stale ? 'offline' : e.verification === 'verified_in_drill' ? 'online' : ''}>
          {e.stale
            ? '历史材料 · 待核时效'
            : e.verification === 'verified_in_drill'
              ? '演练中已核实'
              : e.modality === 'telemetry'
                ? '监测记录'
                : '已记录'}
        </Badge>
      </div>
      <h3>{e.title}</h3>
      <p>{e.text}</p>
      {e.attachment &&
        (e.attachment.mime.startsWith('image/') ? (
          <a href={e.attachment.url} target="_blank" rel="noreferrer">
            <img className="report-image" src={e.attachment.url} alt={e.attachment.name} />
          </a>
        ) : (
          <audio controls src={e.attachment.url} />
        ))}
      {e.attachment && (
        <div className="material-note">素材已保存 · 自动视觉/语音解析待云模型接入</div>
      )}
      {e.unknown_fields.length > 0 && (
        <div className="unknown-fields">
          <CircleHelp size={14} />
          待核实：{e.unknown_fields.join('、')}
        </div>
      )}
      <div className="evidence-source">
        <span>
          {e.id} · {e.source}
        </span>
        <span>{e.time}</span>
      </div>
    </article>
  )
}

export function Reports({ state: s, act, busy }: { state: AppState; act: Act; busy: boolean }) {
  const [region, setRegion] = useState('R12'),
    [text, setText] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [filter, setFilter] = useState('all')
  const inputRef = useRef<HTMLInputElement>(null)
  const samples = [
    {
      title: '现场求助',
      icon: MessageSquare,
      text: '鹿鸣村目前没有手机信号，村委会还有备用电源，但剩余电量不清楚，待核实。',
    },
    {
      title: '转写文本样例',
      icon: AudioLines,
      text: '【人工转写样例】这里是鹿鸣村，我们现在联系不上镇里，手机没信号，不知道基站还有没有电。',
    },
    {
      title: '过期证据',
      icon: Clock3,
      text: '这张旧照是昨天拍的，路上有积水，但现在道路能不能通行还没确认。',
    },
  ]
  const submit = () =>
    act(async () => {
      if (file) {
        const form = new FormData()
        form.append('file', file)
        form.append('text', text)
        form.append('region_id', region)
        await api('/api/reports/upload', form, { drillId: s.drill_id })
      } else
        await api(
          '/api/reports',
          {
            region_id: region,
            text,
            modality: text.startsWith('【人工转写样例】') ? 'transcript' : 'text',
          },
          { drillId: s.drill_id },
        )
      setText('')
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
    }, '现场证据已保存。状态快照已更新，旧方案需重新生成。')
  return (
    <div className="reports-layout">
      <section className="panel report-form">
        <div className="panel-heading">
          <div>
            <h2>
              <Upload size={17} />
              提交现场报告
            </h2>
            <span className="panel-sub">文字、图片和语音素材可追溯保存</span>
          </div>
        </div>
        <div className="form-body">
          <label className="field-label" htmlFor="report-region">
            所属区域
          </label>
          <div className="select-wrap">
            <MapPin size={16} />
            <select id="report-region" value={region} onChange={(e) => setRegion(e.target.value)}>
              {s.regions.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.name} · {r.id}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
          <label className="field-label" htmlFor="report-text">
            现场情况
          </label>
          <textarea
            id="report-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={6000}
            rows={6}
            placeholder="请描述现场发生了什么、何时发生，以及哪些信息还不确定…"
          />
          <div className="text-counter">{text.length} / 6000</div>
          <label className="upload-zone" htmlFor="report-file">
            <Upload size={22} />
            <strong>{file ? file.name : '选择图片或语音素材'}</strong>
            <span>PNG / JPG / WebP / 常见音频 · 小于 8 MB</span>
            <input
              ref={inputRef}
              id="report-file"
              type="file"
              accept="image/png,image/jpeg,image/webp,audio/*,video/webm"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          {file && (
            <button
              className="text-button remove-file"
              onClick={() => {
                setFile(null)
                if (inputRef.current) inputRef.current.value = ''
              }}
            >
              <X size={13} />
              移除素材
            </button>
          )}
          <div className="info-note">
            <CircleHelp size={15} />
            <span>
              本版按文字关键词标记不确定项与历史材料。图片/音频仅保存，自动解析待云模型接入。
            </span>
          </div>
          <button
            className="button primary full"
            disabled={busy || (!text.trim() && !file)}
            onClick={() => void submit()}
          >
            <Send size={16} />
            提交并更新证据
          </button>
          <div className="sample-heading">快速试用</div>
          <div className="sample-buttons">
            {samples.map((sample) => (
              <button key={sample.title} onClick={() => setText(sample.text)}>
                <sample.icon size={14} />
                {sample.title}
                <Plus size={13} />
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="evidence-feed">
        <div className="section-title">
          <h2>
            证据时间线 <span>{s.evidence.length}</span>
          </h2>
          <div className="select-wrap compact">
            <select
              aria-label="筛选证据区域"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">全部区域</option>
              {s.regions.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
        </div>
        <div className="evidence-grid">
          {s.evidence
            .filter((e) => filter === 'all' || e.region_id === filter)
            .map((e) => (
              <EvidenceCard key={e.id} evidence={e} state={s} />
            ))}
        </div>
        {!s.evidence.some((e) => filter === 'all' || e.region_id === filter) && (
          <div className="panel">
            <Empty
              icon={FileText}
              title="这个区域还没有现场报告"
              detail="补充一条现场信息，让核实流程获得新的证据。"
            />
          </div>
        )}
      </section>
    </div>
  )
}

export function Plans({
  state: s,
  plan,
  act,
  busy,
  run,
  policy,
  setPolicy,
  onReceipts,
}: {
  state: AppState
  plan?: Plan
  act: Act
  busy: boolean
  run: () => void
  policy: string
  setPolicy: (p: string) => void
  onReceipts: () => void
}) {
  const roadClosed = !s.roads.find((r) => r.id === 'RD14')?.open,
    batteryLow = (s.resources.find((r) => r.id === 'PORTABLE-01')?.battery || 0) <= 15
  const latestJob = Object.values(s.jobs).at(-1)
  return (
    <div className="plans-layout">
      <section className="plan-main">
        {latestJob?.status === 'failed' && (
          <div className="warning-banner persistent-error" role="alert">
            <Flag size={19} />
            <div>
              <strong>本轮未生成可执行的新方案</strong>
              <span>{latestJob.error}</span>
            </div>
          </div>
        )}
        <div className="plan-toolbar">
          <div className="select-wrap">
            <GitBranch size={16} />
            <select
              aria-label="保障优化策略"
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
            >
              <option value="balanced">优先缩短最晚恢复时间</option>
              <option value="coverage">优先减少人口加权等待</option>
            </select>
            <ChevronDown size={15} />
          </div>
          <button className="button primary" disabled={busy} onClick={run}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            {plan ? '重新研判与规划' : '生成保障方案'}
          </button>
        </div>
        <PlanningFailure state={s} />
        {!plan ? (
          <div className="panel">
            <Empty
              icon={Route}
              title="先找到信息空白，再安排保障资源"
              detail="启动协同流程后，将核实鹿鸣村状态，读取道路与设备，计算两支队伍的可行方案。"
            />
            <div className="empty-rules">
              <span>
                <Check size={14} />
                道路可达
              </span>
              <span>
                <Check size={14} />
                资源不冲突
              </span>
              <span>
                <Check size={14} />
                电量有余量
              </span>
              <span>
                <Check size={14} />
                人工审查
              </span>
            </div>
          </div>
        ) : (
          <section className={`panel plan-card ${plan.status === 'stale' ? 'stale-plan' : ''}`}>
            <div className="plan-header">
              <div>
                <span className="eyebrow">COMMUNICATION PLAN / 保障方案</span>
                <h2>
                  {plan.actions.length} 项保障任务，涉及 {plan.affected_people_proxy} 人
                  <small>人口为合成代理值</small>
                </h2>
                <p>
                  {plan.id} <span>·</span> 快照 v{plan.snapshot_version} <span>·</span>{' '}
                  {dateText(plan.created_at)}
                </p>
              </div>
              <Badge
                tone={
                  plan.status === 'executed'
                    ? 'online'
                    : plan.status === 'stale'
                      ? 'offline'
                      : 'unknown'
                }
              >
                {planNames[plan.status]}
              </Badge>
            </div>
            {plan.status === 'stale' && (
              <div className="warning-banner">
                <Flag size={18} />
                <div>
                  <strong>事件已变化，原方案已失效。</strong>
                  <span>请基于当前快照 v{s.version} 重新规划，之前的批准不可用于执行新方案。</span>
                </div>
              </div>
            )}
            <div className="plan-stats">
              <div>
                <span>最长预计恢复</span>
                <strong>
                  {plan.eta_minutes}
                  <small>演练分钟</small>
                </strong>
              </div>
              <div>
                <span>参与队伍</span>
                <strong>
                  {plan.actions.length}
                  <small>支</small>
                </strong>
              </div>
              <div>
                <span>约束校验</span>
                <strong className="text-status">
                  {plan.status === 'stale'
                    ? '需要重算'
                    : plan.status === 'executed'
                      ? '执行已记录'
                      : plan.validation?.valid
                        ? '已通过'
                        : '需检查'}
                  <ShieldCheck size={19} />
                </strong>
              </div>
            </div>
            <div className="plan-actions">
              {plan.actions.map((a, i) => (
                <article className="task-card" key={a.id}>
                  <div className="task-top">
                    <span className={`task-number n${i}`}>0{i + 1}</span>
                    <div>
                      <h3>
                        {a.region_name} · {a.title}
                      </h3>
                      <span>
                        {a.team_name} <b>·</b>{' '}
                        {a.type === 'deploy_portable' ? '携带便携通信设备' : '现场维护'}
                      </span>
                    </div>
                    <div className="task-eta">
                      {a.eta_minutes}
                      <span>分钟</span>
                    </div>
                  </div>
                  <div className="task-route">
                    <Navigation size={15} />
                    <div>
                      {a.route.nodes.map((id, index) => (
                        <span key={`${id}-${index}`}>
                          {regionName(s, id)}
                          {index < a.route.nodes.length - 1 && <ChevronRight size={12} />}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="task-constraints">
                    <span>
                      <Clock3 size={13} />
                      路程 {a.route.minutes} 分钟 + 部署 {a.deploy_minutes} 分钟
                    </span>
                    {a.battery_required > 0 && (
                      <span>
                        <Battery size={14} />
                        需电量 {a.battery_required} 分钟（含预留）
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <PlanInsights plan={plan} />
            <div className="plan-knowledge">
              <BookOpen size={15} />
              <div>
                <strong>方案依据</strong>
                {plan.citations.map((c) => (
                  <span key={c.id}>
                    {c.id} §{c.section} · {c.title}
                  </span>
                ))}
              </div>
              <Badge>演练规则</Badge>
            </div>
            <div className="solver-note">
              <Code2 size={14} />
              <span>
                实际计算：有限队伍分配枚举 + Dijkstra 最短路。仅在声明的图模型与约束内求解。
              </span>
            </div>
            <div className="plan-decision">
              {plan.status === 'draft' && (
                <>
                  <span>
                    <ShieldCheck size={17} />
                    请审查路径与资源后批准此快照方案
                  </span>
                  <button
                    className="button primary"
                    disabled={busy || !plan.validation?.valid}
                    onClick={() =>
                      void act(
                        () => api(`/api/plans/${plan.id}/approve`, {}, { drillId: s.drill_id }),
                        '方案已获批准，接下来可以执行演练。',
                      )
                    }
                  >
                    <Check size={16} />
                    批准此方案
                  </button>
                </>
              )}
              {plan.status === 'approved' && (
                <>
                  <span>
                    <CheckCheck size={17} />
                    已绑定批准记录与方案摘要
                  </span>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api(`/api/plans/${plan.id}/execute`, {}, { drillId: s.drill_id }),
                        '图模型保障任务已完成，演练消息已发出。请到回执中心实际接收。',
                      )
                    }
                  >
                    <Send size={16} />
                    执行演练并发送消息
                  </button>
                </>
              )}
              {plan.status === 'executed' && (
                <>
                  <span>
                    <CheckCheck size={17} />
                    资源恢复已仿真完成，等待实际终端回执
                  </span>
                  <button className="button primary" onClick={onReceipts}>
                    前往回执中心
                    <ArrowRight size={16} />
                  </button>
                </>
              )}
              {plan.status === 'stale' && (
                <>
                  <span>旧方案保留供审计，执行入口已关闭</span>
                  <button className="button primary" disabled={busy} onClick={run}>
                    <RefreshCw size={16} />
                    基于最新状态重算
                  </button>
                </>
              )}
            </div>
          </section>
        )}
        {s.plans.length > 1 && (
          <div className="panel plan-history">
            <h3>历史方案</h3>
            {s.plans.slice(1).map((p) => (
              <div key={p.id}>
                <span>{p.id}</span>
                <span>v{p.snapshot_version}</span>
                <span>{p.eta_minutes} 分钟</span>
                <Badge>{planNames[p.status]}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>
      <aside className="resource-sidebar">
        <section className="panel">
          <div className="panel-heading">
            <h2>
              <Layers3 size={17} />
              保障资源
            </h2>
            <Badge>{s.metrics.available_resources} 项可用</Badge>
          </div>
          <div className="resource-list">
            {s.resources.map((r) => {
              const Icon = r.type === 'team' ? Users : r.type === 'portable' ? Radio : Battery
              return (
                <div className="resource-row" key={r.id}>
                  <span className={`resource-icon ${r.type}`}>
                    <Icon size={20} />
                  </span>
                  <div>
                    <strong>{r.name}</strong>
                    <span>
                      <MapPin size={11} />
                      {regionName(s, r.location)}
                      {r.battery !== undefined && <> · {r.battery} 分钟电量</>}
                    </span>
                  </div>
                  <Dot kind={r.status === 'available' ? 'online' : 'unknown'} />
                </div>
              )
            })}
          </div>
          <p className="resource-foot">队伍与便携设备参与约束检查 · 移动电源预留</p>
        </section>
        <section className="panel injection-panel">
          <div className="panel-heading">
            <div>
              <h2>
                <Flag size={17} />
                演练事件注入
              </h2>
              <span className="panel-sub">改变条件，检查系统如何应对</span>
            </div>
          </div>
          <div className="injection-body">
            <button
              disabled={busy}
              className={`injection-button ${roadClosed ? 'injected' : ''}`}
              onClick={() =>
                void act(
                  () => api('/api/inject/road', {}, { drillId: s.drill_id }),
                  roadClosed
                    ? '南湾—鹿鸣路段已恢复，请重新规划。'
                    : '南湾—鹿鸣路段已关闭，旧方案已失效。',
                )
              }
            >
              <Unplug size={19} />
              <div>
                <strong>{roadClosed ? '恢复中断路段' : '中断关键路段'}</strong>
                <span>南湾村 — 鹿鸣村 · RD14</span>
              </div>
              <ChevronRight size={15} />
            </button>
            <button
              disabled={busy}
              className={`injection-button ${batteryLow ? 'injected' : ''}`}
              onClick={() =>
                void act(
                  () => api('/api/inject/battery', {}, { drillId: s.drill_id }),
                  batteryLow
                    ? '设备电量已恢复，可重新规划。'
                    : '设备剩余电量降至 15 分钟，规划器将重新检查可行性。',
                )
              }
            >
              <Battery size={19} />
              <div>
                <strong>{batteryLow ? '恢复设备电量' : '降低设备电量'}</strong>
                <span>便携设备 · {batteryLow ? '恢复至 180 分钟' : '降至 15 分钟'}</span>
              </div>
              <ChevronRight size={15} />
            </button>
            <p>
              <CircleHelp size={14} />
              注入事件会更新快照并使未执行方案失效。执行完成后可重置演练重新体验。
            </p>
          </div>
        </section>
        <div className="side-quote">
          <span>“</span>
          <p>
            好的方案，应该在条件改变时
            <br />
            仍然知道自己能做什么。
          </p>
          <small>把不可行明确告诉使用者</small>
        </div>
      </aside>
    </div>
  )
}
