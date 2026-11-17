import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionMessage } from 'claude-code'

import type { ReplyExportPrefs } from '../types'
import { CARD, THEMES, WIDTHS, titleOf, toPage, toPlain, toRichHtml, toWordHtml } from './convert.ts'
import type { ThemeName, WidthName } from './convert.ts'
import { redact, scan } from './privacy.ts'

const menu = atom({ plugin: 'reply-export', key: 'menu' } as const, '')
const busy = atom({ plugin: 'reply-export', key: 'busy' } as const, '')
const pending = atom({ plugin: 'reply-export', key: 'pending' } as const, '')
const turnSeq = atom({ plugin: 'reply-export', key: 'turnSeq' } as const, 0)
const DEFAULT_PREFS: ReplyExportPrefs = { theme: 'paper', width: 'phone' }
const prefs = atom({ plugin: 'reply-export', key: 'prefs' } as const, DEFAULT_PREFS)

const OUT_DIR_NAME = 'Claude导出'

/* ---------- 找到这段文字所在的整条回复 ---------- */

type Reply = { texts: string[]; isLastBlock: boolean; isLatest: boolean; found: boolean }

const isPrompt = (m: SessionMessage | undefined) =>
  m !== undefined && m.role === 'user' && (m.toolResults ?? []).length === 0 && m.text.trim() !== ''

function locateReply(msgs: readonly SessionMessage[], blockText: string): Reply {
  const key = blockText.trim().slice(0, 160)
  let i = -1
  for (let k = msgs.length - 1; k >= 0; k--) {
    const m = msgs[k]
    if (m && m.role === 'assistant' && m.text.includes(key)) { i = k; break }
  }
  if (i < 0) return { texts: [blockText], isLastBlock: true, isLatest: true, found: false }
  let s = i
  let t = i
  while (s - 1 >= 0 && !isPrompt(msgs[s - 1])) s--
  while (t + 1 < msgs.length && !isPrompt(msgs[t + 1])) t++
  const texts = msgs.slice(s, t + 1).filter(m => m.role === 'assistant' && m.text.trim() !== '').map(m => m.text.trim())
  const last = texts[texts.length - 1] ?? ''
  return { texts, isLastBlock: last.endsWith(blockText.trim().slice(-160)), isLatest: t === msgs.length - 1, found: true }
}

