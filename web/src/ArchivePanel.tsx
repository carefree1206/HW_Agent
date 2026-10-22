import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Clock3,
  FileText,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import { api } from './api'
import type { AppState } from './types'
import { Badge, dateText, Empty } from './common'

interface Summary {
  drill_id: string
  title: string
  archived_at: string
  simulation_time: string
  metrics: AppState['metrics']
  plan_count: number
  event_count: number
}
export function ArchivePanel() {
  const [rows, setRows] = useState<Summary[]>([])
  const [selected, setSelected] = useState<AppState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void api<{ drills: Summary[] }>('/api/history', undefined, { signal: controller.signal })
      .then((data) => setRows(data.drills))
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [reload])
  const open = async (id: string) => {
    setLoading(true)
    setError('')
    try {
      setSelected(await api<AppState>(`/api/history/${encodeURIComponent(id)}`))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="archive-panel">
      <div className="archive-heading">
        <div>
          <h3>历史演练归档</h3>
          <p>重置前的证据、批准与回执继续保留，可导出完整记录。</p>
        </div>
        <button className="text-button" onClick={() => setReload((n) => n + 1)} disabled={loading}>
          <RefreshCw size={14} />
          刷新
        </button>
      </div>
      {error && (
        <div className="info-note" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <div className="archive-loading" role="status">
          <LoaderCircle className="spin" size={17} />
          读取归档记录…
        </div>
      )}
      {!loading && !rows.length && (
        <Empty
          icon={FileText}
          title="尚无归档演练"
          detail="使用“重置演练”时会先保存当前记录，再创建新的演练编号。"
        />
      )}
      <div className="archive-list">
        {rows.map((row) => (
          <button
            disabled={loading}
            key={row.drill_id}
            className={selected?.drill_id === row.drill_id ? 'selected' : ''}
            onClick={() => void open(row.drill_id)}
          >
            <span className="archive-icon">
              <Clock3 size={18} />
            </span>
            <div>
              <strong>{row.title}</strong>
              <p>
                {row.drill_id} ·{' '}
                {new Date(row.archived_at).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                  hour12: false,
                })}
              </p>
            </div>
            <span>
              {row.plan_count} 份方案 · {row.event_count} 条动态
            </span>
            <Badge>
              {row.metrics.human_confirmed}/{row.metrics.targets} 确认
            </Badge>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
      {selected && (
        <section className="archive-detail" aria-label="历史演练详情">
          <div className="archive-heading">
            <div>
              <Badge>只读归档</Badge>
              <h3>{selected.drill_id}</h3>
              <p>
                演练时刻 {selected.simulation_time} · 快照 v{selected.version} ·{' '}
                {selected.evidence.length} 条证据
              </p>
            </div>
            <a
              className="button light small"
              href={`/api/history/${encodeURIComponent(selected.drill_id)}/export`}
              download
            >
              <ArrowDownToLine size={14} />
              导出归档 JSON
            </a>
          </div>
          <div className="archive-plans">
            {selected.plans.map((plan) => (
              <article key={plan.id}>
                <strong>{plan.id}</strong>
                <span>
                  {plan.eta_minutes} 演练分钟 · {plan.actions.length} 项任务
                </span>
                <small>批准记录：{plan.approval_id || '未批准'}</small>
              </article>
            ))}
          </div>
          <div className="full-events">
            {selected.events.slice(0, 12).map((event) => (
              <article key={event.id}>
                <span className={`event-dot ${event.kind}`} />
                <div>
                  <h3>
                    {event.title}
                    <time>{dateText(event.at)}</time>
                  </h3>
                  <p>{event.detail}</p>
                  <span>
                    {event.actor} · 演练 {event.time}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
