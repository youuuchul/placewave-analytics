// 보고서 값 대조: 화면(빌드 결과)의 보고서 표를 읽고, 같은 마트 파일(public/data)에서 이 스크립트가 따로 계산한 값과 비교한다.
// 하나라도 어긋나면 exit 1. 화면 계산(src/lib/experiments.ts·EvalOps.tsx)과 다른 코드로 다시 세어 대조한다.
//   npm run build && npm run preview      (다른 터미널)
//   npm run check:reports                  NP_BASE 로 주소 변경 가능
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.NP_BASE ?? 'http://127.0.0.1:4173/'
const DATA = new URL('../public/data/', import.meta.url).pathname
const index = JSON.parse(readFileSync(`${DATA}index.json`, 'utf8'))
const search = JSON.parse(readFileSync(`${DATA}${index.files.daily_search}`, 'utf8'))

const pct = (v) => `${(v * 100).toFixed(1)}%`
const sign = (s) => (s.startsWith('-') ? `-${s.slice(1)}` : s === '0.0' || s === '0.00' ? s : `+${s}`)
const pp = (v) => `${sign((v * 100).toFixed(1))}%p`
const ppb = (v) => sign((v * 100).toFixed(1))
const s2 = (v) => sign(v.toFixed(2))
const n0 = (v) => v.toLocaleString('en-US')
const add = (rows, keys) => Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + r[k], 0)]))

// E1 — 랭킹 A/B
const byDay = new Map()
for (const r of search) {
  const z = byDay.get(r.kst_date) ?? { v1: 0, v2: 0 }
  z[r.ranker_version] += r.searches
  byDay.set(r.kst_date, z)
}
const days = [...byDay].filter(([, z]) => Math.min(z.v1, z.v2) >= 0.1 * (z.v1 + z.v2)).map(([d]) => d).sort()
const span = [days[0], days[days.length - 1]]
const K = ['searches', 'zero_result_searches', 'ga_matched_searches', 'matched_result_searches', 'clicked_searches', 'first_click_position_sum', 'first_click_position_sq_sum', 'top3_clicks', 'reformulated_searches', 'search_sessions', 'search_sessions_applied']
const win = search.filter((r) => r.kst_date >= span[0] && r.kst_date <= span[1])
const a = add(win.filter((r) => r.ranker_version === 'v1'), K)
const b = add(win.filter((r) => r.ranker_version === 'v2'), K)
const prop = (x1, n1, x2, n2) => {
  const p1 = x1 / n1, p2 = x2 / n2, se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2)
  return [p1, p2, p2 - p1, p2 - p1 - 1.96 * se, p2 - p1 + 1.96 * se]
}
const mean = (s1, q1, c1, s2_, q2, c2) => {
  const m1 = s1 / c1, m2 = s2_ / c2
  const se = Math.sqrt((q1 - c1 * m1 * m1) / (c1 - 1) / c1 + (q2 - c2 * m2 * m2) / (c2 - 1) / c2)
  return [m1, m2, m2 - m1, m2 - m1 - 1.96 * se, m2 - m1 + 1.96 * se]
}
const row = ([p1, p2, d, lo, hi], f, g, gb = g) => [f(p1), f(p2), `${g(d)} (${gb(lo)} ~ ${gb(hi)})`]
const e1 = {
  Q02: [n0(a.searches), n0(b.searches), '—'],
  Q03: row(prop(a.zero_result_searches, a.searches, b.zero_result_searches, b.searches), pct, pp, ppb),
  Q05: row(mean(a.first_click_position_sum, a.first_click_position_sq_sum, a.clicked_searches, b.first_click_position_sum, b.first_click_position_sq_sum, b.clicked_searches), (v) => v.toFixed(2), s2),
  Q06: row(prop(a.top3_clicks, a.clicked_searches, b.top3_clicks, b.clicked_searches), pct, pp, ppb),
  Q04: row(prop(a.clicked_searches, a.matched_result_searches, b.clicked_searches, b.matched_result_searches), pct, pp, ppb),
  Q12: row(prop(a.clicked_searches, a.ga_matched_searches, b.clicked_searches, b.ga_matched_searches), pct, pp, ppb),
  Q07: row(prop(a.reformulated_searches, a.ga_matched_searches, b.reformulated_searches, b.ga_matched_searches), pct, pp, ppb),
  Q08: row(prop(a.search_sessions_applied, a.search_sessions, b.search_sessions_applied, b.search_sessions), pct, pp, ppb),
}

// X1 — 지침 개정 전·후(마지막 완료 주까지)
const toDate = index.meta.to_date
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)
const ops = index.weekly_eval_ops.filter((r) => addDays(r.week_start, 6) <= toDate)
const OK = ['labels', 'rework_labels', 'handle_seconds', 'gold_labels', 'gold_correct', 'final_labels', 'label_pairs', 'agree_pairs', 'labels_g0', 'labels_g1', 'labels_g2', 'labels_g3']
const g = (v) => add(ops.filter((r) => r.guideline_version === v), OK)
const kap = (t) => {
  const po = t.agree_pairs / t.label_pairs
  const pe = [t.labels_g0, t.labels_g1, t.labels_g2, t.labels_g3].reduce((x, c) => x + (c / t.final_labels) ** 2, 0)
  return (po - pe) / (1 - pe)
}
const x1 = Object.fromEntries(
  ['v1', 'v2'].map((v) => {
    const t = g(v)
    return [v, [n0(t.labels), pct(t.gold_correct / t.gold_labels), pct(t.agree_pairs / t.label_pairs), kap(t).toFixed(2), pct(t.rework_labels / t.labels), `${(t.handle_seconds / t.labels).toFixed(1)}초`]]
  }),
)

