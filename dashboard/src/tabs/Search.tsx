import { useMemo } from 'react'
import { bucketed, groupSum, inRange, segFilter, sum, uniqueByMasks } from '../lib/agg'
import { addDays, md, mondayOf } from '../lib/date'
import { dec, num, pct, ratio } from '../lib/format'
import { QUERY_INTENT, S } from '../lib/labels'
import { F } from '../lib/persons'
import { ready, useTable, waitOf } from '../lib/source'
import type { DailyQuery, DailySearch } from '../lib/types'
import { TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, Empty, Legend, Tile, TileRow } from '../components/ui'
import { delta, grain, ptDelta, type TabProps, vsLabel, weekTip } from './common'

const KEYS = [
  'searches',
  'zero_result_searches',
  'ga_matched_searches',
  'matched_result_searches',
  'clicked_searches',
  'first_click_position_sum',
  'top3_clicks',
  'reformulated_searches',
  'search_sessions',
  'search_sessions_applied',
] as const satisfies readonly (keyof DailySearch)[]
type K = (typeof KEYS)[number]
type Sums = Record<K, number>

const FAILED_MIN = 20
const FAILED_ZERO = 0.3

const zeroRate = (t: Sums) => ratio(t.zero_result_searches, t.searches)
const ctr = (t: Sums) => ratio(t.clicked_searches, t.matched_result_searches)
const avgPos = (t: Sums) => ratio(t.first_click_position_sum, t.clicked_searches)
const top3 = (t: Sums) => ratio(t.top3_clicks, t.clicked_searches)
const reform = (t: Sums) => ratio(t.reformulated_searches, t.ga_matched_searches)
const applyRate = (t: Sums) => ratio(t.search_sessions_applied, t.search_sessions)
const clickPerSearch = (t: Sums) => ratio(t.clicked_searches, t.ga_matched_searches)

/** v1·v2 가 같은 날 각각 그날 검색의 10% 이상인 기간 = 랭킹 50% 노출 실험 기간(자정 넘긴 세션의 소수 섞임 제외). */
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

