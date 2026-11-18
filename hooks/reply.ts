// 从会话记录里找到某段文字所在的整条回复，并拼出要导出的内容
import type { SessionMessage } from 'claude-code'

/* ---------- 找到这段文字所在的整条回复 ---------- */

// closed：后面已经有新的提问，这条回复不会再变
export type Reply = { texts: string[]; isLastBlock: boolean; isLatest: boolean; found: boolean; closed: boolean }

const isPrompt = (m: SessionMessage | undefined) =>
  m !== undefined && m.role === 'user' && (m.toolResults ?? []).length === 0 && m.text.trim() !== ''

// 同一段文字可能出现在多条回复里（比如都只回了"完成。"），按出现顺序列出所有位置
export const textKey = (blockText: string) => blockText.trim().slice(0, 160)
export function occurrences(msgs: readonly SessionMessage[], blockText: string): number[] {
  const key = textKey(blockText)
  const out: number[] = []
  msgs.forEach((m, k) => {
    if (m.role === 'assistant' && m.text.includes(key)) out.push(k)
  })
  return out
}

// 第 nth 次出现（从 1 数起）所在的整条回复；不给 nth 时取最后一次
export function locateReply(msgs: readonly SessionMessage[], blockText: string, nth?: number): Reply {
  const all = occurrences(msgs, blockText)
  const i = all[(nth ?? all.length) - 1]
  if (i === undefined) return { texts: [blockText], isLastBlock: false, isLatest: false, found: false, closed: false }
  let s = i
  let t = i
  while (s - 1 >= 0 && !isPrompt(msgs[s - 1])) s--
  while (t + 1 < msgs.length && !isPrompt(msgs[t + 1])) t++
  const texts = msgs.slice(s, t + 1).filter(m => m.role === 'assistant' && m.text.trim() !== '').map(m => m.text.trim())
  const last = texts[texts.length - 1] ?? ''
  const isLatest = t === msgs.length - 1
  return { texts, isLastBlock: last.endsWith(blockText.trim().slice(-160)), isLatest, found: true, closed: !isLatest }
}

// 这段文字该对应第几次出现：已经认领过的沿用；没认领过的，取还没被别的段落认领的最后一次；都被认领了返回 null
export function pickOccurrence(count: number, claimed: ReadonlySet<number>, own?: number): number | null {
  if (own !== undefined && own <= count) return own
  for (let n = count; n >= 1; n--) if (!claimed.has(n)) return n
  return null
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
