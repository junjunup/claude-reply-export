import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionMessage } from 'claude-code'

import type { ReplyExportPrefs } from '../types'
import { CARD, THEMES, titleOf, toPage, toPlain, toRichHtml, toWordHtml } from './convert.ts'
import type { ThemeName, WidthName } from './convert.ts'
import { STR, langFromSystem } from './i18n.ts'
import type { Kind, Lang, LangPref } from './i18n.ts'
import { redact, scan } from './privacy.ts'

const menu = atom({ plugin: 'reply-export', key: 'menu' } as const, '')
const busy = atom({ plugin: 'reply-export', key: 'busy' } as const, '')
const pending = atom({ plugin: 'reply-export', key: 'pending' } as const, '')
const turnSeq = atom({ plugin: 'reply-export', key: 'turnSeq' } as const, 0)
const DEFAULT_PREFS: ReplyExportPrefs = { theme: 'paper', width: 'phone', lang: 'auto' }
const prefs = atom({ plugin: 'reply-export', key: 'prefs' } as const, DEFAULT_PREFS)
const sysLang = atom({ plugin: 'reply-export', key: 'sysLang' } as const, 'zh')

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

async function ensureHelper($: EngineInterface, lang: Lang): Promise<string> {
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

type HelperResult = { ok: boolean; error?: string; pages?: number; rtf?: boolean; cards?: string[] }

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
  const safe = titleOf(md, lang).replace(/[\\/:*?"<>|\s]+/g, lang === 'en' ? '-' : '').replace(/^-+|-+$/g, '').slice(0, 32) || 'Claude'
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
    const r = await runHelper($, lang, { op: 'clip-rich', html: toRichHtml(md), plain: toPlain(md, lang) })
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
    await runHelper($, lang, { op: 'render', mode: 'long', html: pg.html, width: pg.width, bg: pg.bg, png: `${dir}/${file}.png`, copyImage: true })
    return t.done.image(`${t.themeNames[p.theme]} · ${t.widthNames[p.width]}`, where)
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
  const r = await runHelper($, lang, { op: 'render', mode: 'pdf', html: pg.html, width: pg.width, bg: pg.bg, pdf: path })
  await runHelper($, lang, { op: 'clip-file', path })
  await reveal($, path)
  return t.done.pdf(r.pages ?? 1)
}

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
    const [menuState, working, waiting, { p, lang }] = await Promise.all([
      read($, memberOf(menu, e)), read($, memberOf(busy, e)), read($, memberOf(pending, e)), currentPrefs($),
    ])
    const t = STR[lang]
    const { Box, Button, Text } = $.ui.resolve(e)

    const currentMd = async () => replyMarkdown(locateReply(await messages($, await read($, turnSeq), true), blockText).texts)

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
    const start = (kind: Kind) => async () => {
      if ((await read($, memberOf(busy, at))) !== '') return
      const md = await currentMd()
      const found = scan(md, (await currentPrefs($)).lang)
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
