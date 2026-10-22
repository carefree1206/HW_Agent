import type { ReactNode } from 'react'
import {
  Compass,
  FileText,
  Route,
  MessageSquare,
  Activity,
  Search,
  Radio,
  GitBranch,
  ShieldCheck,
} from 'lucide-react'
import type { AppState } from './types'

export type Tab = 'command' | 'reports' | 'plans' | 'receipts' | 'runtime'
export type Act = (work: () => Promise<unknown>, success?: string) => Promise<boolean>
export const tabs: { id: Tab; label: string; icon: typeof Compass }[] = [
  { id: 'command', label: '指挥中心', icon: Compass },
  { id: 'reports', label: '现场报告', icon: FileText },
  { id: 'plans', label: '方案与资源', icon: Route },
  { id: 'receipts', label: '回执中心', icon: MessageSquare },
  { id: 'runtime', label: '运行记录', icon: Activity },
]
export const statuses = {
  online: '链路正常',
  degraded: '链路拥塞',
  offline: '链路中断',
  unknown: '状态未知',
}
export const stageNames: Record<string, string> = {
  idle: '等待启动',
  running: '处理中',
  completed: '已完成',
  waiting: '等待核验',
  error: '需要处理',
}
export const planNames: Record<string, string> = {
  draft: '待审查',
  approved: '已批准',
  executed: '已执行',
  stale: '已失效',
  superseded: '已替代',
}
export const roles = [
  { id: 'assess', no: '01', label: '态势 Agent', task: '发现信息空白', icon: Search },
  { id: 'probe', no: '02', label: '核实 Agent', task: '主动核实关键状态', icon: Radio },
  { id: 'plan', no: '03', label: '调度 Agent', task: '计算路径与资源', icon: GitBranch },
  { id: 'verify', no: '04', label: '核验 Agent', task: '跟踪送达与确认', icon: ShieldCheck },
]
export const dateText = (at: string | null) =>
  at
    ? Number.isNaN(new Date(at).getTime())
      ? '时间待核实'
      : new Date(at).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
    : '等待回执'
export const regionName = (s: AppState, id: string) =>
  s.regions.find((r) => r.id === id)?.name || id
export function Dot({ kind }: { kind: string }) {
  return <span className={`dot ${kind}`} />
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}
export function Empty({
  icon: Icon = MessageSquare,
  title,
  detail,
}: {
  icon?: typeof MessageSquare
  title: string
  detail: string
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={24} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  )
}
