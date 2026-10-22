import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ToolResult } from '../../web/src/ToolResult'
import { Knowledge } from '../../web/src/Runtime'
import { seed } from './fixtures'
import type { ToolCall } from '../../web/src/types'

const call: ToolCall = {
  id: 'CALL-1',
  request_id: 'RPC-1',
  service: 'planning',
  tool: 'plan_optimize',
  arguments: {},
  status: 'success',
  at: '2026-10-22T02:20:00+08:00',
  duration_ms: 3,
  transport: 'HTTP JSON-RPC',
  result: '{"truncated":',
  result_truncated: true,
  result_hash: 'recorded-hash',
}
it('截断摘要有明确标记，并可读取完整实际响应', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            call_id: 'CALL-1',
            drill_id: 'DRILL-1',
            result: { tail: '完整响应最后一段' },
            content_hash: 'recorded-hash',
          }),
          { status: 200 },
        ),
    ),
  )
  render(<ToolResult call={call} drillId="DRILL-1" />)
  expect(screen.getByText('摘要已截断')).toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: '读取完整响应' }))
  expect(await screen.findByText(/完整响应最后一段/)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '完整实际响应' })).toBeInTheDocument()
})
it('完整响应身份或摘要不匹配时保留错误，不展示为已验证结果', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            call_id: 'CALL-1',
            drill_id: 'DRILL-1',
            result: { tail: '错误的完整结果' },
            content_hash: 'different-hash',
          }),
          { status: 200 },
        ),
    ),
  )
  render(<ToolResult call={call} drillId="DRILL-1" />)
  await userEvent.setup().click(screen.getByRole('button', { name: '读取完整响应' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('不一致')
  expect(screen.queryByText(/错误的完整结果/)).not.toBeInTheDocument()
})
it('无匹配时不显示上一轮的知识条目', async () => {
  const document = {
    id: 'DRILL-SOP-02',
    section: '3.2',
    version: 'v1.1',
    type: '演练规则',
    title: '测试资源与电量规则',
    text: '资源和电量要求',
    source: 'docs/knowledge/drill-sop.md',
    content_hash: 'abc',
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(JSON.stringify({ documents: url.endsWith('q=') ? [document] : [] }), {
          status: 200,
        }),
    ),
  )
  render(<Knowledge state={seed()} onClose={vi.fn()} />)
  await screen.findByRole('heading', { name: '测试资源与电量规则' })
  await userEvent
    .setup()
    .type(screen.getByRole('textbox', { name: '检索演练规则' }), '火星银河飞船')
  await screen.findByRole('heading', { name: '没有匹配的演练规则' })
  expect(screen.queryByRole('heading', { name: '测试资源与电量规则' })).not.toBeInTheDocument()
})