// 整条回复 = 最后一段正文 + 前面"有结构的实质内容"。
// 工具调用之间的进度播报（"正在做 X，下一步做 Y"）通常是一两段无结构的文字，一律跳过。
const STRUCTURED = /^(#{1,6}\s|[-*+]\s|\d+\.\s|\||```|>\s)/m
const isSubstantial = (t: string) => t.length >= 200 && STRUCTURED.test(t)
function replyMarkdown(texts: string[]): string {
  if (texts.length <= 1) return texts[0] ?? ''
  return texts.filter((t, i) => i === texts.length - 1 || isSubstantial(t)).join('\n\n')
}

// 会话消息缓存：每轮结束刷新一次；找不到当前段落时（正在输出的新回复）最多每 1.5 秒补读一次
let cache: { seq: number; at: number; msgs: readonly SessionMessage[] } | null = null
async function messages($: EngineInterface, seq: number, force = false): Promise<readonly SessionMessage[]> {
  const now = Date.now()
  if (cache && cache.seq === seq && !force) return cache.msgs
  if (cache && force && now - cache.at < 1500 && cache.seq === seq) return cache.msgs
  cache = { seq, at: now, msgs: await $.session.messages() }
  return cache.msgs
}

/* ---------- 本机能力：剪贴板、原生助手、文件 ---------- */

async function sh($: EngineInterface, script: string, args: string[] = [], stdin?: string, timeoutMs = 30000) {
  return $.process.run(['/bin/sh', '-c', script, 'sh', ...args], { stdin, timeoutMs, env: { LANG: 'en_US.UTF-8' } })
}

async function homeDir($: EngineInterface): Promise<string> {
  return (await sh($, 'printf %s "$HOME"')).stdout
}

async function ensureHelper($: EngineInterface): Promise<string> {
  const src = `${$.plugin.root}/native/helper.swift`
  const bin = `${await homeDir($)}/Library/Caches/reply-export/helper`
  if ((await sh($, '[ -x "$2" ] && [ ! "$1" -nt "$2" ]', [src, bin])).exitCode === 0) return bin
  if ((await sh($, 'command -v xcrun >/dev/null && xcrun --find swiftc >/dev/null 2>&1')).exitCode !== 0) {
    throw new Error('需要 Xcode 命令行工具：在终端运行 xcode-select --install 后再试')
  }
  $.ui.toast('正在准备渲染组件（只在首次或更新后需要，约 10–30 秒）…')
  const r = await sh($, 'mkdir -p "$(dirname "$2")" && xcrun swiftc -O "$1" -o "$2"', [src, bin], undefined, 180000)
  if (r.exitCode !== 0) throw new Error('渲染组件编译失败：' + r.stderr.slice(0, 200))
  return bin
}

type HelperResult = { ok: boolean; error?: string; pages?: number; rtf?: boolean; cards?: string[] }

async function runHelper($: EngineInterface, job: Record<string, unknown>): Promise<HelperResult> {
  const bin = await ensureHelper($)
  const r = await $.process.run([bin], { stdin: JSON.stringify(job), timeoutMs: 120000 })
  let parsed: HelperResult
  try {
    parsed = JSON.parse(r.stdout) as HelperResult
  } catch {
    throw new Error('渲染组件没有返回结果：' + (r.stderr || r.stdout).slice(0, 200))
  }
  if (!parsed.ok) throw new Error(parsed.error ?? '渲染失败')
  return parsed
}

const pad = (n: number) => String(n).padStart(2, '0')
function stamp(md: string): { file: string; human: string } {
  const d = new Date()
  const safe = titleOf(md).replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 24) || 'Claude回复'
  return {
    file: `${safe}-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    human: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

async function outDir($: EngineInterface): Promise<string> {
  const dir = `${await homeDir($)}/Downloads/${OUT_DIR_NAME}`
  await sh($, 'mkdir -p "$1"', [dir])
  return dir
}

const reveal = ($: EngineInterface, path: string) => sh($, 'open -R "$1"', [path])

/* ---------- 导出动作 ---------- */

type Kind = 'plain' | 'rich' | 'image' | 'cards' | 'pdf' | 'word' | 'html' | 'md'

const ACTIONS: Record<Kind, { label: string; hint?: string }> = {
  plain: { label: '纯文本', hint: '微信' },
  rich: { label: '富文本', hint: '飞书 · 邮件' },
  image: { label: '长图' },
  md: { label: 'Markdown' },
  cards: { label: '分页卡片', hint: '小红书' },
  pdf: { label: 'PDF' },
  word: { label: 'Word' },
  html: { label: 'HTML' },
}
// 方案 B：按用途分组
const GROUPS: { title: string; kinds: Kind[] }[] = [
  { title: '复制到剪贴板', kinds: ['plain', 'rich', 'image', 'md'] },
  { title: '保存为文件', kinds: ['cards', 'pdf', 'word', 'html'] },
]

async function doExport($: EngineInterface, kind: Kind, md: string, p: ReplyExportPrefs): Promise<string> {
  if (kind === 'plain') {
    const text = toPlain(md)
    await sh($, 'pbcopy', [], text)
    return `已复制纯文本（${text.length} 字），可直接粘贴到微信`
  }
  if (kind === 'md') {
    await sh($, 'pbcopy', [], md)
    return '已复制 Markdown 原文'
  }
  if (kind === 'rich') {
    const r = await runHelper($, { op: 'clip-rich', html: toRichHtml(md), plain: toPlain(md) })
    return r.rtf ? '已复制富文本，可粘贴到飞书、邮件、Word' : '已复制（HTML + 纯文本）'
  }

  const { file, human } = stamp(md)
  const dir = await outDir($)
  const where = `下载/${OUT_DIR_NAME}`

  if (kind === 'word') {
    const path = `${dir}/${file}.docx`
    const r = await sh($, 'textutil -stdin -format html -convert docx -output "$1"', [path], toWordHtml(md))
    if (r.exitCode !== 0) throw new Error('Word 转换失败：' + r.stderr.slice(0, 120))
    await runHelper($, { op: 'clip-file', path })
    await reveal($, path)
    return `Word 已保存到 ${where}，文件也已复制，可在微信里直接粘贴发送`
  }

  const theme = THEMES[p.theme]
  if (kind === 'html') {
    const page = toPage(md, { theme: p.theme, width: 'desktop', mode: 'html', date: human })
    const path = `${dir}/${file}.html`
    await sh($, 'cat > "$1"', [path], page.html)
    await reveal($, path)
    return `HTML 已保存到 ${where}`
  }
  if (kind === 'image') {
    const page = toPage(md, { theme: p.theme, width: p.width, mode: 'long', date: human })
    await runHelper($, { op: 'render', mode: 'long', html: page.html, width: page.width, bg: page.bg, png: `${dir}/${file}.png`, copyImage: true })
    return `长图已复制到剪贴板（${theme.label} · ${WIDTHS[p.width].label}），也保存到了 ${where}`
  }
  if (kind === 'cards') {
    const page = toPage(md, { theme: p.theme, width: p.width, mode: 'cards', date: human })
    const r = await runHelper($, {
      op: 'render', mode: 'cards', html: page.html, width: page.width, bg: page.bg, muted: theme.p.muted,
      cardHeight: CARD.height, padTop: CARD.padTop, padBottom: CARD.padBottom, prefix: `${dir}/${file}`,
    })
    const first = r.cards?.[0]
    if (first) await reveal($, first)
    return `已生成 ${r.cards?.length ?? 0} 张 3:4 卡片，保存在 ${where}`
  }
  // pdf：A4 用电脑宽度排版更合适
  const page = toPage(md, { theme: p.theme, width: 'desktop', mode: 'pdf', date: human })
  const path = `${dir}/${file}.pdf`
  const r = await runHelper($, { op: 'render', mode: 'pdf', html: page.html, width: page.width, bg: page.bg, pdf: path })
  await runHelper($, { op: 'clip-file', path })
  await reveal($, path)
  return `PDF 已保存（${r.pages ?? 1} 页 A4），文件也已复制，可在微信里直接粘贴发送`
}

/* ---------- 注册 ---------- */

const THEME_ORDER: ThemeName[] = ['paper', 'clean', 'dark']
const WIDTH_ORDER: WidthName[] = ['phone', 'desktop']
const nextOf = <T,>(list: T[], cur: T): T => list[(list.indexOf(cur) + 1) % list.length] ?? cur

function validPrefs(v: unknown): ReplyExportPrefs {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<ReplyExportPrefs>
  return {
    theme: THEME_ORDER.includes(o.theme as ThemeName) ? (o.theme as ThemeName) : DEFAULT_PREFS.theme,
    width: WIDTH_ORDER.includes(o.width as WidthName) ? (o.width as WidthName) : DEFAULT_PREFS.width,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, prefs, () => validPrefs(undefined))
    try {
      const saved = await $.store.get('prefs')
      if (saved !== undefined) await update($, prefs, () => validPrefs(saved))
    } catch {
      // 读不到就用默认值
    }
    return next(e)
  })

  // 每轮结束时让回复重新判断"我是不是最后一段"
  on('turn.complete', async ($, e, next) => {
    await update($, turnSeq, n => n + 1)
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const original = await next(e)
    if (e.props.isSummary) return original

    const seq = await read($, turnSeq) // 订阅：每轮结束后重画
    const blockText = e.props.text
    let located = locateReply(await messages($, seq), blockText)
    if (!located.found) located = locateReply(await messages($, seq, true), blockText)
    if (!located.isLastBlock) return original

    const id = e.requestId
    const at = { requestId: id }
    const [menuState, working, waiting, p] = await Promise.all([
      read($, memberOf(menu, e)), read($, memberOf(busy, e)), read($, memberOf(pending, e)), read($, prefs),
    ])
    const { Box, Button, Text } = $.ui.resolve(e)

    const currentMd = async () => replyMarkdown(locateReply(await messages($, await read($, turnSeq), true), blockText).texts)

    const perform = async (kind: Kind, md: string) => {
      await update($, memberOf(busy, at), () => ACTIONS[kind].label)
      try {
        $.ui.toast(await doExport($, kind, md, await read($, prefs)))
        await update($, memberOf(menu, at), () => '')
      } catch (err) {
        $.ui.toast(`导出失败：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        await update($, memberOf(busy, at), () => '')
      }
    }

    // 先做隐私检查：发现路径、邮箱、密钥等时让用户选择打码还是原样导出
    const start = (kind: Kind) => async () => {
      if ((await read($, memberOf(busy, at))) !== '') return
      const md = await currentMd()
      const found = scan(md)
      if (found.total > 0) {
        await update($, memberOf(pending, at), () => `${kind}|${found.summary}`)
        return
      }
      await perform(kind, md)
    }

    const confirm = (mask: boolean) => async () => {
      const [kind] = (await read($, memberOf(pending, at))).split('|') as [Kind]
      await update($, memberOf(pending, at), () => '')
      const md = await currentMd()
      await perform(kind, mask ? redact(md) : md)
    }

    const setMenu = (v: string) => () => void update($, memberOf(menu, at), () => v)
    const savePrefs = (fn: (q: ReplyExportPrefs) => ReplyExportPrefs) => async () => {
      const nextPrefs = fn(await read($, prefs))
      await update($, prefs, () => nextPrefs)
      await $.store.set('prefs', nextPrefs)
    }

    const action = (k: Kind, primary = false) => {
      const a = ACTIONS[k]
      return (
        <Button key={k} variant={primary ? 'primary' : undefined} onPress={() => void start(k)()}>
          {a.label}
          {a.hint ? <Text dimColor size="caption"> · {a.hint}</Text> : ''}
        </Button>
      )
    }

    // 展开后的内容统一放进一张带边框的卡片
    const card = (...children: RenderChildren[]) => (
      <Box flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={2} paddingY={1}>
        {children}
      </Box>
    )
    const group = (title: string, children: RenderChildren) => (
      <Box key={`g-${title}`} flexDirection="column">
        <Text dimColor size="caption">{title}</Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>{children}</Box>
      </Box>
    )

    let row
    if (working !== '') {
      row = card(<Text dimColor>⏳ 正在导出：{working}…</Text>)
    } else if (waiting !== '') {
      const summary = waiting.split('|')[1] ?? ''
      row = card(
        <Text>🔒 导出内容里有 {summary}，要先打码吗？</Text>,
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="mask" variant="primary" label="打码后导出" onPress={() => void confirm(true)()} />
          <Button key="raw" label="原样导出" onPress={() => void confirm(false)()} />
          <Button key="cancel" label="取消" onPress={() => void update($, memberOf(pending, at), () => '')} />
        </Box>,
      )
    } else if (menuState === '') {
      row = <Button key="export" label="⤓ 导出" onPress={setMenu('open')} />
    } else {
      row = card(
        ...GROUPS.map(g => group(g.title, g.kinds.map(k => action(k, k === 'plain')))),
        group('样式', [
          <Button key="theme" onPress={() => void savePrefs(q => ({ ...q, theme: nextOf(THEME_ORDER, q.theme) }))()}>
            <Text dimColor>主题：</Text>{THEMES[p.theme].label}
          </Button>,
          <Button key="width" onPress={() => void savePrefs(q => ({ ...q, width: nextOf(WIDTH_ORDER, q.width) }))()}>
            <Text dimColor>宽度：</Text>{WIDTHS[p.width].label}
          </Button>,
          <Button key="close" label="收起" onPress={setMenu('')} />,
        ]),
      )
    }

    // 最新一条回复常驻显示；更早的回复平时隐藏，鼠标悬停时浮出（操作进行中则保持显示）
    const alwaysShow = located.isLatest || menuState !== '' || working !== '' || waiting !== ''
    const scope = `rx-${id.slice(-48)}`
    return (
      <Box flexDirection="column" hover={{ scope }}>
        {original}
        {alwaysShow ? (
          <Box marginTop={1}>{row}</Box>
        ) : (
          <Box marginTop={1} display="none" hover={{ scope, display: 'flex' }}>{row}</Box>
        )}
      </Box>
    )
  })
}
