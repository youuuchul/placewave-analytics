import { groupSum } from './agg'
import { addDays } from './date'
import { dec, num, pct, ratio } from './format'
import type { DailyQuery, DailySearch } from './types'

export const SEARCH_KEYS = [
  'searches',
  'zero_result_searches',
  'ga_matched_searches',
  'matched_result_searches',
  'clicked_searches',
  'first_click_position_sum',
  'first_click_position_sq_sum',
  'top3_clicks',
  'reformulated_searches',
  'search_sessions',
  'search_sessions_applied',
] as const satisfies readonly (keyof DailySearch)[]
export type SearchKey = (typeof SEARCH_KEYS)[number]
export type SearchSums = Record<SearchKey, number>
export const ZERO_SUMS = Object.fromEntries(SEARCH_KEYS.map((k) => [k, 0])) as SearchSums

export const zeroRate = (t: SearchSums) => ratio(t.zero_result_searches, t.searches)
export const ctr = (t: SearchSums) => ratio(t.clicked_searches, t.matched_result_searches)
export const avgPos = (t: SearchSums) => ratio(t.first_click_position_sum, t.clicked_searches)
export const top3 = (t: SearchSums) => ratio(t.top3_clicks, t.clicked_searches)
export const reform = (t: SearchSums) => ratio(t.reformulated_searches, t.ga_matched_searches)
export const applyRate = (t: SearchSums) => ratio(t.search_sessions_applied, t.search_sessions)
export const clickPerSearch = (t: SearchSums) => ratio(t.clicked_searches, t.ga_matched_searches)

/** 랭킹 A/B 두 군. 대조군·실험군을 먼저 쓰고 버전 이름은 괄호로 병기한다. */
export const RANKER_GROUPS = {
  v1: { name: '대조군', what: '기존 랭킹', tag: 'v1' },
  v2: { name: '실험군', what: '새 랭킹', tag: 'v2' },
} as const

/** v1·v2 가 같은 날 각각 그날 검색의 10% 이상인 기간 = 랭킹 A/B 테스트 기간(자정 넘긴 세션의 소수 섞임 제외). */
export function rankerSpan(rows: DailySearch[]): { from: string; to: string; v2All: string | null } | null {
  const by = new Map<string, { v1: number; v2: number }>()
  for (const r of rows) {
    const z = by.get(r.kst_date) ?? { v1: 0, v2: 0 }
    if (r.ranker_version === 'v1') z.v1 += r.searches
    else z.v2 += r.searches
    by.set(r.kst_date, z)
  }
  const both = [...by.entries()]
    .filter(([, z]) => Math.min(z.v1, z.v2) >= 0.1 * (z.v1 + z.v2))
    .map(([d]) => d)
    .sort()
  if (!both.length) return null
  const to = both[both.length - 1]
  return { from: both[0], to, v2All: addDays(to, 1) }
}

export interface Ci {
  d: number
  lo: number
  hi: number
}

/** 두 비율의 차이(뒤 − 앞)와 95% 구간(정규 근사). */
export function diffCi(x1: number, n1: number, x2: number, n2: number): Ci | null {
  if (!n1 || !n2) return null
  const p1 = x1 / n1
  const p2 = x2 / n2
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2)
  const d = p2 - p1
  return { d, lo: d - 1.96 * se, hi: d + 1.96 * se }
}

/** 두 평균의 차이와 95% 구간(웰치, 정규 근사). 합·제곱합·표본 수로 계산한다. */
export function meanDiffCi(s1: number, q1: number, n1: number, s2: number, q2: number, n2: number): Ci | null {
  if (n1 < 2 || n2 < 2) return null
  const m1 = s1 / n1
  const m2 = s2 / n2
  const se = Math.sqrt((q1 - n1 * m1 * m1) / (n1 - 1) / n1 + (q2 - n2 * m2 * m2) / (n2 - 1) / n2)
  const d = m2 - m1
  return { d, lo: d - 1.96 * se, hi: d + 1.96 * se }
}

export type Verdict = '개선' | '악화' | '차이 없음'

