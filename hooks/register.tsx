import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionMessage } from 'claude-code'

import type { ReplyExportPrefs } from '../types'
import { CARD, THEMES, safeName, titleOf, toPage, toPlain, toRichHtml, toWordHtml } from './convert.ts'
import type { ThemeName, WidthName } from './convert.ts'
import { STR, langFromSystem } from './i18n.ts'
import type { Kind, Lang, LangPref } from './i18n.ts'
import { redact, scan } from './privacy.ts'
import { locateReply, occurrences, pickOccurrence, replyMarkdown, textKey } from './reply.ts'
import type { Reply } from './reply.ts'

const menu = atom({ plugin: 'reply-export', key: 'menu' } as const, '')
const busy = atom({ plugin: 'reply-export', key: 'busy' } as const, '')
const pending = atom({ plugin: 'reply-export', key: 'pending' } as const, '')
const turnSeq = atom({ plugin: 'reply-export', key: 'turnSeq' } as const, 0)
const DEFAULT_PREFS: ReplyExportPrefs = { theme: 'paper', width: 'phone', lang: 'auto' }
const prefs = atom({ plugin: 'reply-export', key: 'prefs' } as const, DEFAULT_PREFS)
const sysLang = atom({ plugin: 'reply-export', key: 'sysLang' } as const, 'zh')

// 已结束的回复：记住每段是不是最后一段，之后不再搜索、也不再随每轮重画（长会话不变卡）
const settled = new Map<string, boolean>()
const blockKey = (id: string, text: string) => `${id}|${text.length}|${text.slice(0, 64)}`

// 会话消息缓存：每轮结束刷新一次；找不到当前段落时（正在输出的新回复）最多每 1.5 秒补读一次
let cache: { seq: number; at: number; msgs: readonly SessionMessage[] } | null = null
async function messages($: EngineInterface, seq: number, force = false): Promise<readonly SessionMessage[]> {
  const now = Date.now()
  if (cache && cache.seq === seq && !force) return cache.msgs
  if (cache && force && now - cache.at < 1500 && cache.seq === seq) return cache.msgs
  cache = { seq, at: now, msgs: await $.session.messages() }
  return cache.msgs
}

/* ---------- 内容相同的多条回复：每段认领自己是第几次出现 ---------- */

// 插件拿不到消息在会话记录里的位置，只能按文字找；几条回复文字相同时（比如都是"完成。"），
// 每段第一次对上时记下自己是第几次出现。第 1 次只记在内存里，第 2 次及以后的按会话存进 $.store，
// 恢复会话后，没记录的段落自然落到剩下的那一次。
type Pin = { k: string; n: number }
const pins = new Map<string, Pin>()
let pinsFor: string | null = null
let sessionId = ''
// 主对话的一轮进行中：这时新出现的段落可能还没写进会话记录，不能拿它去对更早的回复
let inTurn = false

const hash = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}
const pinKey = (id: string, text: string) => `${id}|${hash(textKey(text))}`

async function loadPins($: EngineInterface): Promise<void> {
  let sid = ''
  try {
    sid = await $.session.id()
  } catch {
    // 拿不到会话编号就只用内存
  }
  if (pinsFor === sid) return
  pinsFor = sid
  sessionId = sid
  pins.clear()
  if (sid === '') return
  try {
    const saved = await $.store.get(`pins:${sid}`)
    if (typeof saved === 'object' && saved !== null) {
      for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
        const p = v as Partial<Pin>
        if (typeof p.k === 'string' && typeof p.n === 'number' && p.n >= 1) pins.set(k, { k: p.k, n: p.n })
      }
    }
  } catch {
    // 读不到就当没有
  }
}

async function savePins($: EngineInterface): Promise<void> {
  if (sessionId === '') return
  const out: Record<string, Pin> = {}
  for (const [k, p] of pins) if (p.n > 1) out[k] = p
  try {
    await $.store.set(`pins:${sessionId}`, out)
  } catch {
    // 存不了只影响恢复会话后的区分
  }
}

const notFound = (blockText: string): Reply => ({ texts: [blockText], isLastBlock: false, isLatest: false, found: false, closed: false })

async function resolveReply($: EngineInterface, msgs: readonly SessionMessage[], id: string, blockText: string): Promise<Reply> {
  await loadPins($)
  const key = pinKey(id, blockText)
  const k = hash(textKey(blockText))
  const own = pins.get(key)
  const claimed = new Set<number>()
  for (const [other, p] of pins) if (other !== key && p.k === k) claimed.add(p.n)
  const count = occurrences(msgs, blockText).length
  const n = pickOccurrence(count, claimed, own?.n)
  if (n === null) {
    // 每一次都被别的段落认领了：一轮进行中多半是新段落还没写进记录；
    // 不在输出中（比如同一条消息换了编号重画），退回取最后一次，不认领
    return inTurn || count === 0 ? notFound(blockText) : locateReply(msgs, blockText)
  }
  const r = locateReply(msgs, blockText, n)
  if (!own) {
    // 一轮进行中对上的是已结束的回复：多半是新段落还没写进记录，先不认领
    if (inTurn && r.closed) return notFound(blockText)
    pins.set(key, { k, n })
    if (n > 1) await savePins($)
  }
  return r
}

