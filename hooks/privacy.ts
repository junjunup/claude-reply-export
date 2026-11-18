// 导出前的隐私检查：本机路径、邮箱、手机号、密钥
import { STR } from './i18n.ts'
import type { FindingKind, Lang } from './i18n.ts'

// 像邮箱但其实是文件名的（icon@2x.png、logo@3x.webp）不算
const FILE_EXT = /\.(?:png|jpe?g|gif|svg|webp|ico|bmp|tiff?|heic|pdf|js|mjs|cjs|ts|tsx|jsx|css|scss|less|json|ya?ml|toml|md|txt|lock|py|rb|go|rs|swift|kt|java|c|h|cc|cpp|hpp|sh|zip|gz|tar|mp3|mp4|mov|wav|woff2?|ttf|otf)$/i

type Rule = { kind: FindingKind; re: RegExp; mask: (m: string) => string; skip?: (m: string) => boolean }

// 像 password=xxx 的赋值：值里要有数字，或者足够长，才算；排除类型名和变量引用
const ASSIGN_WORDS = 'password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key'
const NOT_A_VALUE = /^(?:string|number|boolean|null|undefined|true|false|none|process\.|os\.|env\b|self\.|this\.)/i
const looksLikeValue = (v: string) => !v.includes('•') && !NOT_A_VALUE.test(v) && !/^[$<{(]/.test(v) && (/\d/.test(v) ? v.length >= 6 : v.length >= 16)

// 规则按顺序检查和打码：前面的规则打过码，后面的就不会再算一次
const RULES: Rule[] = [
  {
    // 私钥整段
    kind: 'secret',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    mask: () => '-----BEGIN PRIVATE KEY----- •••••• -----END PRIVATE KEY-----',
  },
  {
    // 网址里的账号密码：https://user:pass@host
    kind: 'secret',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi,
    mask: m => m.replace(/:([^:@]+)@$/, ':••••••@'),
  },
  {
    kind: 'secret',
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
    mask: () => 'Bearer ••••••',
  },
  {
    // JWT
    kind: 'secret',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    mask: m => m.slice(0, 4) + '••••••',
  },
  {
    kind: 'secret',
    re: /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|gh[ousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/g,
    mask: m => m.slice(0, 4) + '••••••',
  },
  {
    kind: 'secret',
    re: new RegExp(`\\b(?:${ASSIGN_WORDS})\\s*[:=]\\s*["']?([^\\s"'\`,;]+)`, 'gi'),
    skip: m => {
      const v = m.replace(new RegExp(`^(?:${ASSIGN_WORDS})\\s*[:=]\\s*["']?`, 'i'), '')
      return !looksLikeValue(v)
    },
    mask: m => m.replace(new RegExp(`^((?:${ASSIGN_WORDS})\\s*[:=]\\s*["']?).*$`, 'i'), '$1••••••'),
  },
  {
    kind: 'email',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    skip: m => FILE_EXT.test(m) || /@\d+(?:\.\d+)?x\./i.test(m),
    mask: m => {
      const [user = '', domain = ''] = m.split('@')
      return `${user.slice(0, 1)}•••@${domain}`
    },
  },
  {
    // 中国大陆手机号，允许 +86 和空格、横线分隔
    kind: 'phone',
    re: /(?<![\d+])(?:\+?86[\s-]?)?1[3-9]\d(?:[\s-]?\d{4}){2}(?!\d)/g,
    mask: m => {
      const d = m.replace(/\D/g, '').slice(-11)
      const prefix = /^\+?86/.test(m) && m.replace(/\D/g, '').length > 11 ? '+86 ' : ''
      return `${prefix}${d.slice(0, 3)}••••${d.slice(7)}`
    },
  },
  {
    // IPv4；本机回环、0.0.0.0 和看起来像版本号的不算
    kind: 'ip',
    re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g,
    skip: m => /^(?:127\.|0\.0\.0\.0$)/.test(m) || m.split('.').every(x => Number(x) < 10),
    mask: m => m.split('.').slice(0, 2).join('.') + '.•.•',
  },
  {
    // /Users/<名字>/... 或 /home/<名字>/...：把用户目录换成 ~
    kind: 'path',
    re: /(?:\/Users|\/home)\/[^\s/`'"()<>]+/g,
    skip: m => /^\/Users\/Shared$/.test(m),
    mask: () => '~',
  },
  {
    // Windows：C:\Users\<名字>
    kind: 'path',
    re: /\b[A-Za-z]:\\Users\\[^\s\\`'"()<>]+/g,
    mask: () => '~',
  },
]

export type Scan = { total: number; summary: string }

export function scan(md: string, lang: Lang = 'zh'): Scan {
  const t = STR[lang]
  const counts = new Map<FindingKind, number>()
  let rest = md
  for (const r of RULES) {
    const n = [...rest.matchAll(r.re)].filter(m => !r.skip?.(m[0])).length
    if (n > 0) counts.set(r.kind, (counts.get(r.kind) ?? 0) + n)
    rest = rest.replace(r.re, m => (r.skip?.(m) ? m : r.mask(m)))
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const summary = [...counts.entries()].map(([k, n]) => t.count(t.findings[k], n)).join(t.listSep)
  return { total, summary }
}

export function redact(md: string): string {
  let out = md
  for (const r of RULES) out = out.replace(r.re, m => (r.skip?.(m) ? m : r.mask(m)))
  return out
}
