import { ArrowRight, Check, CheckCheck, MapPin, Radio, Send, Users } from 'lucide-react'
import { Badge, Dot, dateText } from './common'
import { Terminal, type TerminalProps } from './TerminalDevice'
export { Terminal } from './TerminalDevice'

export function Receipts({ state: s, act, notify, refresh }: TerminalProps) {
  const current = s.delivery
  const stages = [
    {
      icon: Send,
      label: '已进入发送队列',
      count: current.messages.length,
      note: `已发送 ${s.metrics.sent} · 待发 ${s.metrics.queued}`,
    },
    {
      icon: Radio,
      label: '终端实际接收',
      count: s.metrics.terminal_received,
      note: '当前通知的终端 HTTP 回执',
    },
    {
      icon: Users,
      label: '人员显式确认',
      count: s.metrics.human_confirmed,
      note: '当前通知的操作者显式确认',
    },
  ]
  return (
    <>
      <div className="notice-context">
        <Badge>{current.active_notice_id ? '当前通知' : '等待发布'}</Badge>
        <span>{current.active_notice_id || '执行保障方案后发布第一批消息'}</span>
        <small>历史通知的回执独立保留，不计入本轮</small>
      </div>
      <section className="receipt-stages">
        {stages.map((stage, index) => (
          <div key={stage.label} className="panel receipt-stage">
            <span className="receipt-stage-icon">
              <stage.icon size={23} />
            </span>
            <div>
              <span>{stage.label}</span>
              <strong>
                {stage.count}
                <small> / {s.metrics.targets}</small>
              </strong>
              <p>{stage.note}</p>
            </div>
            {index < 2 && <ArrowRight className="receipt-arrow" size={19} />}
          </div>
        ))}
      </section>
      <div className="receipt-layout">
        <section className="panel receipt-table-panel">
          <div className="panel-heading">
            <div>
              <h2>
                <CheckCheck size={17} />
                区域送达记录
              </h2>
              <span className="panel-sub">仅按当前通知的真实软件回执统计</span>
            </div>
            <Badge>{current.messages.length} 条本轮消息</Badge>
          </div>
          <div className="table-scroll">
            <table className="receipt-table">
              <thead>
                <tr>
                  <th>目标区域</th>
                  <th>链路状态</th>
                  <th>终端接收</th>
                  <th>人员确认</th>
                </tr>
              </thead>
              <tbody>
                {s.regions.map((region) => {
                  const message = current.messages.find((m) => m.region_id === region.id)
                  const targeted = current.target_region_ids.includes(region.id)
                  return (
                    <tr key={region.id}>
                      <td>
                        <span className="table-region">
                          <MapPin size={13} />
                          {region.name}
                        </span>
                        <small>{region.id}</small>
                      </td>
                      <td>
                        <Dot kind={s.terminal_links[region.id] ? 'online' : 'offline'} />
                        {s.terminal_links[region.id] ? '可达' : '离线'}
                      </td>
                      <td
                        className={message?.terminal_received_at ? 'received-cell' : 'pending-cell'}
                      >
                        {message?.terminal_received_at ? (
                          <>
                            <CheckCheck size={13} />
                            {dateText(message.terminal_received_at)}
                          </>
                        ) : message ? (
                          message.sent_at ? (
                            '等待接收'
                          ) : (
                            '等待发送'
                          )
                        ) : current.active_notice_id && !targeted ? (
                          '非本轮目标'
                        ) : (
                          '尚未发送'
                        )}
                      </td>
                      <td
                        className={message?.human_confirmed_at ? 'received-cell' : 'pending-cell'}
                      >
                        {message?.human_confirmed_at ? (
                          <>
                            <Check size={13} />
                            {dateText(message.human_confirmed_at)}
                          </>
                        ) : current.active_notice_id && !targeted ? (
                          '—'
                        ) : (
                          '等待确认'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
        <Terminal state={s} act={act} notify={notify} refresh={refresh} />
      </div>
    </>
  )
}
