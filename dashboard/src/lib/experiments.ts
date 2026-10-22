import { addDays } from './date'
import { ratio } from './format'
import type { DailyQuery, DailySearch, ExpRankerRequest } from './types'

/** 검색 일 마트를 더할 때 쓰는 열. 검색 지표는 모두 서버 요청 기준이다. */
export const SEARCH_KEYS = [
  'searches',
  'zero_result_searches',
  'result_searches',
  'clicked_searches',
  'first_click_position_sum',
  'first_click_position_sq_sum',
  'top3_clicks',
  'reformulated_searches',
  'search_sessions',
  'search_sessions_applied',
  'latency_ms_sum',
] as const satisfies readonly (keyof DailySearch)[]
export type SearchKey = (typeof SEARCH_KEYS)[number]
export type SearchSums = Record<SearchKey, number>
export const ZERO_SUMS = Object.fromEntries(SEARCH_KEYS.map((k) => [k, 0])) as SearchSums

/** 검색 성공률 = 결과를 1번 이상 클릭한 검색 ÷ 전체 검색 = (1 − 0건 비율) × 결과 클릭률 */
export const success = (t: SearchSums) => ratio(t.clicked_searches, t.searches)
export const zeroRate = (t: SearchSums) => ratio(t.zero_result_searches, t.searches)
export const ctr = (t: SearchSums) => ratio(t.clicked_searches, t.result_searches)
export const avgPos = (t: SearchSums) => ratio(t.first_click_position_sum, t.clicked_searches)
export const top3 = (t: SearchSums) => ratio(t.top3_clicks, t.clicked_searches)
export const reform = (t: SearchSums) => ratio(t.reformulated_searches, t.searches)
export const applyRate = (t: SearchSums) => ratio(t.search_sessions_applied, t.search_sessions)

/** 랭킹 A/B 시나리오 일정(세션 시작일 기준). 설계서에 정한 날짜를 그대로 쓴다. */
export const AB = {
  baseline: ['2026-06-22', '2026-07-05'] as const,
  pre: ['2026-06-29', '2026-07-12'] as const,
  firstWeek: ['2026-07-13', '2026-07-19'] as const,
  run: ['2026-07-13', '2026-07-26'] as const,
  v2All: '2026-07-27',
}

export interface Ci {
  d: number
  lo: number
  hi: number
  /** 양측 p값(같은 정규 근사, z = d ÷ 표준오차) */
  p: number
}

/** 양측 p값 = erfc(|z| ÷ √2). Abramowitz–Stegun 7.1.26 근사(오차 1.5e-7). */
export function pTwo(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x)
}

/** p값 표기: 0.001 미만은 부등호, 아니면 소수 셋째 자리. */
export const fmtP = (p: number) => (p < 0.001 ? '< 0.001' : p.toFixed(3))

/** 두 비율의 차이(뒤 − 앞)와 95% 구간. 요청 하나하나를 독립으로 보는 단순 검정(정규 근사). */
export function diffCi(x1: number, n1: number, x2: number, n2: number): Ci | null {
  if (!n1 || !n2) return null
  const p1 = x1 / n1
  const p2 = x2 / n2
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2)
  const d = p2 - p1
  return { d, lo: d - 1.96 * se, hi: d + 1.96 * se, p: se > 0 ? pTwo(d / se) : 1 }
}

export type Verdict = '개선' | '악화' | '차이 없음'

/** 95% 구간이 0을 포함하면 차이 없음, 아니면 지표 방향(down = 낮을수록 좋음)에 따라 개선·악화. */
export function verdict(ci: Ci, down = false): Verdict {
  if (ci.lo <= 0 && ci.hi >= 0) return '차이 없음'
  return (down ? ci.hi < 0 : ci.lo > 0) ? '개선' : '악화'
}

