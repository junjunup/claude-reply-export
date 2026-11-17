// 导出前的隐私检查：本机路径、邮箱、手机号、密钥
import { STR } from './i18n.ts'
import type { FindingKind, Lang } from './i18n.ts'

// 像邮箱但其实是文件名的（icon@2x.png、logo@3x.webp）不算
const FILE_EXT = /\.(?:png|jpe?g|gif|svg|webp|ico|bmp|tiff?|heic|pdf|js|mjs|cjs|ts|tsx|jsx|css|scss|less|json|ya?ml|toml|md|txt|lock|py|rb|go|rs|swift|kt|java|c|h|cc|cpp|hpp|sh|zip|gz|tar|mp3|mp4|mov|wav|woff2?|ttf|otf)$/i

type Rule = { kind: FindingKind; re: RegExp; mask: (m: string) => string; skip?: (m: string) => boolean }

const RULES: Rule[] = [
  {
    kind: 'secret',
    re: /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/g,
    mask: m => m.slice(0, 4) + '••••••',
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
    kind: 'phone',
    re: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    mask: m => m.slice(0, 3) + '••••' + m.slice(7),
  },
  {
    // /Users/<名字>/... 或 /home/<名字>/...：把用户目录换成 ~
    kind: 'path',
    re: /(?:\/Users|\/home)\/[^\s/`'"()<>]+/g,
    mask: () => '~',
  },
]

export type Scan = { total: number; summary: string }

export function scan(md: string, lang: Lang = 'zh'): Scan {
  const t = STR[lang]
  const counts = new Map<FindingKind, number>()
  for (const r of RULES) {
    const n = [...md.matchAll(r.re)].filter(m => !r.skip?.(m[0])).length
    if (n > 0) counts.set(r.kind, n)
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
