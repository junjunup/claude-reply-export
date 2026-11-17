// Markdown → 纯文本 / 富文本 HTML / 可渲染的完整页面
import { Lexer, Parser, Renderer } from './vendor/marked.esm.js'
import type { Token, Tokens } from './vendor/marked.esm.js'
import { STR } from './i18n.ts'
import type { Lang } from './i18n.ts'

export type ThemeName = 'paper' | 'clean' | 'dark'
export type WidthName = 'phone' | 'desktop'
export type PageMode = 'long' | 'cards' | 'pdf' | 'html'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '')

/* ---------- 中英文之间加空格 ---------- */

const CJK = '⺀-⻿⼀-⿟぀-ゟ゠-ヿ㄀-ㄯ㈀-㋿㐀-䶿一-鿿豈-﫿'
const CJK_THEN_LATIN = new RegExp(`([${CJK}])([A-Za-z0-9@#$%^&*+=\\-(\\[{])`, 'g')
const LATIN_THEN_CJK = new RegExp(`([A-Za-z0-9!%&*+=\\-)\\]}])([${CJK}])`, 'g')

export function cjkSpace(s: string): string {
  return s.replace(CJK_THEN_LATIN, '$1 $2').replace(LATIN_THEN_CJK, '$1 $2')
}

// 只处理标签外、代码外的文字
function cjkSpaceHtml(html: string): string {
  return html
    .split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>|<[^>]+>)/)
    .map(part => (part.startsWith('<') ? part : cjkSpace(part)))
    .join('')
}

/* ---------- 纯文本：给微信这类不认 Markdown 的平台 ---------- */

// 当前语言的纯文本标记；toPlain 同步运行，开始时设定
let P = STR.zh.plain

function inlinePlain(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  return tokens
    .map(t => {
      switch (t.type) {
        case 'strong':
        case 'em':
        case 'del':
          return inlinePlain((t as Tokens.Strong).tokens)
        case 'codespan':
          return (t as Tokens.Codespan).text
        case 'link': {
          const l = t as Tokens.Link
          const text = inlinePlain(l.tokens)
          const href = l.href.replace(/^mailto:/, '')
          return text === href || l.href.startsWith('#') ? text : P.link(text, l.href)
        }
        case 'image': {
          const i = t as Tokens.Image
          return P.image(i.text, i.href)
        }
        case 'br':
          return '\n'
        case 'html':
          return stripTags((t as Tokens.HTML).text)
        case 'text': {
          const x = t as Tokens.Text
          return x.tokens ? inlinePlain(x.tokens) : x.text
        }
        default:
          return 'text' in t && typeof t.text === 'string' ? t.text : t.raw
      }
    })
    .join('')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

const inlineText = (tokens: Token[] | undefined) => cjkSpace(inlinePlain(tokens))

function listPlain(list: Tokens.List, depth: number): string {
  const indent = P.indent.repeat(depth)
  const start = typeof list.start === 'number' ? list.start : 1
  return list.items
    .map((item, i) => {
      const mark = item.task ? (item.checked ? '☑ ' : '☐ ') : list.ordered ? `${start + i}. ` : depth === 0 ? '• ' : '◦ '
      const parts: string[] = []
      for (const t of item.tokens) {
        if (t.type === 'list') parts.push('\n' + listPlain(t as Tokens.List, depth + 1))
        else if (t.type === 'text' || t.type === 'paragraph') parts.push(inlineText((t as Tokens.Text).tokens) || cjkSpace((t as Tokens.Text).text))
        else if (t.type === 'checkbox') continue
        else parts.push(blocksPlain([t]))
      }
      return indent + mark + parts.join('').replace(/^\n+/, '')
    })
    .join('\n')
}

function tablePlain(t: Tokens.Table): string {
  const head = t.header.map(c => inlineText(c.tokens))
  return t.rows
    .map(row => {
      const cells = row.map(c => inlineText(c.tokens))
      if (cells.length <= 2) return `• ${cells[0] ?? ''}${cells[1] !== undefined ? P.colon + cells[1] : ''}`
      const lines = cells.slice(1).map((c, i) => `${P.indent}${head[i + 1] ?? ''}${P.colon}${c}`)
      return `• ${head[0] ? head[0] + P.colon : ''}${cells[0] ?? ''}\n${lines.join('\n')}`
    })
    .join('\n')
}

function blocksPlain(tokens: Token[]): string {
  const out: string[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
        break
      case 'heading': {
        const h = t as Tokens.Heading
        const text = inlineText(h.tokens)
        out.push(h.depth <= 2 ? P.h12(text) : P.h3(text))
        break
      }
      case 'paragraph':
        out.push(inlineText((t as Tokens.Paragraph).tokens))
        break
      case 'list':
        out.push(listPlain(t as Tokens.List, 0))
        break
      case 'code':
        out.push((t as Tokens.Code).text)
        break
      case 'blockquote':
        out.push(blocksPlain((t as Tokens.Blockquote).tokens).split('\n').map(l => P.quote + l).join('\n'))
        break
      case 'table':
        out.push(tablePlain(t as Tokens.Table))
        break
      case 'hr':
        out.push('————————')
        break
      case 'html':
        out.push(stripTags((t as Tokens.HTML).text).trim())
        break
      default:
        out.push('text' in t && typeof t.text === 'string' ? t.text : t.raw)
    }
  }
  return out.filter(s => s.trim() !== '').join('\n\n')
}