const sign = (s: string) => (s.startsWith('-') ? `−${s.slice(1)}` : s === '0.0' || s === '0.00' ? s : `+${s}`)
/** 비율 차이 %p(부호·− 기호). */
export const pp = (v: number) => `${sign((v * 100).toFixed(1))}%p`
/** 구간 끝값(단위 없이). */
export const ppBound = (v: number) => sign((v * 100).toFixed(1))
export const signed2 = (v: number) => sign(v.toFixed(2))
export const signedMs = (v: number) => `${sign(v.toFixed(0))}ms`

// ---------- 실험 분석 (요청 단위 마트 → 기기 단위 클러스터) ----------

export type Arm = 'control' | 'treatment'
export const ARM_LABEL: Record<Arm, string> = { control: '대조군', treatment: '실험군' }

export const inSpan = (rows: ExpRankerRequest[], [from, to]: readonly [string, string]) =>
  rows.filter((r) => r.kst_date >= from && r.kst_date <= to)

/** 비율 지표 정의: 요청(또는 세션)마다 분자·분모 기여값. 분모가 0인 행은 그 지표에서 빠진다. */
export interface RatioMetric {
  id: string
  label: string
  num: (r: ExpRankerRequest) => number
  den: (r: ExpRankerRequest) => number
  /** 표시 형식 */
  fmt: (v: number) => string
  /** 차이 표시 형식과 구간 끝값 형식 */
  diff: (v: number) => string
  bound: (v: number) => string
  /** 낮을수록 좋은 지표 */
  down?: boolean
}

export interface RatioEstimate {
  value: number
  /** 델타 방법 분산 (기기 단위 클러스터) */
  variance: number
  devices: number
  num: number
  den: number
}

/**
 * 기기 단위 클러스터를 반영한 비율 추정(델타 방법). R = Σy ÷ Σn, Var(R) = (s²_y − 2R·s_yn + R²·s²_n) ÷ (K · n̄²).
 * y·n 은 기기별 분자·분모 합, K 는 분모가 있는 기기 수.
 */
export function ratioEstimate(rows: ExpRankerRequest[], m: RatioMetric): RatioEstimate | null {
  const by = new Map<string, [number, number]>()
  for (const r of rows) {
    const n = m.den(r)
    if (!n) continue
    const z = by.get(r.client_id) ?? [0, 0]
    z[0] += m.num(r)
    z[1] += n
    by.set(r.client_id, z)
  }
  const k = by.size
  if (k < 2) return null
  let sy = 0
  let sn = 0
  for (const [y, n] of by.values()) {
    sy += y
    sn += n
  }
  const R = sy / sn
  const my = sy / k
  const mn = sn / k
  let vyy = 0
  let vnn = 0
  let vyn = 0
  for (const [y, n] of by.values()) {
    vyy += (y - my) ** 2
    vnn += (n - mn) ** 2
    vyn += (y - my) * (n - mn)
  }
  vyy /= k - 1
  vnn /= k - 1
  vyn /= k - 1
  return { value: R, variance: (vyy - 2 * R * vyn + R * R * vnn) / (k * mn * mn), devices: k, num: sy, den: sn }
}

/** 두 집단 차이(실험군 − 대조군)와 95% 구간·p값. 기기 단위 델타 방법. */
export function deltaDiff(c: RatioEstimate, t: RatioEstimate): Ci {
  const d = t.value - c.value
  const se = Math.sqrt(c.variance + t.variance)
  return { d, lo: d - 1.96 * se, hi: d + 1.96 * se, p: se > 0 ? pTwo(d / se) : 1 }
}

/** 같은 지표를 요청 하나하나를 독립으로 본 단순 검정(분자가 0/1 인 비율 지표만). */
export function naiveDiff(c: RatioEstimate, t: RatioEstimate): Ci | null {
  return diffCi(c.num, c.den, t.num, t.den)
}

