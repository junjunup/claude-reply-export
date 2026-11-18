// 生成 README 里的效果图：docs/demo-long.png、docs/demo-cards.png
// 运行：node scripts/demo.ts   （需要 macOS 和 Xcode 命令行工具）
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CARD, THEMES, toPage } from '../hooks/convert.ts'

const root = join(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'reply-export-demo-'))
const docs = join(root, 'docs')
mkdirSync(docs, { recursive: true })
const bin = join(tmp, 'helper')
execFileSync('xcrun', ['swiftc', '-O', join(root, 'native/helper.swift'), '-o', bin], { stdio: 'inherit' })
const run = (job: Record<string, unknown>) =>
  JSON.parse(execFileSync(bin, { input: JSON.stringify({ ...job, lang: 'zh' }) }).toString()) as { cards?: string[] }

const md = `## 三种方案对比

结论：**方案 B** 改动最小，下周就能上线。

| 方案 | 工作量 | 风险 |
|---|---|---|
| A 重写 | 3 周 | 高 |
| B 增量改造 | 4 天 | 低 |
| C 外包 | 2 周 | 中 |

### 下一步

1. 周三前完成接口改造
2. 周四灰度 10% 用户
3. 周五全量

\`\`\`ts
export const rollout = { percent: 10, until: '2026-11-20' }
\`\`\`

> 导出在本机完成，不经过模型，不消耗 token。`

const date = '2026-11-17 10:30'
const long = toPage(md, { theme: 'paper', width: 'phone', mode: 'long', date, lang: 'zh' })
run({ op: 'render', mode: 'long', html: long.html, width: long.width, bg: long.bg, png: join(docs, 'demo-long.png') })
execFileSync('sips', ['-Z', '1400', join(docs, 'demo-long.png')], { stdio: 'ignore' })

const cardsPage = toPage(md, { theme: 'dark', width: 'phone', mode: 'cards', date, lang: 'zh' })
const r = run({
  op: 'render', mode: 'cards', html: cardsPage.html, width: cardsPage.width, bg: cardsPage.bg, muted: THEMES.dark.p.muted,
  cardHeight: CARD.height, padTop: CARD.padTop, padBottom: CARD.padBottom, prefix: join(tmp, 'card'),
})
const first = r.cards?.[0]
if (first) execFileSync('sips', ['-Z', '800', first, '--out', join(docs, 'demo-card.png')], { stdio: 'ignore' })
console.log('已生成 docs/demo-long.png、docs/demo-card.png')
