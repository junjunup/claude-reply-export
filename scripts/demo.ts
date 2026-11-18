// 生成 README 里的效果图（中英文各一套）：
//   docs/<lang>/long.png                    长图（暖纸主题）
//   docs/<lang>/card-paper|clean|dark.png   三套主题的分页卡片
// 运行：node scripts/demo.ts   （需要 macOS 和 Xcode 命令行工具）
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CARD, THEMES, toPage } from '../hooks/convert.ts'
import type { ThemeName } from '../hooks/convert.ts'
import type { Lang } from '../hooks/i18n.ts'

const root = join(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'reply-export-demo-'))
const bin = join(tmp, 'helper')
execFileSync('xcrun', ['swiftc', '-O', join(root, 'native/helper.swift'), '-o', bin], { stdio: 'inherit' })
const run = (job: Record<string, unknown>) =>
  JSON.parse(execFileSync(bin, { input: JSON.stringify(job) }).toString()) as { cards?: string[] }
const shrink = (src: string, px: number, out: string) => execFileSync('sips', ['-Z', String(px), src, '--out', out], { stdio: 'ignore' })

const SAMPLES: Record<Lang, string> = {
  zh: `## 三种方案对比

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

> 导出在本机完成，不经过模型，不消耗 token。`,
  en: `## Comparing the options

**Option B** is the smallest change and can ship next week.

| Option | Effort | Risk |
|---|---|---|
| A Rewrite | 3 weeks | High |
| B Incremental | 4 days | Low |
| C Outsource | 2 weeks | Medium |

### Next steps

1. Finish the API changes by Wednesday
2. Roll out to 10% of users on Thursday
3. Full rollout on Friday

\`\`\`ts
export const rollout = { percent: 10, until: '2026-11-20' }
\`\`\`

> Exports run on your Mac. Nothing goes through the model.`,
}

const date = '2026-11-17 10:30'
for (const lang of ['zh', 'en'] as const) {
  const md = SAMPLES[lang]
  const dir = join(root, 'docs', lang)
  mkdirSync(dir, { recursive: true })

  const long = toPage(md, { theme: 'paper', width: 'phone', mode: 'long', date, lang })
  const longRaw = join(tmp, `long-${lang}.png`)
  run({ op: 'render', mode: 'long', html: long.html, width: long.width, bg: long.bg, png: longRaw, lang })
  shrink(longRaw, 1400, join(dir, 'long.png'))

  for (const theme of ['paper', 'clean', 'dark'] as ThemeName[]) {
    const pg = toPage(md, { theme, width: 'phone', mode: 'cards', date, lang })
    const r = run({
      op: 'render', mode: 'cards', html: pg.html, width: pg.width, bg: pg.bg, muted: THEMES[theme].p.muted,
      cardHeight: CARD.height, padTop: CARD.padTop, padBottom: CARD.padBottom, prefix: join(tmp, `card-${lang}-${theme}`), lang,
    })
    const first = r.cards?.[0]
    if (first) shrink(first, 800, join(dir, `card-${theme}.png`))
  }
}
rmSync(tmp, { recursive: true, force: true })
console.log('已生成 docs/zh/*.png、docs/en/*.png')
