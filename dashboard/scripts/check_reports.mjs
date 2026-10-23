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

// 양측 p = erfc(|z|/√2). 화면(A–S 7.1.26)과 다른 근사(Numerical Recipes erfcc, 체비쇼프)로 다시 센다
const erfc = (x) => {
  const t = 1 / (1 + 0.5 * Math.abs(x))
  const r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
  return x >= 0 ? r : 2 - r
}
const pOf = (z) => erfc(Math.abs(z) / Math.SQRT2)
const pText = (p) => (p < 0.001 ? '< 0.001' : p.toFixed(3))
const K = ['searches', 'zero_result_searches']

// E1 — 랭킹 A/B 결과 보고. 요청 단위 실험 마트 → 기기별 분자·분모 합 → 델타 방법 분산(화면 lib/experiments.ts 와 따로 구현)
const exp = JSON.parse(readFileSync(`${DATA}${index.files.exp_ranker_request}`, 'utf8'))
const RUN = ['2026-07-13', '2026-07-26']
const run = exp.filter((r) => r.kst_date >= RUN[0] && r.kst_date <= RUN[1])
const b01 = (v) => (v ? 1 : 0)
const pct2 = (v) => `${(v * 100).toFixed(2)}%`
const MET = {
  success: { num: (r) => b01(r.is_clicked), den: () => 1, f: pct, d: pp, bd: ppb },
  zero: { num: (r) => b01(r.is_zero_result), den: () => 1, f: pct, d: pp, bd: ppb },
  pos: { num: (r) => (r.is_clicked ? r.first_click_position : 0), den: (r) => b01(r.is_clicked), f: (v) => v.toFixed(2), d: s2, bd: s2 },
  top3: { num: (r) => b01(r.is_clicked && r.first_click_position <= 3), den: (r) => b01(r.is_clicked), f: pct, d: pp, bd: ppb },
  reform: { num: (r) => b01(r.is_reformulated), den: () => 1, f: pct, d: pp, bd: ppb },
  ctr: { num: (r) => b01(r.is_clicked), den: (r) => b01(!r.is_zero_result), f: pct, d: pp, bd: ppb },
  apply: {
    num: (r) => b01(r.session_applied),
    den: (r) => b01(r.is_session_first),
    f: pct2,
    d: (v) => `${sign((v * 100).toFixed(2))}%p`,
    bd: (v) => sign((v * 100).toFixed(2)),
  },
}
const est = (rows, m) => {
  const dev = {}
  for (const r of rows) {
    const n = m.den(r)
    if (!n) continue
    dev[r.client_id] = dev[r.client_id] ?? [0, 0]
    dev[r.client_id][0] += m.num(r)
    dev[r.client_id][1] += n
  }
  const pairs = Object.values(dev)
  const k = pairs.length
  const Y = pairs.reduce((a, x) => a + x[0], 0)
  const N = pairs.reduce((a, x) => a + x[1], 0)
  const R = Y / N
  const ybar = Y / k
  const nbar = N / k
  const cov = (f, g) => pairs.reduce((a, x) => a + (f(x) - (f === fy ? ybar : nbar)) * (g(x) - (g === fy ? ybar : nbar)), 0) / (k - 1)
  const fy = (x) => x[0]
  const fn = (x) => x[1]
  return { R, v: (cov(fy, fy) - 2 * R * cov(fy, fn) + R * R * cov(fn, fn)) / (k * nbar * nbar) }
}
const e1 = {}
for (const [id, m] of Object.entries(MET)) {
  const c = est(run.filter((r) => r.arm === 'control'), m)
  const t = est(run.filter((r) => r.arm === 'treatment'), m)
  const d = t.R - c.R
  const se = Math.sqrt(c.v + t.v)
  e1[id] = { cells: [m.f(c.R), m.f(t.R), `${m.d(d)} (${m.bd(d - 1.96 * se)} ~ ${m.bd(d + 1.96 * se)})`], p: pOf(d / se) }
}
const SEC = ['zero', 'pos', 'top3', 'reform']
const order = SEC.map((k) => [e1[k].p, k]).sort((x, y) => x[0] - y[0])
let acc = 0
order.forEach(([p0, k], rank) => {
  acc = Math.max(acc, Math.min(1, p0 * (SEC.length - rank)))
  e1[k].holm = acc
})
const q95 = (arm) => {
  const xs = run.filter((r) => r.arm === arm).map((r) => r.latency_ms).sort((x, y) => x - y)
  const h = (xs.length - 1) * 0.95
  const lo = Math.floor(h)
  return `${(xs[lo] + (xs[Math.min(lo + 1, xs.length - 1)] - xs[lo]) * (h - lo)).toFixed(0)}ms`
}
e1.p95 = { cells: [q95('control'), q95('treatment')] }

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
const KC = [...K, 'clicked_searches']
const phase = [['2026-08-29', '2026-08-31'], ['2026-09-01', '2026-09-04'], ['2026-09-05', '2026-09-08']].map(([f, t]) => {
  const rows = search.filter((r) => r.kst_date >= f && r.kst_date <= t)
  const all = add(rows, KC), reg = add(rows.filter((r) => r.query_intent === 'region'), KC), rest = add(rows.filter((r) => r.query_intent !== 'region'), KC)
  return [
    n0(all.searches),
    pct(all.zero_result_searches / all.searches),
    pct(reg.zero_result_searches / reg.searches),
    pct(rest.zero_result_searches / rest.searches),
    pct(all.clicked_searches / all.searches),
    pct(reg.clicked_searches / reg.searches),
  ]
})