export function toPlain(md: string, lang: Lang = 'zh'): string {
  P = STR[lang].plain
  return blocksPlain(Lexer.lex(md, { gfm: true })).replace(/\n{3,}/g, '\n\n').trim()
}

/* ---------- 代码高亮（轻量通用版，不依赖外部库） ---------- */

const KEYWORDS = new Set(
  ('abstract and as async await break case catch class const continue def default defer del delete do elif else enum export extends ' +
    'false final finally fn for from func function go if impl import in interface is lambda let loop match mod mut new nil none ' +
    'not null or package pass private protected pub public raise return self static struct super switch this throw true try type ' +
    'typeof undefined use var void where while with yield True False None echo fi then esac done local readonly')
    .split(' '),
)
const HASH_COMMENT = new Set(['py', 'python', 'sh', 'bash', 'zsh', 'shell', 'yaml', 'yml', 'toml', 'rb', 'ruby', 'r', 'perl', 'dockerfile', 'makefile', 'ini', 'conf'])

export function highlight(code: string, lang: string): string {
  const hash = HASH_COMMENT.has(lang.toLowerCase())
  const comment = hash ? '#[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|--\\s[^\\n]*'
  const re = new RegExp(
    `(${comment})|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_][A-Za-z0-9_]*)`,
    'g',
  )
  let out = ''
  let last = 0
  for (const m of code.matchAll(re)) {
    const i = m.index ?? 0
    out += escapeHtml(code.slice(last, i))
    const [all, c, s, n, w] = m
    if (c) out += `<span class="tk-c">${escapeHtml(c)}</span>`
    else if (s) out += `<span class="tk-s">${escapeHtml(s)}</span>`
    else if (n) out += `<span class="tk-n">${n}</span>`
    else if (w && KEYWORDS.has(w)) out += `<span class="tk-k">${w}</span>`
    else out += escapeHtml(all)
    last = i + all.length
  }
  return out + escapeHtml(code.slice(last))
}

/* ---------- HTML ---------- */

class ExportRenderer extends Renderer {
  // 原始 HTML 一律转义显示，不执行
  override html(token: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(token.text)
  }
  override code(token: Tokens.Code): string {
    const lang = (token.lang ?? '').trim().split(/\s+/)[0] ?? ''
    const label = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : ''
    return `<pre>${label}<code>${highlight(token.text.replace(/\n$/, ''), lang)}</code></pre>\n`
  }
}

