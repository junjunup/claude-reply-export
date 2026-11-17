import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { locateReply, replyMarkdown } from '../hooks/reply.ts'

const u = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const tool = (): SessionMessage => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't', text: 'ok', isError: false, result: undefined }] } as unknown as SessionMessage)
const a = (text: string): SessionMessage => ({ role: 'assistant', text, toolUses: [] })

const FINAL = '## 结论\n\n- 第一点\n- 第二点'
const STATUS = 'Still researching. Next I am checking the long image rendering and the PDF pagination on this machine.'
const SUBSTANTIAL = '## 中间产出\n\n' + '- 这是一段有结构的实质内容，应该保留在整条回复里。\n'.repeat(6)

test('整条回复：拼接实质内容，跳过进度播报', async () => {
  const msgs = [u('问题'), a(STATUS), tool(), a(SUBSTANTIAL), tool(), a(FINAL)]
  const r = locateReply(msgs, FINAL)
  expect(r.found).toBe(true)
  expect(r.isLastBlock).toBe(true)
  expect(r.isLatest).toBe(true)
  const md = replyMarkdown(r.texts)
  expect(md).not.toContain('Still researching')
  expect(md).toContain('中间产出')
  expect(md.endsWith(FINAL)).toBe(true)
})

test('中间段落不是最后一段', async () => {
  const msgs = [u('问题'), a(STATUS), tool(), a(FINAL)]
  expect(locateReply(msgs, STATUS).isLastBlock).toBe(false)
})

test('后面有新提问的回复已结束、不再是最新', async () => {
  const msgs = [u('第一问'), a(FINAL), u('第二问'), a('第二个回答')]
  const r = locateReply(msgs, FINAL)
  expect(r.closed).toBe(true)
  expect(r.isLatest).toBe(false)
  expect(r.isLastBlock).toBe(true)
})

test('会话记录里找不到时不显示', async () => {
  const r = locateReply([u('问题')], '还没写进记录的新段落')
  expect(r.found).toBe(false)
  expect(r.isLastBlock).toBe(false)
})