// E1 설계서 — 기준선 6/22~7/5(전부 v1): 기기·요청·세션, 지표별 기준선, 최소 검출 효과 = 2 × 2.801585 × √(기준선 분산)
const BASE_SPAN = ['2026-06-22', '2026-07-05']
const baseRows = exp.filter((r) => r.kst_date >= BASE_SPAN[0] && r.kst_date <= BASE_SPAN[1])
const baseDev = new Set(baseRows.map((r) => r.client_id)).size
const baseEst = Object.fromEntries(Object.entries(MET).map(([id, m]) => [id, est(baseRows, m)]))
const mdeTxt = (id, d = 1) => `±${(2 * 2.801585 * Math.sqrt(baseEst[id].v) * 100).toFixed(d)}%p`
const qOf = (rows) => {
  const xs = rows.map((r) => r.latency_ms).sort((x, y) => x - y)
  const h = (xs.length - 1) * 0.95
  const lo = Math.floor(h)
  return `${(xs[lo] + (xs[Math.min(lo + 1, xs.length - 1)] - xs[lo]) * (h - lo)).toFixed(0)}ms`
}
const design = {
  base: { 검색: MET.success.f(baseEst.success.R), '결과 0건': MET.zero.f(baseEst.zero.R), '평균 첫': MET.pos.f(baseEst.pos.R), '상위 3위': MET.top3.f(baseEst.top3.R), 재검색률: MET.reform.f(baseEst.reform.R), '결과 클릭률': MET.ctr.f(baseEst.ctr.R), '검색 세션 신청 전환': MET.apply.f(baseEst.apply.R), '응답 시간 p95': qOf(baseRows) },
  sample: [
    ['검색한 기기', `${n0(baseDev)}대 (2주 실험이면 집단당 약 ${n0(Math.round(baseDev / 2))}대)`],
    ['검색 요청 · 검색 세션', `${n0(baseRows.length)}건 · ${n0(baseRows.filter((r) => r.is_session_first).length)}세션`],
    ['검색 성공률 기준선', MET.success.f(baseEst.success.R)],
    ['최소 검출 효과 · 검색 성공률', mdeTxt('success')],
    ['최소 검출 효과 · 결과 클릭률', mdeTxt('ctr')],
    ['최소 검출 효과 · 검색 세션 신청 전환', mdeTxt('apply', 2)],
  ],
}

// E1 진행 점검 — 첫 주 7/13~7/19 배정(기기 수·카이제곱 p), 실험 전 6/29~7/12 A/A, 첫 주 가드레일(비율 2개)
const inS = (f, t) => exp.filter((r) => r.kst_date >= f && r.kst_date <= t)
const wk1 = inS('2026-07-13', '2026-07-19')
const pre = inS('2026-06-29', '2026-07-12')
const devOf = (rows, arm) => new Set(rows.filter((r) => r.arm === arm).map((r) => r.client_id)).size
const nc = devOf(wk1, 'control'), nt = devOf(wk1, 'treatment')
const cmp = (rows, m) => {
  const c = est(rows.filter((r) => r.arm === 'control'), m)
  const t = est(rows.filter((r) => r.arm === 'treatment'), m)
  const d = t.R - c.R
  const se = Math.sqrt(c.v + t.v)
  return [m.f(c.R), m.f(t.R), `${m.d(d)} (${m.bd(d - 1.96 * se)} ~ ${m.bd(d + 1.96 * se)})`, pText(pOf(d / se))]
}
const check = {
  assign: [n0(nc), n0(nt), pText(pOf(Math.sqrt((nc - nt) ** 2 / (nc + nt))))],
  aa: { '검색 성공률': cmp(pre, MET.success), '결과 0건 비율': cmp(pre, MET.zero), '평균 첫 클릭 순위': cmp(pre, MET.pos), '결과 클릭률': cmp(pre, MET.ctr), '검색 세션 신청 전환': cmp(pre, MET.apply) },
  guard: { '결과 클릭률': cmp(wk1, MET.ctr).slice(0, 3), '검색 세션 신청 전환': cmp(wk1, MET.apply).slice(0, 3) },
}

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
  const cells = (await page.$$eval(`table[data-report="ab-ranker-v2"] tr[data-metric="${id}"] td`, (tds) => tds.map((td) => td.textContent.trim()))).map((x) =>
    x.replace(/−/g, '-'),
  )
  want.cells.forEach((w, i) => eq(`E1 ${id}[${i}]`, cells[i + 2] ?? '', w))
  if (want.p != null) eq(`E1 ${id} p`, cells[5] ?? '', pText(want.p))
  if (want.holm != null) eq(`E1 ${id} Holm`, cells[6] ?? '', pText(want.holm))
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