/** 95% 구간이 0을 포함하면 차이 없음, 아니면 지표 방향(down = 낮을수록 좋음)에 따라 개선·악화. */
export function verdict(ci: Ci, down = false): Verdict {
  if (ci.lo <= 0 && ci.hi >= 0) return '차이 없음'
  return (down ? ci.hi < 0 : ci.lo > 0) ? '개선' : '악화'
}

const sign = (s: string) => (s.startsWith('-') ? `−${s.slice(1)}` : s === '0.0' || s === '0.00' ? s : `+${s}`)
/** 비율 차이 %p(부호·− 기호). 구간 끝값은 단위를 뺀다(덱 표기와 같게). */
export const pp = (v: number) => `${sign((v * 100).toFixed(1))}%p`
const ppBound = (v: number) => sign((v * 100).toFixed(1))
const signed2 = (v: number) => sign(v.toFixed(2))

export const DENOM_TIP = '결과 0건이 줄어 분모(결과 있는 검색)가 늘었다. 분모를 전체 검색으로 둔 검색당 클릭은 차이 없음'
export const EXCLUDED_TIP = '가상 데이터의 신청 로그는 랭킹과 무관하게 고정돼 있어 판정하지 않는다'

export interface CompareLine {
  id: string
  label: string
  a: number | null
  b: number | null
  fmt: (v: number | null) => string
  ci: Ci | null
  ciFmt: (v: number) => string
  /** 차이 (95% 구간) 칸 글자. 예: −16.5%p (−18.0 ~ −15.0) */
  ciText: string | null
  /** 화면에 쓰는 판정. 분모 효과·판정 제외는 원래 판정 대신 쓴다 */
  call: string | null
  tone: 'good' | 'bad' | 'muted'
  tip?: string
}

/**
 * 랭킹 A/B 비교 표. 넘겨받은 행(기간·세그먼트를 이미 거른 daily_search)을 버전별로 합해 지표·차이·판정을 만든다.
 * 결과 클릭률이 악화이면서 검색당 클릭이 차이 없음이고 0건 비율이 개선이면 '분모 효과'로 쓴다.
 * 검색 세션 신청 전환은 값만 보이고 판정에서 뺀다(EXCLUDED_TIP).
 */