/** Holm 보정 p값(같은 순서로 돌려준다). */
export function holm(ps: number[]): number[] {
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(ps.length)
  let run = 0
  order.forEach(([p, i], rank) => {
    run = Math.max(run, Math.min(1, p * (ps.length - rank)))
    out[i] = run
  })
  return out
}

/** 표본 비율 불일치(SRM): 50:50 기대에 대한 카이제곱 적합도(자유도 1). */
export function srm(nc: number, nt: number): { chi2: number; p: number; share: number } {
  const n = nc + nt
  const chi2 = n ? (nc - nt) ** 2 / n : 0
  return { chi2, p: pTwo(Math.sqrt(chi2)), share: n ? nc / n : 0 }
}

/** 고정 시드 난수(mulberry32). 부트스트랩이 매번 같은 값을 내게 한다. */
export function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 분위수(선형 보간, 정렬된 배열). */
export function quantileSorted(xs: number[], q: number): number {
  if (!xs.length) return NaN
  const h = (xs.length - 1) * q
  const lo = Math.floor(h)
  return xs[lo] + (xs[Math.min(lo + 1, xs.length - 1)] - xs[lo]) * (h - lo)
}

/**
 * 응답 시간 p95 차이(실험군 − 대조군)와 95% 구간. 기기 단위 부트스트랩(기기를 복원 추출, 2,000회, 고정 시드).
 * p값은 부트스트랩 분포에서 0 반대쪽 비중 × 2.
 */
export function p95Diff(rows: ExpRankerRequest[], reps = 2000): { c: number; t: number; ci: Ci } {
  const byArm = (arm: Arm) => {
    const m = new Map<string, number[]>()
    for (const r of rows) if (r.arm === arm) m.set(r.client_id, [...(m.get(r.client_id) ?? []), r.latency_ms])
    return [...m.values()]
  }
  const p95 = (groups: number[][]) => quantileSorted(groups.flat().sort((a, b) => a - b), 0.95)
  const gc = byArm('control')
  const gt = byArm('treatment')
  const c = p95(gc)
  const t = p95(gt)
  const rnd = seeded(20260706)
  const pick = (g: number[][]) => Array.from({ length: g.length }, () => g[Math.floor(rnd() * g.length)])
  const ds: number[] = []
  for (let i = 0; i < reps; i++) ds.push(p95(pick(gt)) - p95(pick(gc)))
  ds.sort((x, y) => x - y)
  const below = ds.filter((x) => x <= 0).length / reps
  return {
    c,
    t,
    ci: { d: t - c, lo: quantileSorted(ds, 0.025), hi: quantileSorted(ds, 0.975), p: Math.min(1, 2 * Math.min(below, 1 - below)) },
  }
}

