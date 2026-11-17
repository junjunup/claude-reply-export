// 界面文字：中文 / English
export type Lang = 'zh' | 'en'
export type LangPref = 'auto' | Lang

export type Kind = 'plain' | 'rich' | 'image' | 'cards' | 'pdf' | 'word' | 'html' | 'md'
export type FindingKind = 'path' | 'email' | 'phone' | 'secret'

type Strings = {
  export: string
  groups: { copy: string; save: string; style: string }
  actions: Record<Kind, { label: string; hint?: string }>
  theme: string
  width: string
  language: string
  langNames: Record<LangPref, string>
  themeNames: Record<'paper' | 'clean' | 'dark', string>
  widthNames: Record<'phone' | 'desktop', string>
  collapse: string
  exporting: (what: string) => string
  privacyAsk: (summary: string) => string
  mask: string
  raw: string
  cancel: string
  failed: (msg: string) => string
  findings: Record<FindingKind, string>
  count: (label: string, n: number) => string
  listSep: string
  needCLT: string
  preparing: string
  compileFailed: string
  noResult: string
  renderFailed: string
  wordFailed: string
  folder: string
  whereLabel: (folder: string) => string
  defaultTitle: string
  footer: string
  done: {
    plain: (n: number) => string
    md: string
    rich: (rtf: boolean) => string
    word: (where: string) => string
    html: (where: string) => string
    image: (style: string, where: string) => string
    cards: (n: number, where: string) => string
    pdf: (pages: number) => string
  }
  plain: {
    h12: (t: string) => string
    h3: (t: string) => string
    indent: string
    colon: string
    link: (text: string, href: string) => string
    image: (alt: string, href: string) => string
    quote: string
  }
}