export function compareRanker(rows: DailySearch[]): { a: SearchSums; b: SearchSums; lines: CompareLine[] } {
  const by = groupSum(rows, (r) => r.ranker_version, [...SEARCH_KEYS])
  const a = by.get('v1') ?? ZERO_SUMS
  const b = by.get('v2') ?? ZERO_SUMS
  const p1 = (v: number | null) => pct(v)
  type Spec = Omit<CompareLine, 'call' | 'tone' | 'tip' | 'ciText'> & { down?: boolean; excluded?: boolean; bound?: (v: number) => string }
  const spec: Spec[] = [
    { id: 'Q02', label: '검색 수', a: a.searches, b: b.searches, fmt: num, ci: null, ciFmt: pp },
    {
      id: 'Q03',
      label: '결과 0건 비율',
      a: zeroRate(a),
      b: zeroRate(b),
      fmt: p1,
      ci: diffCi(a.zero_result_searches, a.searches, b.zero_result_searches, b.searches),
      ciFmt: pp,
      bound: ppBound,
      down: true,
    },
    {
      id: 'Q05',
      label: '평균 첫 클릭 순위',
      a: avgPos(a),
      b: avgPos(b),
      fmt: (v) => dec(v, 2),
      ci: meanDiffCi(
        a.first_click_position_sum,
        a.first_click_position_sq_sum,
        a.clicked_searches,
        b.first_click_position_sum,
        b.first_click_position_sq_sum,
        b.clicked_searches,
      ),
      ciFmt: signed2,
      bound: signed2,
      down: true,
    },
    {
      id: 'Q06',
      label: '상위 3위 클릭 비중',
      a: top3(a),
      b: top3(b),
      fmt: p1,
      ci: diffCi(a.top3_clicks, a.clicked_searches, b.top3_clicks, b.clicked_searches),
      ciFmt: pp,
      bound: ppBound,
    },
    {
      id: 'Q04',
      label: '결과 클릭률',
      a: ctr(a),
      b: ctr(b),
      fmt: p1,
      ci: diffCi(a.clicked_searches, a.matched_result_searches, b.clicked_searches, b.matched_result_searches),
      ciFmt: pp,
      bound: ppBound,
    },
    {
      id: 'Q12',
      label: '검색당 클릭',
      a: clickPerSearch(a),
      b: clickPerSearch(b),
      fmt: p1,
      ci: diffCi(a.clicked_searches, a.ga_matched_searches, b.clicked_searches, b.ga_matched_searches),
      ciFmt: pp,
      bound: ppBound,
    },
    {
      id: 'Q07',
      label: '재검색률',
      a: reform(a),
      b: reform(b),
      fmt: p1,
      ci: diffCi(a.reformulated_searches, a.ga_matched_searches, b.reformulated_searches, b.ga_matched_searches),
      ciFmt: pp,
      bound: ppBound,
      down: true,
    },
    {
      id: 'Q08',
      label: '검색 세션 신청 전환',
      a: applyRate(a),
      b: applyRate(b),
      fmt: p1,
      ci: diffCi(a.search_sessions_applied, a.search_sessions, b.search_sessions_applied, b.search_sessions),
      ciFmt: pp,
      bound: ppBound,
      excluded: true,
    },
  ]
  const raw = new Map(spec.map((l) => [l.id, l.ci ? verdict(l.ci, l.down) : null]))
  const denomEffect = raw.get('Q04') === '악화' && raw.get('Q12') === '차이 없음' && raw.get('Q03') === '개선'
  const lines = spec.map(({ down: _d, excluded, bound, ...spec1 }): CompareLine => {
    const b = bound ?? spec1.ciFmt
    const l = { ...spec1, ciText: spec1.ci ? `${spec1.ciFmt(spec1.ci.d)} (${b(spec1.ci.lo)} ~ ${b(spec1.ci.hi)})` : null }
    const v = raw.get(l.id) ?? null
    if (excluded) return { ...l, call: '판정 제외', tone: 'muted', tip: EXCLUDED_TIP }
    if (l.id === 'Q04' && denomEffect) return { ...l, call: '분모 효과', tone: 'muted', tip: DENOM_TIP }
    return { ...l, call: v, tone: v === '개선' ? 'good' : v === '악화' ? 'bad' : 'muted' }
  })
  return { a, b, lines }
}

/** 일별 두 군 값(차트용). */
export function rankerDaily(rows: DailySearch[], key: (t: SearchSums) => number | null) {
  const byDay = new Map<string, DailySearch[]>()
  for (const r of rows) byDay.set(r.kst_date, [...(byDay.get(r.kst_date) ?? []), r])
  return [...byDay.keys()].sort().map((d) => {
    const g = groupSum(byDay.get(d)!, (r) => r.ranker_version, [...SEARCH_KEYS])
    return { date: d, v1: key(g.get('v1') ?? ZERO_SUMS), v2: key(g.get('v2') ?? ZERO_SUMS) }
  })
}

export const FAILED_MIN = 20
export const FAILED_ZERO = 0.3

export interface QueryStat {
  q: DailyQuery
  searches: number
  zero: number
  matched: number
  clicked: number
  reform: number
  failed: boolean
  /** 기간 시작 ~ 끝 + 7일 안에 검색팀 배치에 편입된 첫 날 */
  evalDate: string | null
}

/** 기간 안 검색 20건 이상 검색어의 합계와 실패 여부(0건 비율 30% 이상)·평가 편입일. 검색 탭과 이슈 보고서가 같이 쓴다. */
export function queryStats(rows: DailyQuery[], from: string, to: string, keep: (r: DailyQuery) => boolean = () => true): QueryStat[] {
  const m = new Map<string, Omit<QueryStat, 'failed' | 'evalDate'>>()
  for (const r of rows) {
    if (r.kst_date < from || r.kst_date > to || !keep(r)) continue
    const z = m.get(r.query_norm) ?? { q: r, searches: 0, zero: 0, matched: 0, clicked: 0, reform: 0 }
    z.searches += r.searches
    z.zero += r.zero_result_searches
    z.matched += r.ga_matched_searches
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