/* ---------- 偏好与语言 ---------- */

const THEME_ORDER: ThemeName[] = ['paper', 'clean', 'dark']
const WIDTH_ORDER: WidthName[] = ['phone', 'desktop']
const LANG_ORDER: LangPref[] = ['auto', 'zh', 'en']
const nextOf = <T,>(list: T[], cur: T): T => list[(list.indexOf(cur) + 1) % list.length] ?? cur

function validPrefs(v: unknown): ReplyExportPrefs {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<ReplyExportPrefs>
  return {
    theme: THEME_ORDER.includes(o.theme as ThemeName) ? (o.theme as ThemeName) : DEFAULT_PREFS.theme,
    width: WIDTH_ORDER.includes(o.width as WidthName) ? (o.width as WidthName) : DEFAULT_PREFS.width,
    lang: LANG_ORDER.includes(o.lang as LangPref) ? (o.lang as LangPref) : DEFAULT_PREFS.lang,
  }
}

async function currentPrefs($: EngineInterface): Promise<{ p: ReplyExportPrefs; lang: Lang }> {
  const p = validPrefs(await read($, prefs))
  const lang: Lang = p.lang === 'auto' ? ((await read($, sysLang)) === 'en' ? 'en' : 'zh') : p.lang
  return { p, lang }
}

/* ---------- 本机能力：剪贴板、原生助手、文件 ---------- */

async function sh($: EngineInterface, script: string, args: string[] = [], stdin?: string, timeoutMs = 30000) {
  return $.process.run(['/bin/sh', '-c', script, 'sh', ...args], { stdin, timeoutMs, env: { LANG: 'en_US.UTF-8' } })
}

async function homeDir($: EngineInterface): Promise<string> {
  return (await sh($, 'printf %s "$HOME"')).stdout
}

// 同一时间只编译一次：两处同时导出时共用同一个编译任务
let building: Promise<string> | null = null
function ensureHelper($: EngineInterface, lang: Lang): Promise<string> {
  building ??= buildHelper($, lang).finally(() => {
    building = null
  })
  return building
}

async function buildHelper($: EngineInterface, lang: Lang): Promise<string> {
  const t = STR[lang]
  const src = `${$.plugin.root}/native/helper.swift`
  const bin = `${await homeDir($)}/Library/Caches/reply-export/helper`
  if ((await sh($, '[ -x "$2" ] && [ ! "$1" -nt "$2" ]', [src, bin])).exitCode === 0) return bin
  if ((await sh($, 'command -v xcrun >/dev/null && xcrun --find swiftc >/dev/null 2>&1')).exitCode !== 0) {
    throw new Error(t.needCLT)
  }
  $.ui.toast(t.preparing)
  const r = await sh($, 'mkdir -p "$(dirname "$2")" && xcrun swiftc -O "$1" -o "$2"', [src, bin], undefined, 180000)
  if (r.exitCode !== 0) throw new Error(t.compileFailed + r.stderr.slice(0, 200))
  return bin
}

type HelperResult = { ok: boolean; error?: string; pages?: number; rtf?: boolean; cards?: string[]; pixels?: number[] }

async function runHelper($: EngineInterface, lang: Lang, job: Record<string, unknown>): Promise<HelperResult> {
  const t = STR[lang]
  const bin = await ensureHelper($, lang)
  const r = await $.process.run([bin], { stdin: JSON.stringify({ ...job, lang }), timeoutMs: 120000 })
  let parsed: HelperResult
  try {
    parsed = JSON.parse(r.stdout) as HelperResult
  } catch {
    throw new Error(t.noResult + (r.stderr || r.stdout).slice(0, 200))
  }
  if (!parsed.ok) throw new Error(parsed.error ?? t.renderFailed)
  return parsed
}

