import { expect, test } from 'claude-code/testing'

import { footnotes, highlight, safeName, titleOf, toPage, toPlain, toRichHtml, toWordHtml } from '../hooks/convert.ts'
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

test('富文本和 Word 不放远程图片（转换时系统会去下载）', async () => {
  const md = '![logo](https://track.example/p.png)'
  expect(toRichHtml(md, 'zh')).not.toContain('<img')
  expect(toRichHtml(md, 'zh')).toContain('[图片：logo]')
  expect(toWordHtml(md, 'en')).not.toContain('<img')
})

test('脚注：引用变上标，定义收到文末，不丢内容', async () => {
  const md = '正文[^1]，另一处[^b]。\n\n[^b]: 第二条\n[^1]: 第一条\n  续行\n\n```\n[^1]: 代码里的不动\n```'
  const plain = toPlain(md, 'zh')
  expect(plain).toContain('正文¹，另一处²。')
  expect(plain).toContain('注释')
  expect(plain).toContain('1. 第一条 续行')
  expect(plain).toContain('2. 第二条')
  expect(plain).toContain('[^1]: 代码里的不动')
  expect(toRichHtml(md)).toContain('第一条 续行')
  expect(footnotes('没有脚注 `[^x]`')).toBe('没有脚注 `[^x]`')
  const { html } = toPage(md, { theme: 'paper', width: 'phone', mode: 'long', date: '', lang: 'en' })
  expect(html).toContain('Notes')
})

test('隐私检查：更多密钥类型、分隔的手机号、IP、Windows 路径', async () => {
  const cases: [string, string][] = [
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123456', 'secret'],
    ['-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----', 'secret'],
    ['https://admin:hunter2@db.example.com', 'secret'],
    ['password=Sup3rS3cret!', 'secret'],
    ['Authorization: Bearer abcdef1234567890abcdef', 'secret'],
    ['sk_live_51Habcdefghijklmnop', 'secret'],
    ['138-1234-5678', 'phone'],
    ['+86 138 1234 5678', 'phone'],
    ['192.168.1.20', 'ip'],
    ['C:\\Users\\bob\\x', 'path'],
  ]
  for (const [text, kind] of cases) {
    const s = scan(text, 'zh')
    expect(s.total).toBe(1)
    expect(s.summary).toContain({ secret: '疑似密钥', phone: '手机号', ip: 'IP 地址', path: '本机路径' }[kind] ?? '?')
  }
  const r = redact('https://admin:hunter2@db.example.com 138-1234-5678 192.168.1.20 password=Sup3rS3cret! C:\\Users\\bob\\x')
  expect(r).not.toContain('hunter2')
  expect(r).toContain('https://admin:••••••@db.example.com')
  expect(r).toContain('138••••5678')
  expect(r).toContain('192.168.•.•')
  expect(r).not.toContain('Sup3rS3cret')
  expect(r).toContain('~\\x')
})

test('隐私检查：不误报常见写法', async () => {
  for (const text of ['token: string', 'password = process.env.PW', 'version 1.2.3.4', 'localhost 127.0.0.1', '/Users/Shared', 'api_key: ${KEY}']) {
    expect(scan(text, 'zh').total).toBe(0)
  }
})

test('代码高亮：跨行注释按行拆开，PDF / 卡片里每行一个块', async () => {
  const h = highlight('a /* 一\n二 */ b', 'js')
  expect(h).toContain('<span class="tk-c">/* 一</span>\n<span class="tk-c">二 */</span>')
  const md = '```js\nconst a = 1\n\nlet b = 2\n```'
  const pdf = toPage(md, { theme: 'paper', width: 'desktop', mode: 'pdf', date: '', lang: 'zh' }).html
  expect(pdf.match(/<span class="ln">/g)?.length).toBe(3)
  const long = toPage(md, { theme: 'paper', width: 'phone', mode: 'long', date: '', lang: 'zh' }).html
  expect(long).not.toContain('class="ln"')
})

test('标题和文件名：跳过代码块，不生成隐藏文件', async () => {
  expect(titleOf('```js\ncode\n```\n\n真正的第一句')).toBe('真正的第一句')
  expect(titleOf('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a  b')
  expect(titleOf('## 标题 **加粗**\n正文')).toBe('标题 加粗')
  expect(safeName('.hidden 开头', 'zh')).toBe('hidden开头')
  expect(safeName('a/b: c?', 'en')).toBe('a-b-c')
  expect(safeName('...', 'zh')).toBe('Claude')
})

test('Word：完整文档外壳，标题进 <title>', async () => {
  const html = toWordHtml('## 周报\n\n- 完成导出', 'zh')
  expect(html).toContain('<title>周报</title>')
  expect(html).toMatch(/<li style="[^"]+">完成导出<\/li>/)
})