export const STR: Record<Lang, Strings> = {
  zh: {
    export: '⤓ 导出',
    groups: { copy: '复制到剪贴板', save: '保存为文件', style: '样式' },
    actions: {
      plain: { label: '纯文本', hint: '微信' },
      rich: { label: '富文本', hint: '飞书 · 邮件' },
      image: { label: '长图' },
      md: { label: 'Markdown' },
      cards: { label: '分页卡片', hint: '小红书' },
      pdf: { label: 'PDF' },
      word: { label: 'Word' },
      html: { label: 'HTML' },
    },
    theme: '主题：',
    width: '宽度：',
    language: '语言：',
    langNames: { auto: '跟随系统', zh: '中文', en: 'English' },
    themeNames: { paper: '暖纸', clean: '简白', dark: '深色' },
    widthNames: { phone: '手机', desktop: '电脑' },
    collapse: '收起',
    exporting: w => `⏳ 正在导出：${w}…`,
    privacyAsk: s => `🔒 导出内容里有 ${s}，要先打码吗？`,
    mask: '打码后导出',
    raw: '原样导出',
    cancel: '取消',
    failed: m => `导出失败：${m}`,
    findings: { path: '本机路径', email: '邮箱', phone: '手机号', secret: '疑似密钥' },
    count: (l, n) => `${l} ${n} 处`,
    listSep: '、',
    needCLT: '需要 Xcode 命令行工具：在终端运行 xcode-select --install 后再试',
    preparing: '正在准备渲染组件（只在首次或更新后需要，约 10–30 秒）…',
    compileFailed: '渲染组件编译失败：',
    noResult: '渲染组件没有返回结果：',
    renderFailed: '渲染失败',
    wordFailed: 'Word 转换失败：',
    folder: 'Claude导出',
    whereLabel: f => `下载/${f}`,
    defaultTitle: 'Claude 回复',
    footer: '导出自 Claude',
    done: {
      plain: n => `已复制纯文本（${n} 字），可直接粘贴到微信`,
      md: '已复制 Markdown 原文',
      rich: rtf => (rtf ? '已复制富文本，可粘贴到飞书、邮件、Word' : '已复制（HTML + 纯文本）'),
      word: w => `Word 已保存到 ${w}，文件也已复制，可在微信里直接粘贴发送`,
      html: w => `HTML 已保存到 ${w}`,
      image: (s, w) => `长图已复制到剪贴板（${s}），也保存到了 ${w}`,
      cards: (n, w) => `已生成 ${n} 张 3:4 卡片，保存在 ${w}`,
      pdf: p => `PDF 已保存（${p} 页 A4），文件也已复制，可在微信里直接粘贴发送`,
    },
    plain: {
      h12: t => `【${t}】`,
      h3: t => `▍${t}`,
      indent: '　',
      colon: '：',
      link: (t, h) => `${t}（${h}）`,
      image: (a, h) => `[图片${a ? '：' + a : ''}] ${h}`,
      quote: '｜',
    },
  },
  en: {
    export: '⤓ Export',
    groups: { copy: 'Copy to clipboard', save: 'Save as file', style: 'Style' },
    actions: {
      plain: { label: 'Plain text', hint: 'chat apps' },
      rich: { label: 'Rich text', hint: 'docs · email' },
      image: { label: 'Long image' },
      md: { label: 'Markdown' },
      cards: { label: 'Page cards', hint: 'social posts' },
      pdf: { label: 'PDF' },
      word: { label: 'Word' },
      html: { label: 'HTML' },
    },
    theme: 'Theme: ',
    width: 'Width: ',
    language: 'Language: ',
    langNames: { auto: 'Auto', zh: '中文', en: 'English' },
    themeNames: { paper: 'Warm paper', clean: 'Clean white', dark: 'Dark' },
    widthNames: { phone: 'Phone', desktop: 'Desktop' },
    collapse: 'Collapse',
    exporting: w => `⏳ Exporting: ${w}…`,
    privacyAsk: s => `🔒 This reply contains ${s}. Mask them before exporting?`,
    mask: 'Mask and export',
    raw: 'Export as is',
    cancel: 'Cancel',
    failed: m => `Export failed: ${m}`,
    findings: { path: 'local path', email: 'email address', phone: 'phone number', secret: 'possible secret key' },
    count: (l, n) => `${n} ${l}${n > 1 ? (l.endsWith('s') ? 'es' : 's') : ''}`,
    listSep: ', ',
    needCLT: 'Xcode Command Line Tools are required. Run xcode-select --install in a terminal, then try again.',
    preparing: 'Preparing the renderer (first use or after an update only, about 10–30 seconds)…',
    compileFailed: "Couldn't build the renderer: ",
    noResult: 'The renderer returned no result: ',
    renderFailed: 'Rendering failed',
    wordFailed: "Couldn't convert to Word: ",
    folder: 'Claude Exports',
    whereLabel: f => `Downloads/${f}`,
    defaultTitle: 'Claude reply',
    footer: 'Exported from Claude',
    done: {
      plain: n => `Plain text copied (${n} characters)`,
      md: 'Markdown copied',
      rich: rtf => (rtf ? 'Rich text copied. Paste it into docs, email, or Word.' : 'Copied (HTML and plain text)'),
      word: w => `Word file saved to ${w} and copied, so you can paste it into a chat`,
      html: w => `HTML saved to ${w}`,
      image: (s, w) => `Long image copied (${s}) and saved to ${w}`,
      cards: (n, w) => `${n} cards (3:4) saved to ${w}`,
      pdf: p => `PDF saved (${p} A4 page${p > 1 ? 's' : ''}) and copied, so you can paste it into a chat`,
    },
    plain: {
      h12: t => `■ ${t}`,
      h3: t => `▸ ${t}`,
      indent: '  ',
      colon: ': ',
      link: (t, h) => `${t} (${h})`,
      image: (a, h) => `[Image${a ? ': ' + a : ''}] ${h}`,
      quote: '│ ',
    },
  },
}

/** 从 macOS 首选语言（`defaults read -g AppleLanguages` 的输出）判断 */
export function langFromSystem(appleLanguages: string): Lang {
  const first = appleLanguages.match(/"?([A-Za-z]{2,3})(?:[-_][^",\s)]*)?"?/)?.[1]?.toLowerCase()
  return first === undefined || first === 'zh' ? 'zh' : 'en'
}