// I1 — 회귀 전·중·후 결과 0건 비율
const phase = [['2026-08-29', '2026-08-31'], ['2026-09-01', '2026-09-04'], ['2026-09-05', '2026-09-08']].map(([f, t]) => {
  const rows = search.filter((r) => r.kst_date >= f && r.kst_date <= t)
  const all = add(rows, K), reg = add(rows.filter((r) => r.query_intent === 'region'), K), rest = add(rows.filter((r) => r.query_intent !== 'region'), K)
  return [n0(all.searches), pct(all.zero_result_searches / all.searches), pct(reg.zero_result_searches / reg.searches), pct(rest.zero_result_searches / rest.searches)]
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const read = async (q) => {
  await page.goto(`${BASE}?${q}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.querySelector('[data-pending]'), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(600)
}
const fails = []
let n = 0
const eq = (name, got, want) => {
  n++
  if (got !== want) fails.push(`${name}: 화면 ${JSON.stringify(got)} ≠ 재계산 ${JSON.stringify(want)}`)
}

// D1 — 실패 검색어 발견(평가 착수 전 28일). 검색어별 합 → 20건 이상 ∧ 0건 30% 이상, 편입일은 기간 시작 ~ 끝 + 7일의 첫 eval_dates
const query = JSON.parse(readFileSync(`${DATA}${index.files.daily_query}`, 'utf8'))
const D1_FROM = '2026-03-04'
const D1_TO = '2026-03-31'
const qsum = new Map()
let d1s = 0
let d1z = 0
for (const r of query) {
  if (r.kst_date < D1_FROM || r.kst_date > D1_TO) continue
  d1s += r.searches
  d1z += r.zero_result_searches
  const z = qsum.get(r.query_norm) ?? { s: 0, z: 0, ev: r.eval_dates }
  z.s += r.searches
  z.z += r.zero_result_searches
  qsum.set(r.query_norm, z)
}
const q20 = [...qsum].filter(([, z]) => z.s >= 20)
const qfail = q20.filter(([, z]) => z.z / z.s >= 0.3).sort((a, b) => b[1].z / b[1].s - a[1].z / a[1].s)
const failZero = qfail.reduce((a, [, z]) => a + z.z, 0)
const evalOf = (ev) => (ev ?? '').split(',').find((d) => d && d >= D1_FROM && d <= '2026-04-07') ?? null
const mdOf = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`
const d1sum = [
  n0(d1s),
  pct(d1z / d1s),
  `${q20.length}개`,
  `${qfail.length}개`,
  `${pct(failZero / d1z)} (${n0(failZero)} / ${n0(d1z)})`,
  `${qfail.filter(([, z]) => evalOf(z.ev) === '2026-04-01').length}개`,
]

await read('page=reports&r=search-failures')
const d1tables = await page.$$eval('main table', (ts) =>
  ts.map((t) => [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()))),
)
const d1head = d1tables.find((rows) => rows[0]?.[0] === '검색 수') ?? []
d1sum.forEach((w, i) => eq(`D1 요약[${i}]`, d1head[i]?.[1] ?? '', w))
const d1fail = d1tables.find((rows) => rows.length === qfail.length && rows[0]?.length === 5) ?? []
qfail.forEach(([q, z], i) => {
  const ev = evalOf(z.ev)
  ;[q, n0(z.s), pct(z.z / z.s), ev ? mdOf(ev) : '—'].forEach((w, j) => eq(`D1 실패[${i}][${j}]`, d1fail[i]?.[[0, 2, 3, 4][j]] ?? '', w))
})

await read('page=reports&r=ab-ranker-v2')
for (const [id, want] of Object.entries(e1)) {
  const cells = await page.$$eval(`table[data-report="ab-ranker-v2"] tr[data-metric="${id}"] td`, (tds) => tds.map((td) => td.textContent.trim()))
  want.forEach((w, i) => eq(`E1 ${id}[${i}]`, (cells[i + 1] ?? '').replace(/−/g, '-'), w))
}

await read('page=reports&r=guide-v2')
const x1rows = await page.$$eval('section.card', (cards) => {
  const c = cards.find((el) => el.querySelector('header h2')?.textContent?.startsWith('개정 전 · 후 비교'))
  return c ? [...c.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())) : []
})
;['v1', 'v2'].forEach((v, j) => x1[v].forEach((w, i) => eq(`X1 ${v}[${i}]`, x1rows[i]?.[j + 1] ?? '', w)))

await read('page=reports&r=issue-reindex-0901')
const i1rows = await page.$$eval('main table', (ts) => {
  const t = ts.find((el) => el.querySelector('th')?.textContent === '지표' && el.textContent.includes('회귀 중'))
  return t ? [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())) : []
})
phase.forEach((col, j) => col.forEach((w, i) => eq(`I1 구간${j + 1}[${i}]`, i1rows[i]?.[j + 1] ?? '', w)))

await browser.close()
console.log(`E1 기간 ${span[0]} ~ ${span[1]} · 비교 값 ${n}개 · 불일치 ${fails.length}개`)
for (const f of fails) console.log('  ', f)
process.exit(fails.length ? 1 : 0)
