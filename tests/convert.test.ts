import { expect, test } from 'claude-code/testing'

import { toPage, toPlain, toRichHtml } from '../hooks/convert.ts'
import { redact, scan } from '../hooks/privacy.ts'

test('纯文本：标题、表格、列表', async () => {
  const md = '## 结论\n\n| 格式 | 场景 | 状态 |\n|---|---|---|\n| 长图 | 朋友圈 | 完成 |\n\n- 一\n  - 二'
  const zh = toPlain(md, 'zh')
  expect(zh).toContain('【结论】')
  expect(zh).toContain('• 格式：长图\n　场景：朋友圈')
  expect(zh).toContain('　◦ 二')
  const en = toPlain('## Notes\n\n| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |', 'en')
  expect(en).toContain('■ Notes')
  expect(en).toContain('• A: 1\n  B: 2')
})

test('中英文加空格，但不动代码和网址', async () => {
  expect(toPlain('用WebKit渲染')).toBe('用 WebKit 渲染')
  expect(toPlain('运行`npm安装`即可')).toBe('运行npm安装即可')
  expect(toPlain('见 https://a.com/路径abc')).toContain('https://a.com/路径abc')
  expect(toRichHtml('运行`npm安装`即可')).toContain('npm安装</code>')
})

test('危险链接不保留，正常链接保留', async () => {
  expect(toRichHtml('[x](javascript:alert(1))')).not.toContain('javascript:')
  expect(toRichHtml('[x](https://a.com)')).toContain('href="https://a.com"')
  expect(toPlain('[x](javascript:alert(1))')).not.toContain('javascript:')
})

test('渲染长图时不联网：远程图片换成占位文字，并带安全策略', async () => {
  const { html } = toPage('![logo](https://x.com/a.png)', { theme: 'paper', width: 'phone', mode: 'long', date: '', lang: 'en' })
  expect(html).not.toContain('<img')
  expect(html).toContain('[Image: logo]')
  expect(html).toContain("img-src data:")
})

test('隐私检查：识别并打码，不误判文件名', async () => {
  const md = '路径 /Users/bob/x，邮箱 a.b@corp.com，图标 icon@2x.png，手机 13812345678，密钥 sk-ant-abcdefghijklmnop1234'
  const s = scan(md, 'zh')
  expect(s.total).toBe(4)
  const r = redact(md)
  expect(r).toContain('~/x')
  expect(r).toContain('a•••@corp.com')
  expect(r).toContain('icon@2x.png')
  expect(r).toContain('138••••5678')
  expect(r).not.toContain('abcdefghijklmnop')
  expect(scan(md, 'en').summary).toContain('1 email address')
})