function Quality({ data, s, range, rows }: TabProps & { rows: DailySearch[] }) {
  const seg = segFilter(s)
  const pdL = useTable(data, 'person_day')
  const qL = useTable(data, 'daily_query')
  const pd = ready(pdL)
  const pw = waitOf(pdL)
  const segRows = useMemo(() => rows.filter(seg), [rows, s.ch, s.pf, s.ms])
  const cur = sum(inRange(segRows, range.from, range.to), [...KEYS])
  const prev = sum(inRange(segRows, range.prevFrom, range.prevTo), [...KEYS])
  const searchers = (from: string, to: string) =>
    pd ? (uniqueByMasks(pd, from, to, [F.searched], { ch: s.ch, pf: s.pf, ms: s.ms }).get('')?.[0] ?? 0) : null
  const pCur = useMemo(() => searchers(range.from, range.to), [pd, range.from, range.to, s.ch, s.pf, s.ms])
  const pPrev = useMemo(() => searchers(range.prevFrom, range.prevTo), [pd, range.prevFrom, range.prevTo, s.ch, s.pf, s.ms])

  const span = rankerSpan(rows)
  const b = bucketed(segRows, [...KEYS], range)
  const trend = b.rows.map((r) => ({ date: r.date, zero: zeroRate(r), ctr: ctr(r) }))
  const marks = span
    ? [
        { x: span.from, label: 'v2 50%' },
        { x: span.v2All!, label: 'v2 전체' },
      ]
        .map((m) => ({ ...m, x: b.weekly ? mondayOf(m.x) : m.x }))
        .filter((m) => trend.some((t) => t.date === m.x))
    : []

  const intents = groupSum(inRange(segRows, range.from, range.to), (r) => r.query_intent, [...KEYS])
  const intentRows = [...intents.entries()].map(([k, v]) => ({ key: k, ...v }))
  const intentCols: Col<(typeof intentRows)[number]>[] = [
    { key: 'name', label: '의도 유형', value: (r) => QUERY_INTENT[r.key] ?? r.key },
    { key: 'searches', label: '검색 수', value: (r) => r.searches, render: (r) => num(r.searches), num: true },
    { key: 'zero', label: '결과 0건', value: (r) => zeroRate(r), render: (r) => pct(zeroRate(r)), num: true },
    { key: 'ctr', label: '클릭률', value: (r) => ctr(r), render: (r) => pct(ctr(r)), num: true },
    { key: 'pos', label: '첫 클릭 순위', value: (r) => avgPos(r), render: (r) => dec(avgPos(r), 2), num: true },
    { key: 'reform', label: '재검색률', value: (r) => reform(r), render: (r) => pct(reform(r)), num: true },
  ]

  const qRows = ready(qL)
  const queries = useMemo(() => {
    if (!qRows) return []
    const m = new Map<string, { q: DailyQuery; searches: number; zero: number; matched: number; clicked: number; reform: number }>()
    for (const r of qRows) {
      if (r.kst_date < range.from || r.kst_date > range.to || !seg(r)) continue
      const z = m.get(r.query_norm) ?? { q: r, searches: 0, zero: 0, matched: 0, clicked: 0, reform: 0 }
      z.searches += r.searches
      z.zero += r.zero_result_searches
      z.matched += r.ga_matched_searches
      z.clicked += r.clicked_searches
      z.reform += r.reformulated_searches
      m.set(r.query_norm, z)
    }
    const evalBy = addDays(range.to, 7)
    return [...m.values()]
      .filter((z) => z.searches >= FAILED_MIN)
      .map((z) => ({
        ...z,
        failed: z.zero / z.searches >= FAILED_ZERO,
        evalDate: z.q.first_eval_date && z.q.first_eval_date <= evalBy ? z.q.first_eval_date : null,
      }))
  }, [qRows, range.from, range.to, s.ch, s.pf, s.ms])
  const failed = queries.filter((q) => q.failed)
  const failedIn = failed.filter((q) => q.evalDate)
  type QRow = (typeof queries)[number]
  const qCols: Col<QRow>[] = [
    { key: 'q', label: '검색어', value: (r) => r.q.query_norm, width: '28%' },
    { key: 'intent', label: '의도', value: (r) => QUERY_INTENT[r.q.query_intent] ?? r.q.query_intent },
    { key: 'searches', label: '검색 수', value: (r) => r.searches, render: (r) => num(r.searches), num: true },
    {
      key: 'zero',
      label: '결과 0건',
      value: (r) => r.zero / r.searches,
      render: (r) => (
        <span style={{ color: r.failed ? 'var(--bad)' : undefined }} className={r.failed ? 'font-medium' : ''}>
          {pct(r.zero / r.searches)}
        </span>
      ),
      num: true,
    },
    { key: 'ctr', label: '클릭률', value: (r) => ratio(r.clicked, r.matched), render: (r) => pct(ratio(r.clicked, r.matched)), num: true },
    { key: 'reform', label: '재검색률', value: (r) => ratio(r.reform, r.matched), render: (r) => pct(ratio(r.reform, r.matched)), num: true },
    { key: 'eval', label: '평가 편입', value: (r) => r.evalDate, render: (r) => (r.evalDate ? md(r.evalDate) : '—'), num: true },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow title={`검색 · ${vsLabel(data, range)}`}>
        <Tile metricId="Q01" label="검색 이용자" value={num(pCur)} unit="명" wait={pw} delta={delta(data, range, pCur, pPrev)} />
        <Tile
          metricId="Q03"
          label="결과 0건 비율"
          value={pct(zeroRate(cur))}
          sub={`검색 ${num(cur.searches)}건 중`}
          delta={ptDelta(data, range, zeroRate(cur), zeroRate(prev))}
        />
        <Tile
          metricId="Q04"
          label="결과 클릭률"
          value={pct(ctr(cur))}
          sub={`로그 매칭 ${pct(ratio(cur.ga_matched_searches, cur.searches))}`}
          delta={ptDelta(data, range, ctr(cur), ctr(prev))}
        />
        <Tile
          metricId="Q05"
          label="평균 첫 클릭 순위"
          value={dec(avgPos(cur), 2)}
          unit="위"
          delta={delta(data, range, avgPos(cur), avgPos(prev))}
        />
        <Tile metricId="Q07" label="재검색률" value={pct(reform(cur))} delta={ptDelta(data, range, reform(cur), reform(prev))} />
        <Tile
          metricId="Q08"
          label="검색 세션 신청 전환"
          value={pct(applyRate(cur), 2)}
          sub={`검색 세션 ${num(cur.search_sessions)} 중`}
          delta={ptDelta(data, range, applyRate(cur), applyRate(prev))}
        />
      </TileRow>

      <Card
        title="결과 0건 비율 · 결과 클릭률"
        meta={grain(b.weekly)}
        right={
          <Legend
            items={[
              { label: '결과 0건', color: S(4), kind: 'line' },
              { label: '클릭률', color: S(1), kind: 'line' },
            ]}
          />
        }
      >
        {cur.searches === 0 ? (
          <Empty />
        ) : (
          <TimeChart
            data={trend}
            kind="line"
            series={[
              { key: 'zero', label: '결과 0건', color: S(4) },
              { key: 'ctr', label: '클릭률', color: S(1) },
            ]}
            yFormat={(v) => pct(v, 0)}
            valueFormat={(v) => pct(v)}
            tipTitle={weekTip(b.weekly)}
            marks={marks}
            decimals
          />
        )}
      </Card>

      <Card title="의도 유형별" metricId="Q03">
        {intentRows.length ? (
          <DataTable cols={intentCols} rows={intentRows} sortKey="searches" rowKey={(r) => r.key} minW="min-w-[560px]" />
        ) : (
          <Empty h={120} />
        )}
      </Card>

      <Card
        title="검색어"
        metricId="Q09"
        meta={qRows ? `검색 ${FAILED_MIN}건 이상 ${num(queries.length)}개 · 실패 ${num(failed.length)}개 · 평가 편입 ${num(failedIn.length)}개` : undefined}
        wait={waitOf(qL)}
      >
        {queries.length ? (
          <DataTable cols={qCols} rows={queries} sortKey="zero" rowKey={(r) => r.q.query_norm} minW="min-w-[680px]" />
        ) : (
          <Empty h={120} />
        )}
      </Card>
    </div>
  )
}