function mdToHtml(md: string): string {
  const tokens = Lexer.lex(md, { gfm: true })
  return cjkSpaceHtml(Parser.parse(tokens, { gfm: true, renderer: new ExportRenderer() }))
}

/* ---------- 主题 ---------- */

type Palette = {
  bg: string; card: string; text: string; muted: string; accent: string; border: string
  codeBg: string; codeText: string; inlineCode: string; inlineCodeBg: string; link: string
  quoteBg: string; thBg: string; k: string; s: string; c: string; n: string
}

export const THEMES: Record<ThemeName, { label: string; p: Palette }> = {
  paper: {
    label: '暖纸',
    p: {
      bg: '#faf9f5', card: '#f0eee6', text: '#1f1e1d', muted: '#8a877f', accent: '#d97757', border: '#e3dfd4',
      codeBg: '#f0eee6', codeText: '#2b2a28', inlineCode: '#b4532a', inlineCodeBg: '#f0e9df', link: '#2f6fb3',
      quoteBg: '#f3f0e8', thBg: '#efebe2', k: '#a3402a', s: '#4f7a3a', c: '#9a968c', n: '#9a5b14',
    },
  },
  clean: {
    label: '简白',
    p: {
      bg: '#ffffff', card: '#f5f7fa', text: '#1f2328', muted: '#8c959f', accent: '#2f6fb3', border: '#e4e7eb',
      codeBg: '#f6f8fa', codeText: '#1f2328', inlineCode: '#c7254e', inlineCodeBg: '#f3f4f6', link: '#2f6fb3',
      quoteBg: '#f6f8fa', thBg: '#f3f4f6', k: '#cf222e', s: '#0a3069', c: '#8c959f', n: '#0550ae',
    },
  },
  dark: {
    label: '深色',
    p: {
      bg: '#1f1e1d', card: '#2a2927', text: '#ece9e1', muted: '#8f8b83', accent: '#e08a6a', border: '#3a3835',
      codeBg: '#2a2927', codeText: '#e6e2d8', inlineCode: '#f0a17c', inlineCodeBg: '#34312d', link: '#7fb2ff',
      quoteBg: '#2a2927', thBg: '#2f2d2a', k: '#ff8f70', s: '#a6cf7c', c: '#7d796f', n: '#e5b567',
    },
  },
}

export const WIDTHS: Record<WidthName, { label: string; px: number; font: number; pad: number }> = {
  phone: { label: '手机', px: 420, font: 17, pad: 24 },
  desktop: { label: '电脑', px: 750, font: 16, pad: 44 },
}
export const CARD = { width: 600, height: 800, padX: 40, padTop: 48, padBottom: 56 }

