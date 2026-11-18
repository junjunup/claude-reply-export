// 生成 README 顶部的头图和「直接粘贴 vs 导出」对比图（中英文各一套）：
//   docs/<lang>/hero.png           1280×640 的 2 倍图，也可用作 GitHub 社交预览图
//   docs/<lang>/before-after.png   聊天里直接粘贴 Markdown vs 导出纯文本
// 先运行 node scripts/demo.ts（头图要用到它生成的长图和卡片），再运行：node scripts/hero.ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toPlain } from '../hooks/convert.ts'
import type { Lang } from '../hooks/i18n.ts'

const root = join(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'reply-export-hero-'))
const bin = join(tmp, 'helper')
execFileSync('xcrun', ['swiftc', '-O', join(root, 'native/helper.swift'), '-o', bin], { stdio: 'inherit' })

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const img = (p: string) => `data:image/png;base64,${readFileSync(p).toString('base64')}`
const render = (html: string, width: number, png: string) => {
  const r = JSON.parse(execFileSync(bin, { input: JSON.stringify({ op: 'render', mode: 'long', html, width, bg: '#ffffff', png }) }).toString())
  if (!r.ok) throw new Error(r.error)
}

// title 和 sub 是 HTML（用 <br> 控制断行），其余是纯文本
const COPY: Record<Lang, { kicker: string; title: string; sub: string; before: string; after: string; md: string }> = {
  zh: {
    kicker: 'Claude Code 插件 reply-export',
    title: '把 Claude 的回复，<br>变成能直接发出去的样子',
    sub: '一键导出成纯文本、富文本、长图、分页卡片、<br>PDF、Word 或 HTML，全在你的 Mac 上完成。',
    before: '直接粘贴到聊天软件',
    after: '用「纯文本」导出后再粘贴',
    md: `## 三种方案对比

结论：**方案 B** 改动最小，下周就能上线。

| 方案 | 工作量 | 风险 |
|---|---|---|
| A 重写 | 3 周 | 高 |
| B 增量改造 | 4 天 | 低 |

### 下一步

1. 周三前完成接口改造
2. 周四灰度 10% 用户`,
  },
  en: {
    kicker: 'reply-export, a Claude Code plugin',
    title: "Turn Claude's replies<br>into something<br>you can send",
    sub: 'Export any reply as plain text, rich text, a long image, page cards, PDF, Word, or HTML in one click. It all runs on your Mac.',
    before: 'Pasted straight into a chat app',
    after: 'Exported as plain text first',
    md: `## Comparing the options

**Option B** is the smallest change and can ship next week.

| Option | Effort | Risk |
|---|---|---|
| A Rewrite | 3 weeks | High |
| B Incremental | 4 days | Low |

### Next steps

1. Finish the API changes by Wednesday
2. Roll out to 10% of users on Thursday`,
  },
}

const FONT = `-apple-system, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", sans-serif`

for (const lang of ['zh', 'en'] as const) {
  const c = COPY[lang]
  const dir = join(root, 'docs', lang)
  const plain = toPlain(c.md, lang)

  /* ---------- 头图：左边一句话，右边摊开三样真实的导出成品 ---------- */
  const hero = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;}
  body{width:1280px;height:640px;overflow:hidden;background:#1f2d3d;font-family:${FONT};position:relative;}
  .text{position:absolute;left:84px;top:0;bottom:0;width:${lang === 'zh' ? 560 : 540}px;display:flex;flex-direction:column;justify-content:center;}
  .kicker{color:#93a6bb;font-size:22px;margin-bottom:22px;}
  h1{margin:0;color:#ffffff;font-size:${lang === 'zh' ? 50 : 52}px;line-height:1.26;font-weight:650;letter-spacing:${lang === 'zh' ? '0.5px' : '-0.5px'};}
  .sub{margin-top:28px;color:#c3cfdc;font-size:24px;line-height:1.6;max-width:540px;}
  .item{position:absolute;border-radius:14px;overflow:hidden;box-shadow:0 2px 6px rgba(5,10,18,.35),0 28px 60px rgba(5,10,18,.5);}
  .long{left:676px;top:70px;width:236px;height:540px;transform:rotate(-7deg);background:#faf9f5;}
  .long img{width:100%;display:block;}
  .card{left:868px;top:96px;width:300px;height:400px;transform:rotate(5deg);}
  .card img{width:100%;height:100%;display:block;}
  .bubble{left:${lang === 'zh' ? 790 : 770}px;top:${lang === 'zh' ? 372 : 380}px;width:${lang === 'zh' ? 290 : 320}px;padding:16px 18px;background:#ffffff;color:#1f2328;font-size:13.5px;line-height:1.6;white-space:pre-wrap;transform:rotate(-2deg);border-radius:12px;}
  </style></head><body>
  <div class="text"><div class="kicker">${esc(c.kicker)}</div><h1>${c.title}</h1><div class="sub">${c.sub}</div></div>
  <div class="item long"><img src="${img(join(dir, 'long.png'))}"></div>
  <div class="item card"><img src="${img(join(dir, 'card-dark.png'))}"></div>
  <div class="item bubble">${esc(plain.split('\n\n').slice(0, 3).join('\n\n'))}</div>
  </body></html>`
  const heroRaw = join(tmp, `hero-${lang}.png`)
  render(hero, 1280, heroRaw)
  execFileSync('sips', ['-z', '1280', '2560', heroRaw, '--out', join(dir, 'hero.png')], { stdio: 'ignore' })

  /* ---------- 对比图：同样的气泡，左边原文、右边纯文本 ---------- */
  const pane = (title: string, body: string) => `<div class="pane"><div class="title">${esc(title)}</div><div class="bubble">${esc(body)}</div></div>`
  const ba = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;}
  body{width:1280px;background:#eceff3;font-family:${FONT};}
  .wrap{display:flex;gap:48px;padding:52px 56px 60px;}
  .pane{flex:1;}
  .title{font-size:28px;font-weight:600;color:#3d4a59;margin:0 0 20px 4px;}
  .bubble{background:#ffffff;border-radius:18px;padding:26px 30px;font-size:23px;line-height:1.65;color:#1f2328;white-space:pre-wrap;word-break:break-word;box-shadow:0 1px 2px rgba(20,30,45,.08);}
  </style></head><body><div class="wrap">${pane(c.before, c.md)}${pane(c.after, plain)}</div></body></html>`
  render(ba, 1280, join(dir, 'before-after.png'))
}
rmSync(tmp, { recursive: true, force: true })
console.log('已生成 docs/zh|en/hero.png、before-after.png')