const pad = (n: number) => String(n).padStart(2, '0')
function stamp(md: string, lang: Lang): { file: string; human: string } {
  const d = new Date()
  const safe = safeName(titleOf(md, lang), lang)
  return {
    file: `${safe}-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    human: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

async function outDir($: EngineInterface, lang: Lang): Promise<string> {
  const dir = `${await homeDir($)}/Downloads/${STR[lang].folder}`
  await sh($, 'mkdir -p "$1"', [dir])
  return dir
}

const reveal = ($: EngineInterface, path: string) => sh($, 'open -R "$1"', [path])

/* ---------- 导出动作 ---------- */

// 超过这个高度（像素）的长图，聊天软件常会压缩，提示改用分页卡片
const LONG_IMAGE_PX = 12000

// 方案 B：按用途分组
const COPY_KINDS: Kind[] = ['plain', 'rich', 'image', 'md']
const SAVE_KINDS: Kind[] = ['cards', 'pdf', 'word', 'html']

async function doExport($: EngineInterface, kind: Kind, md: string, p: ReplyExportPrefs, lang: Lang): Promise<string> {
  const t = STR[lang]
  if (kind === 'plain') {
    const text = toPlain(md, lang)
    await sh($, 'pbcopy', [], text)
    return t.done.plain(text.length)
  }
  if (kind === 'md') {
    await sh($, 'pbcopy', [], md)
    return t.done.md
  }
  if (kind === 'rich') {
    const r = await runHelper($, lang, { op: 'clip-rich', html: toRichHtml(md, lang), plain: toPlain(md, lang) })
    return t.done.rich(r.rtf === true)
  }

  const { file, human } = stamp(md, lang)
  const dir = await outDir($, lang)
  const where = t.whereLabel(t.folder)

  if (kind === 'word') {
    const path = `${dir}/${file}.docx`
    const r = await sh($, 'textutil -stdin -format html -convert docx -output "$1"', [path], toWordHtml(md, lang))
    if (r.exitCode !== 0) throw new Error(t.wordFailed + r.stderr.slice(0, 120))
    await runHelper($, lang, { op: 'clip-file', path })
    await reveal($, path)
    return t.done.word(where)
  }

  const page = (width: WidthName, mode: 'long' | 'cards' | 'pdf' | 'html') =>
    toPage(md, { theme: p.theme, width, mode, date: human, lang })

  if (kind === 'html') {
    const path = `${dir}/${file}.html`
    await sh($, 'cat > "$1"', [path], page('desktop', 'html').html)
    await reveal($, path)
    return t.done.html(where)
  }
  if (kind === 'image') {
    const pg = page(p.width, 'long')
    const r = await runHelper($, lang, { op: 'render', mode: 'long', html: pg.html, width: pg.width, bg: pg.bg, png: `${dir}/${file}.png`, copyImage: true })
    const done = t.done.image(`${t.themeNames[p.theme]} · ${t.widthNames[p.width]}`, where)
    return (r.pixels?.[1] ?? 0) > LONG_IMAGE_PX ? `${done}${t.longHint}` : done
  }
  if (kind === 'cards') {
    const pg = page(p.width, 'cards')
    const r = await runHelper($, lang, {
      op: 'render', mode: 'cards', html: pg.html, width: pg.width, bg: pg.bg, muted: THEMES[p.theme].p.muted,
      cardHeight: CARD.height, padTop: CARD.padTop, padBottom: CARD.padBottom, prefix: `${dir}/${file}`,
    })
    const first = r.cards?.[0]
    if (first) await reveal($, first)
    return t.done.cards(r.cards?.length ?? 0, where)
  }
  // pdf：A4 用电脑宽度排版更合适
  const pg = page('desktop', 'pdf')
  const path = `${dir}/${file}.pdf`
  const r = await runHelper($, lang, { op: 'render', mode: 'pdf', html: pg.html, width: pg.width, bg: pg.bg, pdf: path, muted: THEMES[p.theme].p.muted })
  await runHelper($, lang, { op: 'clip-file', path })
  await reveal($, path)
  return t.done.pdf(r.pages ?? 1)
}

// 正在处理的回复：按钮按下后立刻上锁，连点不会导出两次
const locks = new Set<string>()

/* ---------- 注册 ---------- */

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const saved = await $.store.get('prefs')
      await update($, prefs, () => validPrefs(saved))
    } catch {
      // 读不到就用默认值
    }
    try {
      const r = await sh($, 'defaults read -g AppleLanguages 2>/dev/null')
      await update($, sysLang, () => langFromSystem(r.stdout))
    } catch {
      // 读不到就按中文
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) inTurn = true
    return next(e)
  })

  // 每轮结束时让回复重新判断"我是不是最后一段"
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) inTurn = false
    await update($, turnSeq, n => n + 1)
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const original = await next(e)
    if (e.props.isSummary) return original

    const blockText = e.props.text
    const key = blockKey(e.requestId, blockText)
    const known = settled.get(key)
    if (known === false) return original
    let isLatest = false
    if (known === undefined) {
      const seq = await read($, turnSeq) // 订阅：未结束的回复每轮结束后重画
      let located = await resolveReply($, await messages($, seq), e.requestId, blockText)
      if (!located.found) located = await resolveReply($, await messages($, seq, true), e.requestId, blockText)
      // 会话记录里还找不到（正在输出）：先不显示，这一轮结束后会重画
      if (!located.found) return original
      if (located.closed) settled.set(key, located.isLastBlock)
      if (!located.isLastBlock) return original
      isLatest = located.isLatest
    }

    const id = e.requestId
    const at = { requestId: id }
    const [menuState, working, waiting, { p, lang }] = await Promise.all([
      read($, memberOf(menu, e)), read($, memberOf(busy, e)), read($, memberOf(pending, e)), currentPrefs($),
    ])
    const t = STR[lang]
    const { Box, Button, Text } = $.ui.resolve(e)

    const currentMd = async () =>
      replyMarkdown((await resolveReply($, await messages($, await read($, turnSeq), true), id, blockText)).texts)

    const perform = async (kind: Kind, md: string) => {
      const now = await currentPrefs($)
      await update($, memberOf(busy, at), () => STR[now.lang].actions[kind].label)
      try {
        $.ui.toast(await doExport($, kind, md, now.p, now.lang))
        await update($, memberOf(menu, at), () => '')
      } catch (err) {
        $.ui.toast(STR[now.lang].failed(err instanceof Error ? err.message : String(err)))
      } finally {
        await update($, memberOf(busy, at), () => '')
      }
    }

    // 先做隐私检查：发现路径、邮箱、密钥等时让用户选择打码还是原样导出
    const locked = (fn: () => Promise<void>) => async () => {
      if (locks.has(id)) return
      locks.add(id)
      try {
        await fn()
      } finally {
        locks.delete(id)
      }
    }

    const start = (kind: Kind) =>
      locked(async () => {
        if ((await read($, memberOf(busy, at))) !== '') return
        const md = await currentMd()
        const found = scan(md, (await currentPrefs($)).lang)
        if (found.total > 0) {
          await update($, memberOf(pending, at), () => `${kind}|${found.summary}`)
          return
        }
        await perform(kind, md)
      })

    const confirm = (mask: boolean) =>
      locked(async () => {
        const waitingNow = await read($, memberOf(pending, at))
        if (waitingNow === '') return
        const [kind] = waitingNow.split('|') as [Kind]
        await update($, memberOf(pending, at), () => '')
        const md = await currentMd()
        await perform(kind, mask ? redact(md) : md)
      })

    const setMenu = (v: string) => () => void update($, memberOf(menu, at), () => v)
    const savePrefs = (fn: (q: ReplyExportPrefs) => ReplyExportPrefs) => async () => {
      const nextPrefs = fn(validPrefs(await read($, prefs)))
      await update($, prefs, () => nextPrefs)
      await $.store.set('prefs', nextPrefs)
    }

    const action = (k: Kind, primary = false) => {
      const a = t.actions[k]
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
    const group = (key: string, title: string, children: RenderChildren) => (
      <Box key={`g-${key}`} flexDirection="column">
        <Text dimColor size="caption">{title}</Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>{children}</Box>
      </Box>
    )

    let row
    if (working !== '') {
      row = card(<Text dimColor>{t.exporting(working)}</Text>)
    } else if (waiting !== '') {
      const summary = waiting.split('|')[1] ?? ''
      row = card(
        <Text>{t.privacyAsk(summary)}</Text>,
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="mask" variant="primary" label={t.mask} onPress={() => void confirm(true)()} />
          <Button key="raw" label={t.raw} onPress={() => void confirm(false)()} />
          <Button key="cancel" label={t.cancel} onPress={() => void update($, memberOf(pending, at), () => '')} />
        </Box>,
      )
    } else if (menuState === '') {
      row = <Button key="export" label={t.export} onPress={setMenu('open')} />
    } else {
      row = card(
        group('copy', t.groups.copy, COPY_KINDS.map(k => action(k, k === 'plain'))),
        group('save', t.groups.save, SAVE_KINDS.map(k => action(k))),
        group('style', t.groups.style, [
          <Button key="theme" onPress={() => void savePrefs(q => ({ ...q, theme: nextOf(THEME_ORDER, q.theme) }))()}>
            <Text dimColor>{t.theme}</Text>{t.themeNames[p.theme]}
          </Button>,
          <Button key="width" onPress={() => void savePrefs(q => ({ ...q, width: nextOf(WIDTH_ORDER, q.width) }))()}>
            <Text dimColor>{t.width}</Text>{t.widthNames[p.width]}
          </Button>,
          <Button key="lang" onPress={() => void savePrefs(q => ({ ...q, lang: nextOf(LANG_ORDER, q.lang) }))()}>
            <Text dimColor>{t.language}</Text>{t.langNames[p.lang]}
          </Button>,
          <Button key="close" label={t.collapse} onPress={setMenu('')} />,
        ]),
      )
    }

    // 最新一条回复常驻显示；更早的回复平时隐藏，鼠标悬停时浮出（操作进行中则保持显示）
    const alwaysShow = isLatest || menuState !== '' || working !== '' || waiting !== ''
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
