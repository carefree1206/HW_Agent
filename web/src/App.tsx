import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  CheckCheck,
  CircleHelp,
  Clock3,
  CloudRain,
  Flag,
  RefreshCw,
  WifiOff,
  X,
} from 'lucide-react'
import { api, ApiError, bindDrill } from './api'
import type { AppState } from './types'
import { tabs, Dot, Badge, type Tab, type Act } from './common'
import { Metrics, SituationMap, RegionPanel, AgentFlow, EventFeed } from './Dashboard'
import { Reports, Plans } from './Workflow'
import { Terminal, Receipts } from './Terminal'
import { Runtime, Knowledge } from './Runtime'
import { Modal } from './Modal'
import { StoryProgress } from './StoryProgress'

function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [tab, setTab] = useState<Tab>('command')
  const [selected, setSelected] = useState('R12')
  const [busy, setBusy] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const [knowledge, setKnowledge] = useState(false)
  const [policy, setPolicy] = useState('balanced')
  const [resetOpen, setResetOpen] = useState(false)
  const mounted = useRef(true)
  const actionLock = useRef(false)
  const refreshTask = useRef<Promise<void> | null>(null)
  const refreshRequested = useRef(false)
  const requestController = useRef<AbortController | null>(null)
  const shownErrors = useRef(new Set<string>())
  const terminalOnly = new URLSearchParams(location.search).get('terminal')
  const refresh = useCallback(async () => {
    if (!mounted.current) return
    refreshRequested.current = true
    if (refreshTask.current) return refreshTask.current
    const work = async () => {
      try {
        while (refreshRequested.current && mounted.current) {
          refreshRequested.current = false
          const controller = new AbortController()
          requestController.current = controller
          try {
            const next = await api<AppState>('/api/state', undefined, { signal: controller.signal })
            if (!mounted.current) return
            bindDrill(next.drill_id)
            setState(next)
            setConnectionError('')
            for (const job of Object.values(next.jobs)) {
              if (job.status === 'failed' && !shownErrors.current.has(job.id)) {
                shownErrors.current.add(job.id)
                setToast({ text: job.error || '本轮流程未完成，请查看运行记录。', error: true })
              }
            }
          } catch (error) {
            if (mounted.current && (!(error instanceof ApiError) || error.code !== 'CANCELLED'))
              setConnectionError((error as Error).message)
          }
        }
      } finally {
        refreshTask.current = null
      }
    }
    refreshTask.current = work()
    return refreshTask.current
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = setInterval(() => {
      if (!document.hidden) void refresh()
    }, 1300)
    const onVisible = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      mounted.current = false
      requestController.current?.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 6500)
      return () => clearTimeout(t)
    }
  }, [toast])
  const notify = (text: string, error = false) => setToast({ text, error })
  const act: Act = async (work, success) => {
    if (actionLock.current) return false
    actionLock.current = true
    setBusy(true)
    try {
      await work()
      await refresh()
      if (success) notify(success)
      return true
    } catch (err) {
      notify((err as Error).message, true)
      await refresh()
      return false
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }
  const running = !!state && Object.values(state.jobs).some((j) => j.status === 'running')
  const plan = state?.plans.find((p) => p.id === state.active_plan_id)
  const run = () =>
    act(
      () => api('/api/run', { policy }, { drillId: state?.drill_id }),
      '协同流程已启动，可查看下方角色记录。',
    )
  const reset = () =>
    act(async () => {
      await api('/api/reset', {}, { drillId: state?.drill_id })
      setSelected('R12')
      setTab('command')
      setResetOpen(false)
      shownErrors.current.clear()
    }, '当前演练已归档，新的演练已就绪。历史记录可在运行记录中查看。')
  if (!state)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          u<span />
        </div>
        <h1>未送达</h1>
        <p>{connectionError || '正在连接通信保障工作台…'}</p>
        <button className="button primary" onClick={() => void refresh()}>
          <RefreshCw size={16} />
          重新连接
        </button>
      </div>
    )
  return (
    <div className={`app ${terminalOnly ? 'terminal-only' : ''}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="未送达首页">
          <div className="brand-mark">
            u<span />
          </div>
          <div>
            <strong>
              未送达
              <span className="brand-divider" />
              <small>UNDELIVERED</small>
            </strong>
            <p>应急通信协同工作台</p>
          </div>
        </a>
        {!terminalOnly && (
          <nav aria-label="主导航">
            {tabs.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? 'nav-item active' : 'nav-item'}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => setTab(item.id)}
              >
                <item.icon size={16} />
                {item.label}
                {item.id === 'reports' && (
                  <span className="nav-count">{state.evidence.length}</span>
                )}
              </button>
            ))}
          </nav>
        )}
        <div className="header-tools">
          <span className="mode-pill">
            <span />
            本地演练版
          </span>
          <button
            className="icon-button"
            title="演练规则与能力说明"
            aria-label="演练规则与能力说明"
            onClick={() => setKnowledge(true)}
          >
            <CircleHelp size={19} />
          </button>
          <span className="avatar">演</span>
        </div>
      </header>
      {connectionError && (
        <div className="connection-error">
          <WifiOff size={16} />
          {connectionError}
          <button onClick={() => void refresh()}>重试</button>
        </div>
      )}
      {terminalOnly ? (
        <main className="terminal-page">
          <div className="eyebrow">FIELD TERMINAL / 实际软件回执</div>
          <h1>让消息抵达最后一公里。</h1>
          <Terminal
            state={state}
            initialRegion={terminalOnly}
            act={act}
            notify={notify}
            refresh={refresh}
          />
        </main>
      ) : (
        <main className="main">
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-line" />
                COMMUNICATION CONTINUITY / 通信保障
              </div>
              <h1>
                {tab === 'command' ? (
                  <>
                    每一条消息，<span>都该抵达。</span>
                  </>
                ) : (
                  tabs.find((t) => t.id === tab)?.label
                )}
              </h1>
              <p>
                {tab === 'command'
                  ? '看见沉默的区域，连接没有被听见的人。'
                  : tab === 'reports'
                    ? '把现场信息变成可追溯的证据，让未知得到核实。'
                    : tab === 'plans'
                      ? '在道路、队伍与电量约束下，给出可检查的保障方案。'
                      : tab === 'receipts'
                        ? '从发出到收到，再到人的确认，每一步独立记录。'
                        : '检查每一次工具调用、角色处理和状态变化。'}
              </p>
            </div>
            <div className="heading-right">
              <div className="scenario-meta">
                <CloudRain size={19} />
                <span>云溪县 · 暴雨通信保障演练</span>
                <Badge>合成场景</Badge>
              </div>
              <div className="heading-actions">
                <span className="drill-time">
                  <Clock3 size={14} />
                  演练时刻 <b>{state.simulation_time}</b>
                  <span className="meta-divider" />
                  快照 v{state.version}
                </span>
                <a className="button light small" href="/api/export" download>
                  <ArrowDownToLine size={15} />
                  导出记录
                </a>
                <button
                  className="icon-button reset"
                  title="重置演练"
                  aria-label="重置演练"
                  disabled={busy || running}
                  onClick={() => setResetOpen(true)}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>
          </section>
          {tab === 'command' && (
            <>
              <Metrics state={state} />
              <StoryProgress
                state={state}
                plan={plan}
                busy={busy || running}
                onRun={() => void run()}
                onPlan={() => setTab('plans')}
                onReceipts={() => setTab('receipts')}
              />
              <div className="command-grid">
                <SituationMap
                  state={state}
                  selected={selected}
                  onSelect={setSelected}
                  plan={plan}
                />
                <RegionPanel
                  state={state}
                  region={state.regions.find((r) => r.id === selected)!}
                  onRun={() => void run()}
                  disabled={busy || running}
                  plan={plan}
                  onPlan={() => setTab('plans')}
                />
              </div>
              <div className="lower-grid">
                <AgentFlow
                  state={state}
                  onRun={() => void run()}
                  disabled={busy || running}
                  onPlan={() => setTab('plans')}
                />
                <EventFeed state={state} onAll={() => setTab('runtime')} />
              </div>
            </>
          )}
          {tab === 'reports' && <Reports state={state} act={act} busy={busy || running} />}
          {tab === 'plans' && (
            <Plans
              state={state}
              plan={plan}
              act={act}
              busy={busy || running}
              run={() => void run()}
              policy={policy}
              setPolicy={setPolicy}
              onReceipts={() => setTab('receipts')}
            />
          )}
          {tab === 'receipts' && (
            <Receipts state={state} act={act} notify={notify} refresh={refresh} />
          )}
          {tab === 'runtime' && (
            <Runtime
              state={state}
              act={act}
              busy={busy || running}
              onKnowledge={() => setKnowledge(true)}
            />
          )}
          <footer className="footer">
            <span>
              <span className="footer-logo">u</span> 未送达 <span className="footer-dot">·</span>{' '}
              让沉默被看见
            </span>
            <span>
              合成数据 · 本地规则流程 · 资源恢复为仿真 <span className="footer-dot">/</span> 华为
              AgentArts 接入待完成
            </span>
            <span className="footer-status">
              <Dot kind={connectionError ? 'offline' : 'online'} />
              {connectionError
                ? '服务断开 · 保留上次状态'
                : `服务已连接 v${state.app_version || '0.2.0'}`}
            </span>
          </footer>
        </main>
      )}
      {knowledge && <Knowledge onClose={() => setKnowledge(false)} state={state} />}
      {resetOpen && (
        <Modal title="归档并开始新演练" onClose={() => !busy && setResetOpen(false)}>
          <div className="reset-summary">
            <p>将保存当前演练的证据、方案、批准与回执，然后开始新的场景。</p>
            <div>
              <span>
                <b>{state.evidence.length}</b>条证据
              </span>
              <span>
                <b>{state.plans.length}</b>份方案
              </span>
              <span>
                <b>{state.messages.length}</b>条消息记录
              </span>
            </div>
            <small>{state.drill_id}</small>
          </div>
          <div className="modal-actions">
            <button className="button light" disabled={busy} onClick={() => setResetOpen(false)}>
              保留当前演练
            </button>
            <button
              className="button primary"
              disabled={busy || running}
              onClick={() => void reset()}
            >
              归档并开始新演练
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} role="status">
          {toast.error ? <Flag size={19} /> : <CheckCheck size={19} />}
          <span>{toast.text}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
export default App
