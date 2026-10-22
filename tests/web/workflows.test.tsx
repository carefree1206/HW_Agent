import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { StoryProgress } from '../../web/src/StoryProgress'
import { PlanInsights, PlanningFailure } from '../../web/src/PlanInsights'
import { Modal } from '../../web/src/Modal'
import { Receipts } from '../../web/src/Terminal'
import { ArchivePanel } from '../../web/src/ArchivePanel'
import { delivery, seed, plan } from './fixtures'

it('故事起点能启动核实，收到一个确认后仍显示其余未完成目标', async () => {
  const run = vi.fn(),
    s = seed()
  const props = { state: s, busy: false, onRun: run, onPlan: vi.fn(), onReceipts: vi.fn() }
  const { rerender } = render(<StoryProgress {...props} />)
  await userEvent.setup().click(screen.getByRole('button', { name: '开始核实与研判' }))
  expect(run).toHaveBeenCalledOnce()
  const next = delivery()
  next.metrics.unknown = 0
  next.metrics.affected = 1
  next.metrics.human_confirmed = 1
  next.metrics.targets = 12
  next.delivery.messages[0].terminal_received_at = '2026-10-22T02:31:00+08:00'
  next.delivery.messages[0].human_confirmed_at = '2026-10-22T02:32:00+08:00'
  rerender(<StoryProgress {...props} state={next} plan={{ ...plan(), status: 'executed' }} />)
  expect(screen.getByText(/仍有 11 个目标等待确认/)).toBeInTheDocument()
  expect(screen.getByText(/人的安全还需要更多真实信息/)).toBeInTheDocument()
})

it('方案页面同时呈现已选与备选分配，不隐藏耗时取舍', () => {
  render(<PlanInsights plan={plan()} />)
  const table = screen.getByRole('table', { name: '有限模型中的可行分配比较' })
  expect(within(table).getByText('44 分钟')).toBeInTheDocument()
  expect(within(table).getByText('53 分钟')).toBeInTheDocument()
  expect(within(table).getByText('116 分钟')).toBeInTheDocument()
  expect(screen.getByText('为什么选择这个方案')).toBeInTheDocument()
})

it('不可行页面保留具体缺口与下一步，并标记过时诊断', () => {
  const state = seed()
  state.planning_diagnostics = {
    status: 'infeasible',
    snapshot_version: state.version - 1,
    drill_id: state.drill_id,
    reasons: [
      {
        code: 'BATTERY_SHORTFALL',
        detail: '现有 15 分钟，任务至少需要 64 分钟。',
        region_name: '鹿鸣村',
        required_minutes: 64,
        available_minutes: 15,
        shortfall_minutes: 49,
      },
    ],
    suggestions: ['补充电量并重新校验。'],
    assignments_checked: 2,
    feasible_count: 0,
  }
  render(<PlanningFailure state={state} />)
  expect(screen.getByText('缺 49 分钟')).toBeInTheDocument()
  expect(screen.getByText('补充电量并重新校验。')).toBeInTheDocument()
  expect(screen.getByText('条件已变化 · 需重算')).toBeInTheDocument()
})

it('历史确认不显示在当前通知的表格和人员指标中', () => {
  const state = delivery(['R12'])
  state.messages = [
    {
      ...state.delivery.messages[0],
      id: 'OLD',
      notice_id: 'OLD-NOTICE',
      human_confirmed_at: '2026-10-22T01:11:00+08:00',
    },
    ...state.delivery.messages,
  ]
  render(
    <Receipts
      state={state}
      act={async (work) => {
        await work()
        return true
      }}
      refresh={async () => {}}
      notify={vi.fn()}
    />,
  )
  const table = screen.getByRole('table')
  expect(within(table).getByText('等待接收')).toBeInTheDocument()
  expect(within(table).getAllByText('非本轮目标')).toHaveLength(11)
  expect(within(table).queryByText('01:11:00')).not.toBeInTheDocument()
})

it('确认弹窗限制键盘焦点并支持 Escape 返回原按钮', async () => {
  const close = vi.fn(),
    user = userEvent.setup()
  const trigger = document.createElement('button')
  trigger.textContent = '原入口'
  document.body.append(trigger)
  trigger.focus()
  const view = render(
    <Modal title="归档并开始新演练" onClose={close}>
      <button>取消归档</button>
      <button>确认归档</button>
    </Modal>,
  )
  expect(screen.getByRole('dialog')).toHaveFocus()
  await user.tab({ shift: true })
  expect(screen.getByRole('button', { name: '确认归档' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: '关闭归档并开始新演练' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(close).toHaveBeenCalledOnce()
  view.unmount()
  expect(trigger).toHaveFocus()
  trigger.remove()
})

it('历史演练可读取批准记录并导出归档', async () => {
  const state = seed()
  state.drill_id = 'DRILL-ARCHIVED'
  state.plans = [{ ...plan(), approval_id: 'APPROVAL-KEPT' }]
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === '/api/history'
              ? {
                  drills: [
                    {
                      drill_id: state.drill_id,
                      title: state.title,
                      archived_at: '2026-10-22T05:00:00+08:00',
                      simulation_time: state.simulation_time,
                      metrics: state.metrics,
                      plan_count: 1,
                      event_count: 1,
                    },
                  ],
                }
              : state,
          ),
          { status: 200 },
        ),
    ),
  )
  const user = userEvent.setup()
  render(<ArchivePanel />)
  await user.click(await screen.findByRole('button', { name: /云溪县/ }))
  expect(await screen.findByText('批准记录：APPROVAL-KEPT')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '导出归档 JSON' })).toHaveAttribute(
    'href',
    '/api/history/DRILL-ARCHIVED/export',
  )
})
