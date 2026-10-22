export class ApiError extends Error {
  code: string
  context: Record<string, unknown>
  constructor(message: string, code = 'NETWORK_ERROR', context: Record<string, unknown> = {}) {
    super(message)
    this.code = code
    this.context = context
  }
}
let activeDrill: string | undefined
export const bindDrill = (drillId: string) => {
  activeDrill = drillId
}
type Options = { drillId?: string; signal?: AbortSignal; timeoutMs?: number }
export async function api<T>(path: string, body?: unknown, options: Options = {}): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) cancel()
  const timer = setTimeout(cancel, options.timeoutMs ?? 20000)
  const headers: Record<string, string> = {}
  const drill = options.drillId ?? (body === undefined ? undefined : activeDrill)
  if (drill) headers['X-Drill-ID'] = drill
  const form = body instanceof FormData
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      cache: 'no-store',
      signal: controller.signal,
      ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
    })
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new ApiError('服务返回了无法解析的响应，请稍后重试。', 'INVALID_RESPONSE')
    }
    if (!response.ok)
      throw new ApiError(
        typeof payload.detail === 'string' ? payload.detail : '请求未完成，请检查输入或重试。',
        payload.error || String(response.status),
        payload.context,
      )
    return payload as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (options.signal?.aborted) throw new ApiError('操作已取消。', 'CANCELLED')
    if (controller.signal.aborted)
      throw new ApiError('请求超时，当前结果可在重新同步后检查。', 'NETWORK_ERROR')
    throw new ApiError('暂时无法连接本地服务，请检查服务是否正在运行。')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
  }
}
