import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Battery,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  LoaderCircle,
  MapPin,
  MessageSquare,
  Radio,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { api, ApiError } from './api'
import type { AppState, Message } from './types'
import { Badge, dateText, regionName, type Act } from './common'
import {
  enqueue,
  isTerminalStorage,
  loadInbox,
  loadOutbox,
  removePending,
  saveInbox,
  terminalClient,
  type PendingReceipt,
} from './terminalStorage'

export type TerminalProps = {
  state: AppState
  initialRegion?: string
  act: Act
  notify: (text: string, error?: boolean) => void
  refresh: () => Promise<void>
}
export function Terminal({ state: s, initialRegion = 'R12', act, notify, refresh }: TerminalProps) {
  const [region, setRegion] = useState(
    s.regions.some((r) => r.id === initialRegion) ? initialRegion : 'R12',
  )
  const drillId = s.drill_id,
    noticeId = s.delivery.active_notice_id
  const context = `${drillId}/${region}/${noticeId || ''}`
  const current = useRef(context)
  current.current = context
  const clientId = useRef(terminalClient())
  const [inbox, setInbox] = useState<Message[]>(() => loadInbox(drillId, region, noticeId))
  const [pending, setPending] = useState(() => loadOutbox(drillId))
  const [syncing, setSyncing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  const [volatile, setVolatile] = useState(false)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => {
    setInbox(loadInbox(drillId, region, noticeId))
    setPending(loadOutbox(drillId))
    setSyncing(false)
    setConfirming(false)
    const onStorage = (event: StorageEvent) => {
      if (isTerminalStorage(event.key)) {
        setInbox(loadInbox(drillId, region, noticeId))
        setPending(loadOutbox(drillId))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      operation.current?.abort()
      window.removeEventListener('storage', onStorage)
    }
  }, [drillId, region, noticeId])
  const online = !!s.terminal_links[region]
  const pendingHere = pending.filter((p) => p.region_id === region && p.notice_id === noticeId)
  const sameContext = () => current.current === context
  const remember = (messages: Message[]) => {
    if (!sameContext()) return
    if (!saveInbox(drillId, region, messages)) setVolatile(true)
    setInbox(messages)
  }
  const receiptBody = (receipt: PendingReceipt) => ({
    message_id: receipt.message_id,
    region_id: receipt.region_id,
    stage: receipt.stage,
    client_id: receipt.client_id,
  })
  const sync = async () => {
    if (syncing || confirming) return
    const controller = new AbortController()
    operation.current = controller
    const options = { drillId, signal: controller.signal }
    setSyncing(true)
    try {
      const response = await api<{
        drill_id: string
        notice_id: string | null
        messages: Message[]
      }>(`/api/terminal/${region}/messages`, undefined, options)
      if (!sameContext()) return
      if (response.drill_id !== drillId || response.notice_id !== noticeId) {
        await refresh()
        throw new ApiError('演练或通知已变化，请同步最新状态后重试。', 'NOTICE_CHANGED')
      }
      const messages: Message[] = []
      for (const message of response.messages) {
        const received = await api<Message>(
          '/api/receipts',
          {
            message_id: message.id,
            region_id: region,
            stage: 'terminal_received',
            client_id: clientId.current,
          },
          options,
        )
        if (!sameContext()) return
        messages.push(received)
        remember([...messages])
      }
      for (const receipt of loadOutbox(drillId).filter(
        (p) => p.region_id === region && p.notice_id === noticeId,
      )) {
        try {
          const confirmed = await api<Message>('/api/receipts', receiptBody(receipt), options)
          if (!sameContext()) return
          removePending(drillId, receipt.message_id)
          const index = messages.findIndex((m) => m.id === confirmed.id)
          if (index >= 0) messages[index] = confirmed
          remember([...messages])
        } catch (error) {
          if (error instanceof ApiError && error.code === 'NOT_FOUND')
            removePending(drillId, receipt.message_id)
          else throw error
        }
      }
      if (!sameContext()) return
      remember(messages)
      setPending(loadOutbox(drillId))
      await refresh()
      if (sameContext())
        notify(
          messages.length
            ? '消息已实际接收，当前通知的终端回执与待发确认已同步。'
            : '当前区域没有本轮消息，请先执行保障方案或检查通知目标。',
        )
    } catch (error) {
      if (sameContext() && (!(error instanceof ApiError) || error.code !== 'CANCELLED'))
        notify((error as Error).message, true)
    } finally {
      if (sameContext()) {
        setSyncing(false)
        setPending(loadOutbox(drillId))
      }
    }
  }
  const confirm = async (message: Message) => {
    if (confirming || syncing) return
    const receipt: PendingReceipt = {
      drill_id: drillId,
      notice_id: message.notice_id,
      message_id: message.id,
      region_id: region,
      stage: 'human_confirmed',
      client_id: clientId.current,
      requested_at: new Date().toISOString(),
    }
    if (!enqueue(receipt)) setVolatile(true)
    setPending(loadOutbox(drillId))
    setConfirming(true)
    try {
      const result = await api<Message>('/api/receipts', receiptBody(receipt), { drillId })
      removePending(drillId, message.id)
      if (!sameContext()) return
      remember(inbox.map((m) => (m.id === result.id ? result : m)))
      setPending(loadOutbox(drillId))
      await refresh()
      if (sameContext()) notify('已记录你对当前演练消息的显式确认。')
    } catch (error) {
      if (!sameContext()) return
      if (error instanceof ApiError && ['TERMINAL_OFFLINE', 'NETWORK_ERROR'].includes(error.code))
        notify('确认已暂存，恢复连接后点击同步补发。')
      else {
        if (!(error instanceof ApiError) || error.code !== 'DRILL_CHANGED')
          removePending(drillId, message.id)
        setPending(loadOutbox(drillId))
        notify((error as Error).message, true)
      }
    } finally {
      if (sameContext()) setConfirming(false)
    }
  }
  const latest = inbox.filter((m) => m.region_id === region && m.notice_id === noticeId).at(-1)
  const confirmed = !!(
    latest?.human_confirmed_at ||
    s.delivery.messages.find((m) => m.id === latest?.id)?.human_confirmed_at
  )
  const queued = !!latest && pendingHere.some((p) => p.message_id === latest.id)
  return (
    <section className="panel terminal-panel">
      <div className="panel-heading">
        <div>
          <h2>
            <Radio size={17} />
            现场演练终端
          </h2>
          <span className="panel-sub">收件箱和待发回执按演练独立保存</span>
        </div>
        <a className="text-button" href={`/?terminal=${region}`} target="_blank" rel="noreferrer">
          独立打开
          <ArrowUpRight size={14} />
        </a>
      </div>
      <div className="terminal-body">
        <div className="terminal-selection">
          <div className="select-wrap">
            <MapPin size={16} />
            <select
              aria-label="终端所属区域"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              {s.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <Badge tone={online ? 'online' : 'offline'}>
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? '演练链路在线' : '演练链路离线'}
          </Badge>
        </div>
        <div className={`phone-screen ${online ? '' : 'offline-screen'}`}>
          <div className="phone-status">
            <span>通信保障演练</span>
            <span>
              {online ? <Wifi size={13} /> : <WifiOff size={13} />}
              <Battery size={15} />
            </span>
          </div>
          <div className="phone-header">
            <span className="phone-mark">
              <Radio size={22} />
            </span>
            <h3>未送达 · 现场消息</h3>
            <p>
              {regionName(s, region)} / {clientId.current}
            </p>
          </div>
          {latest ? (
            <div className="phone-message">
              <div>
                <Badge>演练消息</Badge>
                <time>{dateText(latest.created_at)}</time>
              </div>
              <p>{latest.text}</p>
              <div className="phone-received">
                <CheckCheck size={13} />
                终端接收 {dateText(latest.terminal_received_at)}
              </div>
              <button
                className={`button full ${confirmed ? 'confirmed' : 'primary'}`}
                disabled={confirmed || queued || confirming || syncing}
                onClick={() => void confirm(latest)}
              >
                {confirming ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                {confirmed
                  ? '你已确认收到'
                  : queued
                    ? '确认已暂存，等待联网补发'
                    : '我已收到这条演练消息'}
              </button>
            </div>
          ) : (
            <div className="phone-empty">
              <MessageSquare size={31} strokeWidth={1.3} />
              <strong>等待接收演练消息</strong>
              <span>
                {noticeId ? '点击下方按钮同步本轮消息。' : '保障方案执行后，消息会进入发送队列。'}
              </span>
            </div>
          )}
          <div className="phone-footer">终端收到 ≠ 人员确认 ≠ 人员安全</div>
        </div>
        <div className="terminal-actions">
          <button
            className="button primary"
            disabled={syncing || confirming}
            onClick={() => void sync()}
          >
            {syncing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            接收消息 / 同步回执
          </button>
          <button
            className={`button ${online ? 'light' : 'offline-button'}`}
            disabled={linkBusy || syncing || confirming}
            onClick={async () => {
              setLinkBusy(true)
              await act(
                () => api(`/api/terminal/${region}/link`, { online: !online }, { drillId }),
                online
                  ? '演练终端已离线，可继续确认已缓存的消息。'
                  : '终端链路已恢复，可同步待发回执。',
              )
              setLinkBusy(false)
            }}
          >
            {online ? <WifiOff size={15} /> : <Wifi size={15} />}
            {online ? '注入离线' : '恢复连接'}
          </button>
        </div>
        {pendingHere.length > 0 && (
          <div className="info-note">
            <Clock3 size={15} />
            {pendingHere.length} 条当前演练、当前通知的确认等待补发
          </div>
        )}
        {volatile && (
          <div className="warning-banner" role="alert">
            浏览器持久化存储不可用，消息和待发确认仅保存在本次页面会话。关闭页面前请恢复连接并同步。
          </div>
        )}
        <p className="terminal-note">
          只同步当前这批通知。切换页面或刷新后仍保留已接收消息；离线确认会先暂存，联网同步成功后再计入人员确认。
        </p>
        <div className="terminal-context">
          演练 {drillId} · {noticeId || '待发布通知'}
        </div>
      </div>
    </section>
  )
}
