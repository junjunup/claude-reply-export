// 从会话记录里找到某段文字所在的整条回复，并拼出要导出的内容
import type { SessionMessage } from 'claude-code'

/* ---------- 找到这段文字所在的整条回复 ---------- */

// closed：后面已经有新的提问，这条回复不会再变
export type Reply = { texts: string[]; isLastBlock: boolean; isLatest: boolean; found: boolean; closed: boolean }

const isPrompt = (m: SessionMessage | undefined) =>
  m !== undefined && m.role === 'user' && (m.toolResults ?? []).length === 0 && m.text.trim() !== ''

export function locateReply(msgs: readonly SessionMessage[], blockText: string): Reply {
  const key = blockText.trim().slice(0, 160)
  let i = -1
  for (let k = msgs.length - 1; k >= 0; k--) {
    const m = msgs[k]
    if (m && m.role === 'assistant' && m.text.includes(key)) { i = k; break }
  }
  if (i < 0) return { texts: [blockText], isLastBlock: false, isLatest: false, found: false, closed: false }
  let s = i
  let t = i
  while (s - 1 >= 0 && !isPrompt(msgs[s - 1])) s--
  while (t + 1 < msgs.length && !isPrompt(msgs[t + 1])) t++
  const texts = msgs.slice(s, t + 1).filter(m => m.role === 'assistant' && m.text.trim() !== '').map(m => m.text.trim())
  const last = texts[texts.length - 1] ?? ''
  const isLatest = t === msgs.length - 1
  return { texts, isLastBlock: last.endsWith(blockText.trim().slice(-160)), isLatest, found: true, closed: !isLatest }
}

// 整条回复 = 最后一段正文 + 前面"有结构的实质内容"。
// 工具调用之间的进度播报（"正在做 X，下一步做 Y"）通常是一两段无结构的文字，一律跳过。
const STRUCTURED = /^(#{1,6}\s|[-*+]\s|\d+\.\s|\||```|>\s)/m
// 主要靠“有没有结构”判断；长度门槛放低，中文字少意多
const isSubstantial = (t: string) => t.length >= 80 && STRUCTURED.test(t)
export function replyMarkdown(texts: string[]): string {
  if (texts.length <= 1) return texts[0] ?? ''
  return texts.filter((t, i) => i === texts.length - 1 || isSubstantial(t)).join('\n\n')
}
