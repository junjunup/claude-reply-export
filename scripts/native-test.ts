// 原生助手集成测试：编译 native/helper.swift，渲染长图 / 卡片 / PDF，检查输出。
// 运行：node scripts/native-test.ts [输出目录]   （需要 macOS 和 Xcode 命令行工具；不碰剪贴板）
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CARD, THEMES, toPage } from '../hooks/convert.ts'

const root = join(import.meta.dirname, '..')
const out = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'reply-export-native-'))
const bin = join(out, 'helper')
execFileSync('xcrun', ['swiftc', '-O', join(root, 'native/helper.swift'), '-o', bin], { stdio: 'inherit' })

const code = Array.from({ length: 70 }, (_, i) => `  const value${i} = compute(${i}) // 第 ${i + 1} 行`).join('\n')
const md = [
  '## 导出效果示例',
  '',
  '这是一段**示例回复**，包含[一个链接](https://github.com/junjunup/claude-reply-export)、`行内代码`和脚注[^1]。',
  '',
  '| 格式 | 适合 | 说明 |',
  '|---|---|---|',
  '| 长图 | 聊天 | 直接粘贴 |',
  '| 分页卡片 | 小红书 | 3:4 多张 |',
  '| PDF | 存档 | A4 分页、带页码 |',
  '',
  '> 引用：导出在本机完成，不经过模型。',
  '',
  '```ts',
  code,
  '```',
  '',
  '- 第一项',
  '- 第二项',
  '',
  '[^1]: 脚注会收到文末。',
].join('\n')

let failed = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`)
  if (!ok) failed++
}
const run = (job: Record<string, unknown>) => {
  const res = execFileSync(bin, { input: JSON.stringify({ ...job, lang: 'zh' }), maxBuffer: 1 << 26 }).toString()
  return JSON.parse(res) as { ok: boolean; pages?: number; cards?: string[]; pixels?: number[] }
}
const theme = THEMES.paper.p

// PDF：多页、有页码、有可点链接
{
  const pg = toPage(md, { theme: 'paper', width: 'desktop', mode: 'pdf', date: '2026-01-01 00:00', lang: 'zh' })
  const pdf = join(out, 'sample.pdf')
  const r = run({ op: 'render', mode: 'pdf', html: pg.html, width: pg.width, bg: pg.bg, pdf, muted: theme.muted })
  check(r.ok && existsSync(pdf), 'PDF 生成')
  check((r.pages ?? 0) >= 2, `PDF 分页（${r.pages} 页）`)
  const bytes = readFileSync(pdf).toString('latin1')
  check(bytes.includes('/URI') && bytes.includes('github.com/junjunup'), 'PDF 链接可点')
}

// 分页卡片：3:4、至少两张
{
  const pg = toPage(md, { theme: 'paper', width: 'phone', mode: 'cards', date: '', lang: 'zh' })
  const r = run({
    op: 'render', mode: 'cards', html: pg.html, width: pg.width, bg: pg.bg, muted: theme.muted,
    cardHeight: CARD.height, padTop: CARD.padTop, padBottom: CARD.padBottom, prefix: join(out, 'card'),
  })
  const cards = r.cards ?? []
  check(cards.length >= 2, `卡片（${cards.length} 张）`)
  const first = cards[0]
  if (first) {
    const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', first]).toString()
    const w = Number(dims.match(/pixelWidth: (\d+)/)?.[1]), h = Number(dims.match(/pixelHeight: (\d+)/)?.[1])
    check(Math.abs(w / h - 0.75) < 0.01, `卡片比例 3:4（${w}×${h}）`)
  }
}

// 长图：手机宽度放大约 1.5 倍
{
  const pg = toPage(md, { theme: 'paper', width: 'phone', mode: 'long', date: '2026-01-01 00:00', lang: 'zh' })
  const png = join(out, 'long.png')
  const r = run({ op: 'render', mode: 'long', html: pg.html, width: pg.width, bg: pg.bg, png })
  check(r.ok && statSync(png).size > 0, '长图生成')
  check((r.pixels?.[0] ?? 0) >= pg.width * 1.5, `长图清晰度（宽 ${r.pixels?.[0]} 像素）`)
}

console.log(`\n输出目录：${out}`)
process.exit(failed ? 1 : 0)
