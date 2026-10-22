import { expect, it, vi } from 'vitest'
import { api, ApiError, bindDrill } from '../../web/src/api'
import { enqueue, loadOutbox } from '../../web/src/terminalStorage'

it('写请求带有发送时的演练编号，错误保留可解释上下文', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: 'INFEASIBLE',
          detail: '电量不足',
          context: { shortfall_minutes: 49 },
        }),
        { status: 409 },
      ),
  )
  vi.stubGlobal('fetch', fetch)
  bindDrill('DRILL-AT-SEND')
  const request = api('/api/test', {})
  bindDrill('DRILL-AFTER')
  await expect(request).rejects.toMatchObject({
    code: 'INFEASIBLE',
    context: { shortfall_minutes: 49 },
  })
  const options = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect((options[1].headers as Record<string, string>)['X-Drill-ID']).toBe('DRILL-AT-SEND')
})

it('无法解析的响应不会被误报为成功', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<html>unavailable</html>', { status: 503 })),
  )
  await expect(api('/api/state')).rejects.toBeInstanceOf(ApiError)
  await expect(api('/api/state')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('持久化失败时仍保留会话内的待发确认，并返回真实持久化状态', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError')
  })
  const receipt = {
    drill_id: 'DRILL-QUOTA',
    notice_id: 'N',
    message_id: 'M',
    region_id: 'R12',
    stage: 'human_confirmed' as const,
    client_id: 'WEB-TEST',
    requested_at: '2026-10-22T02:31:00+08:00',
  }
  expect(enqueue(receipt)).toBe(false)
  expect(loadOutbox('DRILL-QUOTA')).toEqual([receipt])
  setItem.mockRestore()
})
