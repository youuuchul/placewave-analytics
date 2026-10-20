import { useMemo } from 'react'
import { bucketed, groupSum, inRange, segFilter, sum, uniqueByMasks } from '../lib/agg'
import { md, mondayOf } from '../lib/date'
import { dec, num, pct, ratio } from '../lib/format'
import { applyRate, avgPos, ctr, FAILED_MIN, queryStats, rankerSpan, reform, SEARCH_KEYS, zeroRate } from '../lib/experiments'
import { QUERY_INTENT, S } from '../lib/labels'
import { F } from '../lib/persons'
import { ready, useTable, waitOf } from '../lib/source'
import type { DailySearch } from '../lib/types'
import { ReportLink } from '../components/ReportLink'
import { TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, Empty, Legend, Tile, TileRow } from '../components/ui'
import { delta, grain, ptDelta, type TabProps, vsLabel, weekTip } from './common'

const KEYS = SEARCH_KEYS

function Quality({ data, s, set, range, rows }: TabProps & { rows: DailySearch[] }) {
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
        { x: span.from, label: 'A/B 테스트 시작' },
        { x: span.v2All!, label: '새 랭킹 전체 적용' },
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

  const venueHint = useMemo(() => {
    const m = new Map<string, { name: string; views: number; n: number }>()
    for (const v of data.venue_registry ?? []) {
      const k = v.name.split(' ')[0].toLowerCase()
      const z = m.get(k)
      if (!z) m.set(k, { name: v.name, views: v.detail_viewers_28d, n: 1 })
      else {
        z.n += 1
        if (v.detail_viewers_28d > z.views) Object.assign(z, { name: v.name, views: v.detail_viewers_28d })
      }
    }
    return m
  }, [data])

  const qRows = ready(qL)
  const queries = useMemo(() => (qRows ? queryStats(qRows, range.from, range.to, seg) : []), [qRows, range.from, range.to, s.ch, s.pf, s.ms])
  const failed = queries.filter((q) => q.failed)
  const failedIn = failed.filter((q) => q.evalDate)
  type QRow = (typeof queries)[number]
  const qCols: Col<QRow>[] = [
    {
      key: 'q',
      label: '검색어',
      value: (r) => r.q.query_norm,
      render: (r) => {
        const v = r.q.query_intent === 'venue_name' ? venueHint.get(r.q.query_norm) : undefined
        return (
          <span className="flex flex-col">
            <span>{r.q.query_norm}</span>
            {v && <span className="text-[11px] text-muted">{v.n > 1 ? `${v.name} 외 ${v.n - 1}곳` : v.name}</span>}
          </span>
        )
      },
      width: '28%',
    },
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
    { key: 'eval', label: '평가 편입일', value: (r) => r.evalDate, render: (r) => (r.evalDate ? md(r.evalDate) : '—'), num: true },
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Legend
              items={[
                { label: '결과 0건', color: S(4), kind: 'line' },
                { label: '클릭률', color: S(1), kind: 'line' },
              ]}
            />
            {marks.length > 0 && <ReportLink s={s} set={set} id="ab-ranker-v2" label="실험 보고서 보기" />}
          </div>
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

export default function Search(p: TabProps) {
  const l = useTable(p.data, 'daily_search')
  const rows = ready(l)
  if (!rows)
    return (
      <Card title="검색" wait={waitOf(l) ?? 'loading'}>
        {null}
      </Card>
    )
  return <Quality {...p} rows={rows} />
}
