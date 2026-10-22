import { useEffect, useState } from 'react'
import {
  Activity,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  GitBranch,
  Search,
  Unplug,
  X,
} from 'lucide-react'
import type { AppState, Citation } from './types'
import { api } from './api'
import { Badge, Empty, dateText, roles, stageNames, type Act } from './common'
import { ArchivePanel } from './ArchivePanel'
import { Modal } from './Modal'
import { ToolResult } from './ToolResult'

export function Runtime({
  state: s,
  act,
  busy,
  onKnowledge,
}: {
  state: AppState
  act: Act
  busy: boolean
  onKnowledge: () => void
}) {
  const [view, setView] = useState('tools')
  return (
    <>
      <section className="integration-grid">
        {s.integrations.map((item) => (
          <div className="panel integration-card" key={item.id}>
            <span className={`integration-icon ${item.status}`}>
              {item.id === 'mcp' ? (
                <Code2 size={18} />
              ) : item.id === 'rag' ? (
                <BookOpen size={18} />
              ) : item.id === 'workflow' ? (
                <GitBranch size={18} />
              ) : (
                <Unplug size={18} />
              )}
            </span>
            <div>
              <h3>
                {item.name}
                <Badge tone={item.status === 'local' ? 'online' : ''}>
                  {item.status === 'local' ? '本地可用' : '待接入'}
                </Badge>
              </h3>
              <p>{item.detail}</p>
            </div>
          </div>
        ))}
      </section>
      <section className="panel runtime-panel">
        <div className="runtime-toolbar">
          <div className="segmented">
            {[
              ['tools', `MCP 调用 · ${s.tool_calls.length}`],
              ['roles', `角色记录 · ${s.traces.length}`],
              ['events', `事件记录 · ${s.events.length}`],
              ['history', '历史演练'],
            ].map(([id, label]) => (
              <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="runtime-buttons">
            <button className="button light small" onClick={onKnowledge}>
              <BookOpen size={14} />
              演练知识库
            </button>
            <button
              disabled={busy}
              className="button primary small"
              onClick={() =>
                void act(
                  () => api('/api/integrations/ping', {}, { drillId: s.drill_id }),
                  'MCP 连通测试成功：真实 HTTP JSON-RPC 返回已记录。',
                )
              }
            >
              <Activity size={14} />
              测试 MCP
            </button>
          </div>
        </div>
        {view === 'history' && <ArchivePanel />}
        {view === 'tools' &&
          (s.tool_calls.length ? (
            <div className="tool-calls">
              {s.tool_calls.map((call) => (
                <details className="tool-call" key={`${call.id}-${call.tool}`}>
                  <summary>
                    <span className={`call-icon ${call.status}`}>
                      {call.status === 'success' ? <Check size={15} /> : <X size={15} />}
                    </span>
                    <div>
                      <strong>{call.tool}</strong>
                      <span>
                        {call.service} <b>·</b> {call.transport} <b>·</b> {call.id}
                      </span>
                    </div>
                    <Badge>{call.duration_ms} ms</Badge>
                    <time>{dateText(call.at)}</time>
                    <ChevronDown size={16} />
                  </summary>
                  <div className="call-detail">
                    <div>
                      <h4>实际请求参数</h4>
                      <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                    </div>
                    <ToolResult call={call} drillId={s.drill_id} />
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <Empty
              icon={Code2}
              title="等待第一次真实工具调用"
              detail="启动协同流程或点击“测试 MCP”，此处将展示实际参数、响应和服务耗时。"
            />
          ))}
        {view === 'roles' &&
          (s.traces.length ? (
            <div className="trace-list">
              {s.traces.map((t) => (
                <article key={t.id}>
                  <span className="trace-icon">
                    <GitBranch size={18} />
                  </span>
                  <div>
                    <div className="trace-top">
                      <h3>{t.title}</h3>
                      <Badge>{stageNames[t.status]}</Badge>
                    </div>
                    <p>{t.detail}</p>
                    <span>
                      {roles.find((r) => r.id === t.stage)?.label} · 本地规则执行 · {t.id} ·{' '}
                      {dateText(t.at)}
                    </span>
                    {t.references.length > 0 && (
                      <div className="trace-refs">依据：{t.references.join(' / ')}</div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon={GitBranch}
              title="协同角色尚未启动"
              detail="每个角色的实际处理摘要和证据引用会保存在这里。"
            />
          ))}
        {view === 'events' && (
          <div className="full-events">
            {s.events.map((e) => (
              <article key={e.id}>
                <span className={`event-dot ${e.kind}`} />
                <div>
                  <h3>
                    {e.title}
                    <time>{dateText(e.at)}</time>
                  </h3>
                  <p>{e.detail}</p>
                  <span>
                    {e.actor} · 演练 {e.time}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

export function Knowledge({ onClose, state: s }: { onClose: () => void; state: AppState }) {
  const [documents, setDocuments] = useState<Citation[]>([]),
    [q, setQ] = useState(''),
    [error, setError] = useState('')
  const [searching, setSearching] = useState(true)
  useEffect(() => {
    let cancelled = false
    setSearching(true)
    setError('')
    const timer = setTimeout(() => {
      void api<{ documents: Citation[] }>(`/api/knowledge?q=${encodeURIComponent(q)}`)
        .then((r) => {
          if (!cancelled) {
            setDocuments(r.documents)
            setError('')
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err.message)
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 150)
    return () => {
      clearTimeout(timer)
      cancelled = true
    }
  }, [q])
  return (
    <Modal title="演练规则与能力说明" onClose={onClose}>
      <div className="info-note">
        <BookOpen size={17} />
        <span>
          项目自定义的合成演练规则，按中文双字与 BM25 排序，保留来源、版本和内容摘要。尚未接入向量
          RAG 或生成模型。
        </span>
      </div>
      <div className="knowledge-search">
        <Search size={17} />
        <input
          aria-label="检索演练规则"
          placeholder="检索：电量、送达、未知、计划变更…"
          value={q}
          maxLength={500}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="knowledge-docs">
        {searching && (
          <p className="knowledge-loading" role="status">
            正在检索演练规则…
          </p>
        )}
        {!searching && !error && q.trim() && !documents.length && (
          <Empty
            icon={Search}
            title="没有匹配的演练规则"
            detail="可尝试“电量”“送达”“旧照片”或规则编号。无匹配时不会用无关规则填充结果。"
          />
        )}
        {!searching &&
          documents.map((d) => (
            <article key={d.id}>
              <div>
                <Badge>
                  {d.id} §{d.section}
                </Badge>
                <span>{d.version}</span>
              </div>
              <h3>{d.title}</h3>
              <p>{d.text}</p>
              {d.source && (
                <div className="knowledge-provenance">
                  <span>
                    {d.source} · {d.content_hash?.slice(0, 12)}
                  </span>
                  {d.score !== undefined && <span>检索分数 {d.score.toPrecision(3)}</span>}
                </div>
              )}
              {d.matched_terms?.length ? (
                <div className="knowledge-matches">命中：{d.matched_terms.join(' / ')}</div>
              ) : null}
            </article>
          ))}
      </div>
      <div className="cloud-pending">
        <Unplug size={18} />
        <div>
          <strong>华为平台与模型状态</strong>
          <p>
            {s.integrations
              .filter((i) => i.status === 'pending')
              .map((i) => `${i.name}：${i.detail}`)
              .join('；')}
            。
          </p>
        </div>
      </div>
    </Modal>
  )
}