/** 두 비율의 차이와 95% 구간(정규 근사). */
function diffCi(x1: number, n1: number, x2: number, n2: number): { d: number; lo: number; hi: number } | null {
  if (!n1 || !n2) return null
  const p1 = x1 / n1
  const p2 = x2 / n2
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2)
  const d = p2 - p1
  return { d, lo: d - 1.96 * se, hi: d + 1.96 * se }
}

function Ranker({ s, range, rows }: TabProps & { rows: DailySearch[] }) {
  const seg = segFilter(s)
  const segRows = useMemo(() => rows.filter(seg), [rows, s.ch, s.pf, s.ms])
  const inWin = inRange(segRows, range.from, range.to)
  const by = groupSum(inWin, (r) => r.ranker_version, [...KEYS])
  const zero = Object.fromEntries(KEYS.map((k) => [k, 0])) as Sums
  const v1 = by.get('v1') ?? zero
  const v2 = by.get('v2') ?? zero

  const lines: {
    id: string
    label: string
    a: number | null
    b: number | null
    fmt: (v: number | null) => string
    ci: ReturnType<typeof diffCi>
    down?: boolean
  }[] = [
    { id: 'Q02', label: '검색 수', a: v1.searches, b: v2.searches, fmt: num, ci: null },
    {
      id: 'Q03',
      label: '결과 0건 비율',
      a: zeroRate(v1),
      b: zeroRate(v2),
      fmt: (v) => pct(v),
      ci: diffCi(v1.zero_result_searches, v1.searches, v2.zero_result_searches, v2.searches),
      down: true,
    },
    {
      id: 'Q05',
      label: '평균 첫 클릭 순위',
      a: avgPos(v1),
      b: avgPos(v2),
      fmt: (v) => dec(v, 2),
      ci: null,
      down: true,
    },
    {
      id: 'Q06',
      label: '상위 3위 클릭 비중',
      a: top3(v1),
      b: top3(v2),
      fmt: (v) => pct(v),
      ci: diffCi(v1.top3_clicks, v1.clicked_searches, v2.top3_clicks, v2.clicked_searches),
    },
    {
      id: 'Q04',
      label: '결과 클릭률',
      a: ctr(v1),
      b: ctr(v2),
      fmt: (v) => pct(v),
      ci: diffCi(v1.clicked_searches, v1.matched_result_searches, v2.clicked_searches, v2.matched_result_searches),
    },
    {
      id: 'Q12',
      label: '검색당 클릭',
      a: clickPerSearch(v1),
      b: clickPerSearch(v2),
      fmt: (v) => pct(v),
      ci: diffCi(v1.clicked_searches, v1.ga_matched_searches, v2.clicked_searches, v2.ga_matched_searches),
    },
    {
      id: 'Q07',
      label: '재검색률',
      a: reform(v1),
      b: reform(v2),
      fmt: (v) => pct(v),
      ci: diffCi(v1.reformulated_searches, v1.ga_matched_searches, v2.reformulated_searches, v2.ga_matched_searches),
      down: true,
    },
    {
      id: 'Q08',
      label: '검색 세션 신청 전환',
      a: applyRate(v1),
      b: applyRate(v2),
      fmt: (v) => pct(v, 2),
      ci: diffCi(v1.search_sessions_applied, v1.search_sessions, v2.search_sessions_applied, v2.search_sessions),
    },
  ]
  const pp = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%p`
  const verdict = (ci: NonNullable<ReturnType<typeof diffCi>>, down?: boolean) => {
    if (ci.lo <= 0 && ci.hi >= 0) return { text: '차이 없음', color: 'var(--muted)' }
    const better = down ? ci.hi < 0 : ci.lo > 0
    return { text: better ? '개선' : '악화', color: better ? 'var(--good)' : 'var(--bad)' }
  }

  const daily = (key: (t: Sums) => number | null) =>
    [...new Set(inWin.map((r) => r.kst_date))].sort().map((d) => {
      const day = inWin.filter((r) => r.kst_date === d)
      const g = groupSum(day, (r) => r.ranker_version, [...KEYS])
      return { date: d, v1: key(g.get('v1') ?? zero), v2: key(g.get('v2') ?? zero) }
    })
  const series = [
    { key: 'v1', label: 'v1', color: S(3) },
    { key: 'v2', label: 'v2', color: S(1) },
  ]
  const legend = <Legend items={series.map((x) => ({ label: x.label, color: x.color, kind: 'line' as const }))} />

  if (!v1.searches || !v2.searches)
    return (
      <Card title="랭킹 v1 · v2 비교">
        <Empty h={160} />
      </Card>
    )

  return (
    <div className="flex flex-col gap-4">
      <Card title="랭킹 v1 · v2 비교" meta={`기기 해시 50% 배정 · ${md(range.from)}~${md(range.to)}`}>
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-axis text-muted">
                <th className="py-2 text-left font-medium">지표</th>
                <th className="py-2 pr-3 text-right font-medium">v1</th>
                <th className="py-2 pr-3 text-right font-medium">v2</th>
                <th className="py-2 pr-3 text-right font-medium">차이 (95% 구간)</th>
                <th className="py-2 text-right font-medium">판정</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const v = l.ci ? verdict(l.ci, l.down) : null
                return (
                  <tr key={l.id} className="border-b border-line">
                    <td className="py-2 text-ink2">{l.label}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink">{l.fmt(l.a)}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink">{l.fmt(l.b)}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink2">
                      {l.ci ? `${pp(l.ci.d)} (${pp(l.ci.lo)} ~ ${pp(l.ci.hi)})` : l.a != null && l.b != null && l.id !== 'Q02' ? dec(l.b - l.a, 2) : '—'}
                    </td>
                    <td className="py-2 text-right font-medium" style={{ color: v?.color }}>
                      {v?.text ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="결과 0건 비율" meta="일별" right={legend}>
          <TimeChart data={daily(zeroRate)} kind="line" series={series} yFormat={(v) => pct(v, 0)} valueFormat={(v) => pct(v)} decimals />
        </Card>
        <Card title="평균 첫 클릭 순위" meta="일별" right={legend}>
          <TimeChart data={daily(avgPos)} kind="line" series={series} yFormat={(v) => dec(v, 1)} valueFormat={(v) => dec(v, 2)} decimals />
        </Card>
      </div>
    </div>
  )
}

export default function Search(p: TabProps) {
  const l = useTable(p.data, 'daily_search')
  const rows = ready(l)
  if (!rows)
    return (
      <Card title="검색" wait={waitOf(l) ?? 'loading'}>
        {null}
      </Card>
    )
  return p.s.view === 'ranker' ? <Ranker {...p} rows={rows} /> : <Quality {...p} rows={rows} />
}