function pageCss(p: Palette, width: number, font: number, padX: number): string {
  return `
  html,body{margin:0;background:${p.bg};}
  body{font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;font-size:${font}px;line-height:1.8;color:${p.text};-webkit-font-smoothing:antialiased;}
  .wrap{width:${width}px;box-sizing:border-box;margin:0 auto;}
  .content{padding:0 ${padX}px;word-break:break-word;}
  .content > :first-child{margin-top:0 !important;}
  .hero{margin:0 ${padX}px 26px;padding:22px 24px;background:${p.card};border-radius:14px;border-left:5px solid ${p.accent};}
  .hero h1{margin:0;font-size:${Math.round(font * 1.45)}px;line-height:1.4;font-weight:700;letter-spacing:.2px;}
  .hero .meta{margin-top:8px;font-size:${Math.round(font * 0.78)}px;color:${p.muted};}
  h1,h2,h3,h4{line-height:1.45;margin:1.3em 0 .55em;font-weight:700;}
  h1{font-size:1.4em;} h2{font-size:1.22em;padding-left:10px;border-left:4px solid ${p.accent};}
  h3{font-size:1.08em;} h4{font-size:1em;color:${p.muted};}
  p{margin:.6em 0;} strong{font-weight:700;} a{color:${p.link};text-decoration:none;}
  ul,ol{margin:.5em 0;padding-left:1.4em;} li{margin:.25em 0;} li::marker{color:${p.accent};}
  blockquote{margin:.9em 0;padding:.5em 1em;border-left:3px solid ${p.accent};background:${p.quoteBg};color:${p.muted};border-radius:0 8px 8px 0;}
  blockquote p{margin:.3em 0;}
  code{font-family:"SF Mono",Menlo,Consolas,monospace;font-size:.88em;background:${p.inlineCodeBg};color:${p.inlineCode};padding:1px 6px;border-radius:5px;}
  pre{position:relative;margin:1em 0;padding:16px 18px;background:${p.codeBg};border-radius:10px;font-size:${Math.round(font * 0.8)}px;line-height:1.65;white-space:pre-wrap;word-break:break-all;}
  pre code{background:none;color:${p.codeText};padding:0;font-size:inherit;}
  .code-lang{position:absolute;top:6px;right:12px;font-size:11px;color:${p.muted};font-family:-apple-system,sans-serif;text-transform:lowercase;}
  .tk-k{color:${p.k};font-weight:600;} .tk-s{color:${p.s};} .tk-c{color:${p.c};font-style:italic;} .tk-n{color:${p.n};}
  table{border-collapse:separate;border-spacing:0;margin:1em 0;font-size:.9em;width:100%;border:1px solid ${p.border};border-radius:10px;overflow:hidden;}
  th,td{padding:8px 12px;text-align:left;vertical-align:top;border-bottom:1px solid ${p.border};}
  th{background:${p.thBg};font-weight:700;} tr:last-child td{border-bottom:none;}
  td + td, th + th{border-left:1px solid ${p.border};}
  hr{border:none;border-top:1px dashed ${p.border};margin:1.6em 0;}
  img{max-width:100%;border-radius:8px;}
  input[type=checkbox]{accent-color:${p.accent};margin-right:6px;}
  .footer{margin:28px ${padX}px 0;padding:14px 0 30px;border-top:1px solid ${p.border};color:${p.muted};font-size:12px;display:flex;justify-content:space-between;}
  `
}

