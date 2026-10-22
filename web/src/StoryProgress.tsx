import { ArrowRight, Check, CircleHelp, LoaderCircle, Radio } from 'lucide-react'
import type { AppState, Plan } from './types'
import { regionName } from './common'

export function StoryProgress({
  state: s,
  plan,
  busy,
  onRun,
  onPlan,
  onReceipts,
}: {
  state: AppState
  plan?: Plan
  busy: boolean
  onRun: () => void
  onPlan: () => void
  onReceipts: () => void
}) {
  const focusId =
    s.delivery.target_region_ids.includes('R12') || !s.delivery.active_notice_id
      ? 'R12'
      : s.delivery.target_region_ids[0]
  const focus = regionName(s, focusId)
  const message = s.delivery.messages.find((m) => m.region_id === focusId)
  const step =
    s.metrics.unknown > 0
      ? 0
      : !plan || plan.status === 'stale'
        ? 1
        : plan.status !== 'executed'
          ? 2
          : !message?.terminal_received_at
            ? 3
            : !message.human_confirmed_at
              ? 4
              : 5
  const titles = [
    '沉默，也是一条需要处理的信息。',
    '状态已核实，下一步把有限资源安排到位。',
    '方案已计算，等待审查后执行。',
    '链路恢复之后，还要确认消息是否抵达。',
    '终端已接收，还差操作者的显式确认。',
    `${focus}的消息闭环已完成。`,
  ]
  const details = [
    `鹿鸣村没有现场求助，却持续缺失心跳。先核实连接状态。`,
    plan?.status === 'stale'
      ? '道路、资源或证据已改变，上一份方案已失效。'
      : '将按当前道路、队伍与电量检查可行分配。',
    '可以查看候选方案比较、约束校验和人工批准记录。',
    `进入${focus}终端，通过实际请求接收本轮演练消息。`,
    '接收回执与人员确认分别计数，离线时可暂存确认。',
    `本轮仍有 ${Math.max(0, s.metrics.targets - s.metrics.human_confirmed)} 个目标等待确认，${s.metrics.affected} 个区域的链路问题继续跟踪。`,
  ]
  const action = step < 2 ? onRun : step === 2 ? onPlan : onReceipts
  return (
    <section className="story-progress" aria-label="演练故事进度">
      <div className="story-summary">
        <span className="story-icon">{step === 5 ? <Check size={21} /> : <Radio size={21} />}</span>
        <div>
          <span className="eyebrow">演练主线 · 看见没有被听见的人</span>
          <h2>{titles[step]}</h2>
          <p>{details[step]}</p>
        </div>
        <button className="button primary small" disabled={busy} onClick={action}>
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          {step < 2
            ? step === 0
              ? '开始核实与研判'
              : '重新规划'
            : step === 2
              ? '审查保障方案'
              : '进入现场终端'}
          <ArrowRight size={14} />
        </button>
      </div>
      <ol className="story-steps">
        {['发现沉默', '核实状态', '检查方案', '终端收到', '人员确认'].map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? 'step' : undefined}
            className={step > index ? 'done' : step === index ? 'current' : ''}
          >
            <span>{step > index ? <Check size={11} /> : `0${index + 1}`}</span>
            {label}
          </li>
        ))}
      </ol>
      {step === 5 && (
        <div className="story-reflection">
          <CircleHelp size={13} />
          这份确认说明消息被操作者看见；人的安全还需要更多真实信息。
        </div>
      )}
    </section>
  )
}