const rowsOf = async () =>
  (await page.$$eval('main table tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())))).map((r) =>
    r.map((x) => x.replace(/−/g, '-')),
  )
const find = (rows, head, col = 0) => rows.find((r) => r[col]?.startsWith(head)) ?? []

await read('page=reports&r=ab-ranker-design')
const dRows = await rowsOf()
for (const [head, want] of Object.entries(design.base)) eq(`설계서 기준선 ${head}`, find(dRows, head, 1)[3] ?? '', want)
for (const [head, want] of design.sample) eq(`설계서 표본 ${head}`, find(dRows, head)[1] ?? '', want)

await read('page=reports&r=ab-ranker-check')
const cRows = await rowsOf()
const dev = find(cRows, '검색한 기기')
eq('진행 점검 대조군 기기', dev[1] ?? '', check.assign[0])
eq('진행 점검 실험군 기기', dev[2] ?? '', check.assign[1])
eq('진행 점검 SRM p', (dev[3] ?? '').match(/p ([<\d. ]+?) →/)?.[1] ?? '', check.assign[2])
for (const [head, want] of Object.entries(check.aa)) {
  const r = cRows.find((x) => x[0] === head && x.length === 5) ?? []
  want.forEach((w, i) => eq(`진행 점검 A/A ${head}[${i}]`, r[i + 1] ?? '', w))
}
for (const [head, want] of Object.entries(check.guard)) {
  const r = cRows.find((x) => x[0] === head && x.length === 6) ?? []
  want.forEach((w, i) => eq(`진행 점검 가드레일 ${head}[${i}]`, r[i + 1] ?? '', w))
}

// M1 — 순위 모델 오프라인 평가. 기준선 검색어 마트 합계와, 쌍 마트에서 검색어별로 다시 센 NDCG@10(화면 reports/M1.tsx 와 따로 구현)
const rq = index.ranker_query_eval ?? []
const rqSum = (f) => rq.filter(f).reduce((a, r) => [a[0] + r.requests, a[1] + r.zero_results], [0, 0])
const [mReq, mZero] = rqSum(() => true)
const [mLeft] = rqSum((r) => r.query_intent === 'other')
const [, mLinked] = rqSum((r) => r.query_intent !== 'other')
const m1sum = [
  [n0(mReq), n0(mReq)],
  [`${n0(mZero)} (${pct(mZero / mReq)})`, `${n0(mLeft)} (${pct(mLeft / mReq)})`],
  ['—', `${n0(mLinked)} (${pct(mLinked / mZero)})`],
]
const rk = JSON.parse(readFileSync(`${DATA}${index.files.ranker_eval}`, 'utf8'))
const byQ = new Map()
for (const r of rk) byQ.set(r.query_norm, [...(byQ.get(r.query_norm) ?? []), r])
const gainAt = (labels) => {
  let v = 0
  for (let i = 0; i < Math.min(10, labels.length); i++) v += (Math.pow(2, labels[i]) - 1) / (Math.log(i + 2) / Math.LN2)
  return v
}
const nd = { all: [[], []], venue_name: [[], []], region: [[], []], genre: [[], []], event_type: [[], []] }
for (const rows of byQ.values()) {
  const ideal = gainAt(rows.map((r) => r.label).sort((a, b) => b - a))
  if (!ideal) continue
  ;['rank_popularity', 'rank_model'].forEach((key, j) => {
    const shown = rows.filter((r) => r[key] !== null).sort((a, b) => a[key] - b[key])
    const v = shown.length ? gainAt(shown.map((r) => r.label)) / ideal : 0
    nd.all[j].push(v)
    nd[rows[0].query_intent]?.[j].push(v)
  })
}
const avgOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const f3 = (v) => v.toFixed(3)
const m1nd = Object.entries(nd).map(([k, [p, m]]) => [k, [n0(p.length), f3(avgOf(p)), f3(avgOf(m)), sign(f3(avgOf(m) - avgOf(p)))]])

await read('page=reports&r=ranker-model')
const cardRows = (title) =>
  page.$$eval(
    'section.card',
    (cards, t) => {
      const c = cards.find((el) => el.querySelector('header h2')?.textContent?.startsWith(t))
      return c ? [...c.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())) : []
    },
    title,
  )
const m1a = await cardRows('① 검색어 해석')
m1sum.forEach((want, i) => want.forEach((w, j) => eq(`M1 해석[${i}][${j}]`, m1a[i]?.[j + 1] ?? '', w)))
const m1b = (await cardRows('② 순위 모델')).map((r) => r.map((x) => x.replace(/−/g, '-')))
m1nd.forEach(([k, want], i) => want.forEach((w, j) => eq(`M1 NDCG ${k}[${j}]`, m1b[i]?.[j + 1] ?? '', w)))

await browser.close()
console.log(`보고서 D1 · M1 · E1 설계서 · 진행 점검 · 결과 보고 · X1 · I1 · 비교 값 ${n}개 · 불일치 ${fails.length}개`)
for (const f of fails) console.log('  ', f)
process.exit(fails.length ? 1 : 0)