// 回复以一级或二级标题开头时，把它提成标题卡，正文里不再重复
function splitTitle(md: string): { title: string | null; body: string } {
  const m = md.match(/^\s*#{1,2}\s+(.+?)\s*#*\s*\n/)
  if (!m || m[1] === undefined) return { title: null, body: md }
  return { title: m[1].replace(/[*_`]/g, ''), body: md.slice(m[0].length) }
}

export function titleOf(md: string, lang: Lang = 'zh'): string {
  const fallback = STR[lang].defaultTitle
  const { title } = splitTitle(md)
  const first = title ?? md.split('\n').find(l => l.trim() !== '') ?? fallback
  return first.replace(/[*_`#>[\]|]/g, '').trim().slice(0, 40) || fallback
}

export type PageOptions = { theme: ThemeName; width: WidthName; mode: PageMode; date: string; lang: Lang }

/** 渲染长图 / 卡片 / PDF / 保存 HTML 用的完整页面 */
export function toPage(md: string, o: PageOptions): { html: string; width: number; bg: string } {
  const { p } = THEMES[o.theme]
  const isCard = o.mode === 'cards'
  const w = isCard ? { px: CARD.width, font: 17, pad: CARD.padX } : WIDTHS[o.width]
  const { title, body } = splitTitle(md)
  const hero = title
    ? `<div class="hero"><h1>${escapeHtml(cjkSpace(title))}</h1><div class="meta">${escapeHtml(o.date)}</div></div>`
    : ''
  const topPad = isCard ? 0 : 36
  // 卡片模式的页码由原生助手画，不需要页脚
  const footer = isCard ? '' : `<div class="footer"><span>${title ? '' : escapeHtml(o.date)}</span><span>${escapeHtml(STR[o.lang].footer)}</span></div>`
  const html = `<!doctype html>
<html lang="${o.lang === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(titleOf(md, o.lang))}</title>
<style>${pageCss(p, w.px, w.font, w.pad)}
  .wrap{padding-top:${topPad}px;}
</style></head>
<body><div class="wrap">${hero}<div class="content">${mdToHtml(body)}</div>${footer}</div></body></html>`
  return { html, width: w.px, bg: p.bg }
}

/* ---------- 剪贴板富文本：内联样式，粘贴到飞书 / 公众号 / 邮件时样式跟着走 ---------- */

const S = {
  h1: 'font-size:22px;font-weight:700;margin:18px 0 10px;',
  h2: 'font-size:19px;font-weight:700;margin:16px 0 8px;padding-left:8px;border-left:4px solid #d97757;',
  h3: 'font-size:17px;font-weight:700;margin:14px 0 6px;',
  h4: 'font-size:15px;font-weight:700;margin:12px 0 6px;',
  p: 'margin:8px 0;line-height:1.75;',
  ul: 'margin:8px 0;padding-left:22px;',
  ol: 'margin:8px 0;padding-left:22px;',
  li: 'margin:4px 0;line-height:1.75;',
  blockquote: 'margin:10px 0;padding:6px 12px;border-left:3px solid #d97757;color:#555;background:#f7f5f0;',
  table: 'border-collapse:collapse;margin:10px 0;font-size:14px;',
  th: 'border:1px solid #d6d2c8;padding:6px 10px;background:#f3f1ec;font-weight:700;text-align:left;',
  td: 'border:1px solid #d6d2c8;padding:6px 10px;vertical-align:top;',
  pre: 'margin:10px 0;padding:12px 14px;background:#f5f3ee;border-radius:6px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-all;',
  preCode: 'font-family:Menlo,Consolas,monospace;background:none;padding:0;color:#2b2a28;',
  code: 'font-family:Menlo,Consolas,monospace;font-size:0.9em;background:#f3efe9;padding:1px 5px;border-radius:4px;color:#b4532a;',
  hr: 'border:none;border-top:1px solid #ddd;margin:16px 0;',
  a: 'color:#2f6fb3;text-decoration:none;',
  img: 'max-width:100%;',
} as const

const TOKEN_STYLE: Record<string, string> = {
  'tk-k': 'color:#a3402a;font-weight:600;',
  'tk-s': 'color:#4f7a3a;',
  'tk-c': 'color:#9a968c;font-style:italic;',
  'tk-n': 'color:#9a5b14;',
}

function inlineStyles(html: string): string {
  let out = html
    .replace(/<div class="code-lang">[\s\S]*?<\/div>/g, '')
    .replace(/<pre><code/g, `<pre style="${S.pre}"><code style="${S.preCode}"`)
    .replace(/<span class="(tk-[kscn])">/g, (_m, c: string) => `<span style="${TOKEN_STYLE[c] ?? ''}">`)
  for (const [tag, style] of Object.entries(S)) {
    if (tag === 'pre' || tag === 'preCode') continue
    out = out.replace(new RegExp(`<${tag}(?=[\\s>])(?! style=)`, 'g'), `<${tag} style="${style}"`)
  }
  return out
}

/** 剪贴板用的富文本片段（带内联样式） */
export function toRichHtml(md: string): string {
  return `<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:15px;color:#222;">${inlineStyles(mdToHtml(md))}</div>`
}

/** Word 用：同样的内联样式，加上完整文档外壳 */
export function toWordHtml(md: string, lang: Lang = 'zh'): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(titleOf(md, lang))}</title></head><body>${toRichHtml(md)}</body></html>`
}