const bit = (v: boolean) => (v ? 1 : 0)
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`

/** 실험 지표. 요청 단위 지표는 검색 요청이, 세션 지표는 세션 첫 검색 행이 분모다. */
export const EXP_METRICS = {
  success: { id: 'success', label: '검색 성공률', num: (r) => bit(r.is_clicked), den: () => 1, fmt: pct1, diff: pp, bound: ppBound },
  zero: { id: 'zero', label: '결과 0건 비율', num: (r) => bit(r.is_zero_result), den: () => 1, fmt: pct1, diff: pp, bound: ppBound, down: true },
  pos: {
    id: 'pos',
    label: '평균 첫 클릭 순위',
    num: (r) => (r.is_clicked ? (r.first_click_position ?? 0) : 0),
    den: (r) => bit(r.is_clicked),
    fmt: (v) => v.toFixed(2),
    diff: signed2,
    bound: signed2,
    down: true,
  },
  top3: {
    id: 'top3',
    label: '상위 3위 클릭 비중',
    num: (r) => bit(r.is_clicked && (r.first_click_position ?? 99) <= 3),
    den: (r) => bit(r.is_clicked),
    fmt: pct1,
    diff: pp,
    bound: ppBound,
  },
  reform: { id: 'reform', label: '재검색률', num: (r) => bit(r.is_reformulated), den: () => 1, fmt: pct1, diff: pp, bound: ppBound, down: true },
  ctr: { id: 'ctr', label: '결과 클릭률', num: (r) => bit(r.is_clicked), den: (r) => bit(!r.is_zero_result), fmt: pct1, diff: pp, bound: ppBound },
  apply: {
    id: 'apply',
    label: '검색 세션 신청 전환',
    num: (r) => bit(r.session_applied),
    den: (r) => bit(r.is_session_first),
    fmt: (v) => `${(v * 100).toFixed(2)}%`,
    diff: (v) => `${sign((v * 100).toFixed(2))}%p`,
    bound: (v) => sign((v * 100).toFixed(2)),
  },
} satisfies Record<string, RatioMetric>

export interface ArmCompare {
  metric: RatioMetric
  c: RatioEstimate
  t: RatioEstimate
  ci: Ci
  naive: Ci | null
}

export function compareArms(rows: ExpRankerRequest[], m: RatioMetric): ArmCompare | null {
  const c = ratioEstimate(
    rows.filter((r) => r.arm === 'control'),
    m,
  )
  const t = ratioEstimate(
    rows.filter((r) => r.arm === 'treatment'),
    m,
  )
  if (!c || !t) return null
  return { metric: m, c, t, ci: deltaDiff(c, t), naive: m.id === 'pos' ? null : naiveDiff(c, t) }
}

/** 기기 수(배정 단위). 기간 안에 검색한 기기만 센다. */
export function armDevices(rows: ExpRankerRequest[]): Record<Arm, number> {
  const s: Record<Arm, Set<string>> = { control: new Set(), treatment: new Set() }
  for (const r of rows) s[r.arm].add(r.client_id)
  return { control: s.control.size, treatment: s.treatment.size }
}

/**
 * 최소 검출 효과(양측 α 0.05, 검정력 0.8). 기준선 기간의 기기 단위 분산으로 실험(집단당 기기 수 = 기준선 기기 수 × scale ÷ 2)을 예측한다.
 */
export function mde(base: RatioEstimate, scale: number): number {
  const perArm = (base.devices * scale) / 2
  const v = (base.variance * base.devices) / perArm
  return (1.959964 + 0.841621) * Math.sqrt(2 * v)
}

// ---------- 검색어 ----------

export const FAILED_MIN = 20
export const FAILED_ZERO = 0.3

export interface QueryStat {
  q: DailyQuery
  searches: number
  zero: number
  result: number
  clicked: number
  reform: number
  failed: boolean
  /** 기간 시작 ~ 끝 + 7일 안에 검색팀 배치에 편입된 첫 날 */
  evalDate: string | null
}

/** 기간 안 검색 20건 이상 검색어의 합계와 실패 여부(0건 비율 30% 이상)·평가 편입일. 검색 탭과 보고서가 같이 쓴다. */
export function queryStats(rows: DailyQuery[], from: string, to: string, keep: (r: DailyQuery) => boolean = () => true): QueryStat[] {
  const m = new Map<string, Omit<QueryStat, 'failed' | 'evalDate'>>()
  for (const r of rows) {
    if (r.kst_date < from || r.kst_date > to || !keep(r)) continue
    const z = m.get(r.query_norm) ?? { q: r, searches: 0, zero: 0, result: 0, clicked: 0, reform: 0 }
    z.searches += r.searches
    z.zero += r.zero_result_searches
    z.result += r.result_searches
    z.clicked += r.clicked_searches
    z.reform += r.reformulated_searches
    m.set(r.query_norm, z)
  }
  const evalBy = addDays(to, 7)
  return [...m.values()]
    .filter((z) => z.searches >= FAILED_MIN)
    .map((z) => ({
      ...z,
      failed: z.zero / z.searches >= FAILED_ZERO,
      evalDate: z.q.eval_dates?.split(',').find((d) => d >= from && d <= evalBy) ?? null,
    }))
}
