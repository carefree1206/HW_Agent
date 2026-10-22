import { act as reactAct, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Terminal } from '../../web/src/TerminalDevice'
import { enqueue, loadInbox, loadOutbox, saveInbox } from '../../web/src/terminalStorage'
import { delivery } from './fixtures'
import type { Message } from '../../web/src/types'
import type { Act } from '../../web/src/common'

const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const act: Act = async (work) => {
  await work()
  return true
}
function props(state = delivery()) {
  return { state, act, refresh: vi.fn(async () => {}), notify: vi.fn() }
}

describe('现场终端的持久化与竞态', () => {
  it('切换页面后仍可离线确认，重开后恢复同步且只补发一次', async () => {
    const state = delivery()
    let online = true
    let stored = state.delivery.messages[0]
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/messages'))
        return response({ drill_id: state.drill_id, notice_id: 'NOTICE-1', messages: [stored] })
      const body = JSON.parse(String(init?.body))
      if (!online) return response({ error: 'TERMINAL_OFFLINE', detail: '演练终端离线' }, 503)
      stored = {
        ...stored,
        terminal_received_at: stored.terminal_received_at || '2026-10-22T02:31:00+08:00',
        ...(body.stage === 'human_confirmed'
          ? { human_confirmed_at: '2026-10-22T02:35:00+08:00', status: 'human_confirmed' }
          : {}),
      }
      return response(stored)
    })
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    const first = render(<Terminal {...props(state)} />)
    await user.click(screen.getByRole('button', { name: '接收消息 / 同步回执' }))
    await screen.findByRole('button', { name: '我已收到这条演练消息' })
    expect(loadInbox(state.drill_id, 'R12', 'NOTICE-1')).toHaveLength(1)
    first.unmount()
    online = false
    const offline = structuredClone(state)
    offline.terminal_links.R12 = false
    const second = render(<Terminal {...props(offline)} />)
    await screen.findByText(stored.text)
    await user.click(screen.getByRole('button', { name: '我已收到这条演练消息' }))
    await waitFor(() => expect(loadOutbox(state.drill_id)).toHaveLength(1))
    expect(screen.getByRole('button', { name: '确认已暂存，等待联网补发' })).toBeDisabled()
    second.unmount()
    online = true
    render(<Terminal {...props(state)} />)
    expect(screen.getByRole('button', { name: '确认已暂存，等待联网补发' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '接收消息 / 同步回执' }))
    await screen.findByRole('button', { name: '你已确认收到' })
    expect(loadOutbox(state.drill_id)).toHaveLength(0)
    expect(loadInbox(state.drill_id, 'R12', 'NOTICE-1')[0].human_confirmed_at).toBeTruthy()
    expect(
      fetch.mock.calls.filter(([, init]) => String(init?.body).includes('human_confirmed')),
    ).toHaveLength(2) // once rejected offline, once delivered
  })

  it('区域切换后丢弃迟到响应，不替其他区域接收消息', async () => {
    const state = delivery(['R12', 'R11'])
    let release!: (value: Response) => void
    const fetch = vi.fn((url: string) =>
      url.includes('/messages')
        ? new Promise<Response>((resolve) => {
            release = resolve
          })
        : Promise.resolve(response({})),
    )
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<Terminal {...props(state)} />)
    await user.click(screen.getByRole('button', { name: '接收消息 / 同步回执' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '终端所属区域' }), 'R11')
    await reactAct(async () =>
      release(
        response({
          drill_id: state.drill_id,
          notice_id: 'NOTICE-1',
          messages: [state.delivery.messages[0]],
        }),
      ),
    )
    expect(screen.queryByText(state.delivery.messages[0].text)).not.toBeInTheDocument()
    expect(fetch.mock.calls).toHaveLength(1)
    expect(loadInbox(state.drill_id, 'R11', 'NOTICE-1')).toHaveLength(0)
  })

  it('新演练不会读取或重放旧演练回执，即使通知和消息编号相同', async () => {
    const old = delivery()
    const received: Message = {
      ...old.delivery.messages[0],
      terminal_received_at: '2026-10-22T02:31:00+08:00',
    }
    saveInbox(old.drill_id, 'R12', [received])
    enqueue({
      drill_id: old.drill_id,
      notice_id: 'NOTICE-1',
      message_id: received.id,
      region_id: 'R12',
      stage: 'human_confirmed',
      client_id: 'WEB-OLD',
      requested_at: '2026-10-22T02:32:00+08:00',
    })
    const next = delivery()
    next.drill_id = 'DRILL-NEW'
    const fetch = vi.fn(async (url: string, init?: RequestInit) =>
      url.includes('/messages')
        ? response({
            drill_id: next.drill_id,
            notice_id: 'NOTICE-1',
            messages: next.delivery.messages,
          })
        : response({
            ...next.delivery.messages[0],
            terminal_received_at: '2026-10-22T03:31:00+08:00',
          }),
    )
    vi.stubGlobal('fetch', fetch)
    const user = userEvent.setup()
    render(<Terminal {...props(next)} />)
    expect(
      screen.queryByRole('button', { name: '确认已暂存，等待联网补发' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(received.text)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '接收消息 / 同步回执' }))
    await screen.findByRole('button', { name: '我已收到这条演练消息' })
    expect(
      fetch.mock.calls.some(([, init]) => String(init?.body).includes('human_confirmed')),
    ).toBe(false)
    expect(
      fetch.mock.calls.every(
        ([, init]) => (init?.headers as Record<string, string>)['X-Drill-ID'] === 'DRILL-NEW',
      ),
    ).toBe(true)
    expect(loadOutbox(old.drill_id)).toHaveLength(1)
  })

  it('本地缓存结构损坏时仍能打开终端并重新同步', () => {
    const state = delivery()
    localStorage.setItem(`undelivered:v2:outbox:${state.drill_id}`, '{"unexpected":true}')
    localStorage.setItem(`undelivered:v2:inbox:${state.drill_id}:R12`, '[null,{},"invalid"]')
    render(<Terminal {...props(state)} />)
    expect(screen.getByRole('button', { name: '接收消息 / 同步回执' })).toBeEnabled()
    expect(loadOutbox(state.drill_id)).toEqual([])
  })
})
