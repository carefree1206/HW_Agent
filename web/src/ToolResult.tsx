import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, LoaderCircle } from 'lucide-react'
import type { ToolCall } from './types'
import { api, ApiError } from './api'
import { Badge } from './common'

export function ToolResult({ call, drillId }: { call: ToolCall; drillId: string }) {
  const [full, setFull] = useState<{ result: unknown; content_hash: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const load = async () => {
    controller.current = new AbortController()
    setLoading(true)
    setError('')
    try {
      const data = await api<{
        call_id: string
        drill_id: string
        result: unknown
        content_hash: string
      }>(
        `/api/tool-calls/${encodeURIComponent(call.id)}?drill_id=${encodeURIComponent(drillId)}`,
        undefined,
        { drillId, signal: controller.current.signal },
      )
      if (
        data.call_id !== call.id ||
        data.drill_id !== drillId ||
        data.content_hash !== call.result_hash
      )
        throw new ApiError(
          '完整响应与已记录的调用摘要不一致，请保留记录并检查数据。',
          'INTEGRITY_MISMATCH',
        )
      setFull(data)
    } catch (reason) {
      if (!(reason instanceof ApiError) || reason.code !== 'CANCELLED')
        setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }
  const preview = () => {
    try {
      return JSON.stringify(JSON.parse(call.result), null, 2)
    } catch {
      return call.result
    }
  }
  return (
    <div>
      <div className="tool-result-heading">
        <h4>{full ? '完整实际响应' : '实际响应摘要'}</h4>
        {!full && call.result_truncated && <Badge tone="unknown">摘要已截断</Badge>}
        {!full && call.result_summary && <Badge>仅显示观测数量</Badge>}
      </div>
      <pre>{full ? JSON.stringify(full.result, null, 2) : preview()}</pre>
      {call.result_hash && (
        <div className="tool-result-proof">
          <span>JSON SHA-256：{full?.content_hash || call.result_hash}</span>
          {!full && (
            <button className="text-button" onClick={() => void load()} disabled={loading}>
              {loading ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <ArrowDownToLine size={13} />
              )}
              读取完整响应
            </button>
          )}
        </div>
      )}
      {call.request_id && <p className="tool-request-id">HTTP 请求编号：{call.request_id}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
