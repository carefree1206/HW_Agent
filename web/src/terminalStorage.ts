import type { Message } from './types'

export interface PendingReceipt {
  drill_id: string
  notice_id: string
  message_id: string
  region_id: string
  stage: 'human_confirmed'
  client_id: string
  requested_at: string
}
const memory = new Map<string, string>()
const volatileKeys = new Set<string>()
const prefix = 'undelivered:v2:'
function read(key: string): unknown {
  try {
    return JSON.parse(
      volatileKeys.has(key) ? memory.get(key) || 'null' : localStorage.getItem(key) || 'null',
    )
  } catch {
    try {
      return JSON.parse(memory.get(key) || 'null')
    } catch {
      return null
    }
  }
}
function write(key: string, value: unknown) {
  const text = JSON.stringify(value)
  memory.set(key, text)
  try {
    localStorage.setItem(key, text)
    volatileKeys.delete(key)
    return true
  } catch {
    volatileKeys.add(key)
    return false
  }
}
export function terminalClient() {
  const key = `${prefix}client`
  const old = read(key)
  if (typeof old === 'string' && old.startsWith('WEB-')) return old
  const id = `WEB-${crypto.randomUUID().slice(0, 12)}`
  write(key, id)
  return id
}
export function loadOutbox(drillId: string): PendingReceipt[] {
  const data = read(`${prefix}outbox:${drillId}`)
  return Array.isArray(data)
    ? data.filter(
        (x): x is PendingReceipt =>
          x &&
          x.drill_id === drillId &&
          typeof x.notice_id === 'string' &&
          typeof x.message_id === 'string' &&
          typeof x.region_id === 'string' &&
          typeof x.client_id === 'string' &&
          x.stage === 'human_confirmed',
      )
    : []
}
export function enqueue(receipt: PendingReceipt) {
  const rows = loadOutbox(receipt.drill_id).filter((r) => r.message_id !== receipt.message_id)
  return write(`${prefix}outbox:${receipt.drill_id}`, [...rows, receipt])
}
export function removePending(drillId: string, messageId: string) {
  return write(
    `${prefix}outbox:${drillId}`,
    loadOutbox(drillId).filter((r) => r.message_id !== messageId),
  )
}
export function loadInbox(drillId: string, regionId: string, noticeId: string | null): Message[] {
  const data = read(`${prefix}inbox:${drillId}:${regionId}`)
  return Array.isArray(data)
    ? data.filter(
        (m): m is Message =>
          m &&
          m.region_id === regionId &&
          m.notice_id === noticeId &&
          typeof m.id === 'string' &&
          typeof m.text === 'string' &&
          typeof m.terminal_received_at === 'string',
      )
    : []
}
export function saveInbox(drillId: string, regionId: string, messages: Message[]) {
  return write(`${prefix}inbox:${drillId}:${regionId}`, messages)
}
export const isTerminalStorage = (key: string | null) => key === null || key.startsWith(prefix)
