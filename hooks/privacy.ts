// 导出前的隐私检查：本机路径、邮箱、手机号、密钥
import { STR } from './i18n.ts'
import type { FindingKind, Lang } from './i18n.ts'

const RULES: { kind: FindingKind; re: RegExp; mask: (m: string) => string }[] = [
  {
    kind: 'secret',
    re: /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/g,
    mask: m => m.slice(0, 4) + '••••••',
  },
  {
    kind: 'email',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
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
    const n = [...md.matchAll(r.re)].length
    if (n > 0) counts.set(r.kind, n)
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const summary = [...counts.entries()].map(([k, n]) => t.count(t.findings[k], n)).join(t.listSep)
  return { total, summary }
}

export function redact(md: string): string {
  let out = md
  for (const r of RULES) out = out.replace(r.re, r.mask)
  return out
}
