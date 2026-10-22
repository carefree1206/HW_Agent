import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '../../web/src/App'
import { seed } from './fixtures'

const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })

it('慢请求期间合并刷新，先完成的旧请求不会覆盖后续状态', async () => {
  vi.useFakeTimers()
  let release!: (value: Response) => void
  let count = 0
  const fetch = vi.fn(() =>
    ++count === 1
      ? new Promise<Response>((resolve) => {
          release = resolve
        })
      : Promise.resolve(response(seed())),
  )
  vi.stubGlobal('fetch', fetch)
  const view = render(<App />)
  try {
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3900)
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => {
      release(response(seed()))
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('heading', { name: /每一条消息/ })).toBeInTheDocument()
  } finally {
    view.unmount()
    vi.useRealTimers()
  }
})

it('重置需在页面确认，归档完成后新报告携带新的演练编号', async () => {
  let state = seed()
  const original = state.drill_id
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/reset') {
      state = { ...seed(), drill_id: 'DRILL-AFTER-RESET' }
      return response(state)
    }
    if (url === '/api/reports') return response({ id: 'EV-NEW' })
    return response(state)
  })
  vi.stubGlobal('fetch', fetch)
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('button', { name: '重置演练' })
  await user.click(screen.getByRole('button', { name: '重置演练' }))
  expect(screen.getByRole('dialog', { name: '归档并开始新演练' })).toBeInTheDocument()
  expect(fetch.mock.calls.some(([url]) => url === '/api/reset')).toBe(false)
    await user.click(screen.getByRole('button', { name: '归档并开始新演练' }))
  await screen.findByText('当前演练已归档，新的演练已就绪。历史记录可在运行记录中查看。')
  const resetCall = fetch.mock.calls.find(([url]) => url === '/api/reset')
  expect((resetCall?.[1]?.headers as Record<string, string>)['X-Drill-ID']).toBe(original)
  await user.click(screen.getByRole('button', { name: /现场报告/ }))
  await user.type(screen.getByLabelText('现场情况'), '现场报告待核实')
  await user.click(screen.getByRole('button', { name: '提交并更新证据' }))
  await waitFor(() => {
    const report = fetch.mock.calls.find(([url]) => url === '/api/reports')
    expect((report?.[1]?.headers as Record<string, string>)['X-Drill-ID']).toBe('DRILL-AFTER-RESET')
  })
})
