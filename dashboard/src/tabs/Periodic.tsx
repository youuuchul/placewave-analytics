import { useMemo } from 'react'
import { groupSum, segFilter } from '../lib/agg'
import { addDays, addMonths, md, ym } from '../lib/date'
import { num, pct, ratio, won } from '../lib/format'
import { channel2Label, S } from '../lib/labels'
import { ready, useTable } from '../lib/source'
import type { Data, WeeklyActivity } from '../lib/types'
import { kappa, riskIds, teamPace } from './EvalOps'
import { Heatmap, TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, type Delta, Legend, Tile, TileRow } from '../components/ui'
import type { TabProps } from './common'

export function completeWeeks(data: Data): string[] {
  const set = new Set<string>()
  for (const r of data.weekly_activity) if (addDays(r.week_start, 6) <= data.meta.to_date) set.add(r.week_start)
  return [...set].sort()
}

export function summaryMonths(data: Data): string[] {
  return data.monthly_summary.map((r) => r.month).sort()
}

export function defaultMonth(data: Data): string {
  const months = summaryMonths(data)
  const last = months[months.length - 1]
  const lastDay = addDays(addMonths(last, 1) + '-01', -1)
  return data.meta.to_date >= lastDay || months.length < 2 ? last : months[months.length - 2]
}

function rel(cur: number | null, prev: number | null, goodUp: boolean | null = true, points = false): Delta {
  if (cur == null || prev == null) return { value: null, goodUp, points }
  return { value: points ? cur - prev : prev ? cur / prev - 1 : null, goodUp, points }
}

const sign = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`
const chg = (cur: number | null, prev: number | null) =>
  cur == null || prev == null || !prev ? '' : ` (전주 대비 ${sign((cur / prev - 1) * 100)}%)`
const chgPt = (cur: number | null, prev: number | null) =>
  cur == null || prev == null ? '' : ` (${sign((cur - prev) * 100)}%p)`

/** 주간 브리핑: 방문 · 검색 · 평가 운영 핵심 변화를 규칙으로 한 줄씩. 평가 운영은 세그먼트 축이 없어 세그먼트를 걸면 뺀다. */
function Briefing({ data, s, wk, wau, prevWau, ret, prevRet }: {
  data: Data
  s: TabProps['s']
  wk: string
  wau: number
  prevWau: number
  ret: number | null
  prevRet: number | null
}) {
  const seg = segFilter(s)
  const ds = ready(useTable(data, 'daily_search')) ?? []
  const prevWk = addDays(wk, -7)
  const sw = groupSum(
    ds.filter((r) => seg(r) && r.kst_date >= prevWk && r.kst_date <= addDays(wk, 6)),
    (r) => (r.kst_date >= wk ? 'cur' : 'prev'),
    ['searches', 'zero_result_searches', 'clicked_searches', 'matched_result_searches'],
  )
  const zr = (k: string) => {
    const z = sw.get(k)
    return z ? ratio(z.zero_result_searches, z.searches) : null
  }
  const ct = (k: string) => {
    const z = sw.get(k)
    return z ? ratio(z.clicked_searches, z.matched_result_searches) : null
  }
  const segOn = s.ch !== 'all' || s.pf !== 'all' || s.ms !== 'all'
  const ops = groupSum(
    (data.weekly_eval_ops ?? []).filter((r) => r.week_start === wk || r.week_start === prevWk),
    (r) => r.week_start,
    ['labels', 'gold_labels', 'gold_correct', 'final_labels', 'label_pairs', 'agree_pairs', 'labels_g0', 'labels_g1', 'labels_g2', 'labels_g3', 'rework_labels', 'handle_seconds', 'tasks_completed'],
  )
  const oc = ops.get(wk)
  const op = ops.get(prevWk)
  const risk = riskIds(
    (data.weekly_batch ?? []).filter((b) => b.week_start === wk),
    teamPace(data, wk),
  ).size

  const lines: { k: string; v: string }[] = [
    { k: '방문', v: `WAU ${num(wau)}명${chg(wau, prevWau)}, 재방문 비중 ${pct(ret)}${chgPt(ret, prevRet)}` },
  ]
  if (sw.get('cur'))
    lines.push({
      k: '검색',
      v: `결과 0건 비율 ${pct(zr('cur'))}${chgPt(zr('cur'), zr('prev'))}, 결과 클릭률 ${pct(ct('cur'))}${chgPt(ct('cur'), ct('prev'))}`,
    })
  if (oc && !segOn)
    lines.push({
      k: '평가 운영',
      v: `라벨 ${num(oc.labels)}건${chg(oc.labels, op?.labels ?? null)}, 정답셋 정확도 ${pct(ratio(oc.gold_correct, oc.gold_labels))}${chgPt(
        ratio(oc.gold_correct, oc.gold_labels),
        op ? ratio(op.gold_correct, op.gold_labels) : null,
      )}, 카파 ${kappa(oc)?.toFixed(2) ?? '—'}, 마감 위험 배치 ${num(risk)}개`,
    })
  return (
    <Card title="주간 브리핑" meta={`${md(wk)} ~ ${md(addDays(wk, 6))}`}>
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {lines.map((l) => (
          <li key={l.k} className="grid grid-cols-[72px_1fr] gap-3">
            <span className="text-muted">{l.k}</span>
            <span className="tnum text-ink">{l.v}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

type WA = Pick<WeeklyActivity, 'wau' | 'new_persons' | 'returning_persons' | 'two_plus_days'>

function Weekly({ data, s }: TabProps) {
  const seg = segFilter(s)
  const weeks = completeWeeks(data)
  const wk = weeks.includes(s.wk) ? s.wk : weeks[weeks.length - 1]
  const prevWk = addDays(wk, -7)

  const byWeek = useMemo(() => {
    const m = new Map<string, WA>()
    for (const r of data.weekly_activity) {
      if (!seg(r)) continue
      const z = m.get(r.week_start) ?? { wau: 0, new_persons: 0, returning_persons: 0, two_plus_days: 0 }
      z.wau += r.wau
      z.new_persons += r.new_persons
      z.returning_persons += r.returning_persons
      z.two_plus_days += r.two_plus_days
      m.set(r.week_start, z)
    }
    return m
  }, [data, s.ch, s.pf, s.ms])
  const zero: WA = { wau: 0, new_persons: 0, returning_persons: 0, two_plus_days: 0 }
  const cur = byWeek.get(wk) ?? zero
  const prev = byWeek.get(prevWk) ?? zero

  const cohorts = useMemo(() => {
    const m = new Map<string, { size: number; ret: number[] }>()
    for (const r of data.weekly_cohort) {
      if (!seg(r) || r.cohort_week > wk) continue
      if (addDays(r.cohort_week, 7 * r.week_offset) > wk) continue
      const z = m.get(r.cohort_week) ?? { size: 0, ret: Array<number>(13).fill(0) }
      if (r.week_offset === 0) z.size += r.cohort_size
      z.ret[r.week_offset] += r.retained
      m.set(r.cohort_week, z)
    }
    return m
  }, [data, wk, s.ch, s.pf, s.ms])

  const w1 = (c: string) => {
    const z = cohorts.get(c)
    return z && z.size > 0 ? z.ret[1] / z.size : null
  }
  const w1Cohort = prevWk
  const w1Prev = addDays(prevWk, -7)

  const heatWeeks: string[] = []
  for (let i = 12; i >= 1; i--) {
    const w = addDays(wk, -7 * i)
    if (cohorts.has(w)) heatWeeks.push(w)
  }
  const avg = Array.from({ length: 12 }, (_, k) => {
    let n = 0
    let r = 0
    for (const w of heatWeeks) {
      if (addDays(w, 7 * (k + 1)) > wk) continue
      const z = cohorts.get(w)!
      n += z.size
      r += z.ret[k + 1]
    }
    return n > 0 ? r / n : null
  })
  const heatRows = [
    ...heatWeeks.map((w) => {
      const z = cohorts.get(w)!
      return {
        label: md(w),
        head: num(z.size),
        cells: Array.from({ length: 12 }, (_, k) =>
          addDays(w, 7 * (k + 1)) <= wk && z.size > 0 ? z.ret[k + 1] / z.size : null,
        ),
      }
    }),
    { label: '가중 평균', head: num(heatWeeks.reduce((a, w) => a + cohorts.get(w)!.size, 0)), cells: avg },
  ]

  const trend: { date: string; new_persons: number; returning_persons: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const w = addDays(wk, -7 * i)
    const z = byWeek.get(w)
    if (z) trend.push({ date: w, new_persons: z.new_persons, returning_persons: z.returning_persons })
  }
  const vs = byWeek.has(prevWk) ? '전주 대비' : '전기 없음'
  const series = [
    { key: 'returning_persons', label: '재방문', color: S(1) },
    { key: 'new_persons', label: '신규', color: S(2) },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow title={`주간 · ${vs}`}>
        <Tile metricId="V03" label={`WAU · ${md(wk)} 주`} value={num(cur.wau)} unit="명" delta={rel(cur.wau, prev.wau)} />
        <Tile metricId="V16" label="신규" value={num(cur.new_persons)} unit="명" delta={rel(cur.new_persons, prev.new_persons)} />
        <Tile
          metricId="V17"
          label="재방문"
          value={num(cur.returning_persons)}
          unit="명"
          delta={rel(cur.returning_persons, prev.returning_persons)}
        />
        <Tile
          metricId="V05"
          label="재방문 비중"
          value={pct(ratio(cur.returning_persons, cur.wau))}
          sub={`WAU ${num(cur.wau)} 중`}
          delta={rel(ratio(cur.returning_persons, cur.wau), ratio(prev.returning_persons, prev.wau), true, true)}
        />
        <Tile
          metricId="V06"
          label="주 2일+ 방문"
          value={pct(ratio(cur.two_plus_days, cur.wau))}
          sub={`WAU ${num(cur.wau)} 중`}
          delta={rel(ratio(cur.two_plus_days, cur.wau), ratio(prev.two_plus_days, prev.wau), true, true)}
        />
        <Tile
          metricId="R01"
          label={`W1 리텐션 · ${md(w1Cohort)} 코호트`}
          value={pct(w1(w1Cohort))}
          sub={`코호트 ${num(cohorts.get(w1Cohort)?.size ?? 0)}명`}
          delta={rel(w1(w1Cohort), w1(w1Prev), true, true)}
        />
      </TileRow>

      <Briefing
        data={data}
        s={s}
        wk={wk}
        wau={cur.wau}
        prevWau={prev.wau}
        ret={ratio(cur.returning_persons, cur.wau)}
        prevRet={ratio(prev.returning_persons, prev.wau)}
      />

      <Card title="주간 방문자" meta="최근 12주 · 사람" right={<Legend items={series} />}>
        <TimeChart
          data={trend}
          kind="stack"
          series={series}
          tipTitle={(d) => `${d} 주`}
          height={240}
        />
      </Card>

      <Card title="주간 코호트 리텐션" metricId="R01" meta="첫 방문 주 기준 · 최근 12개 코호트 · %">
        <Heatmap
          cols={Array.from({ length: 12 }, (_, k) => `W${k + 1}`)}
          rows={heatRows}
          head
          headLabel="코호트"
          format={(v) => `${Math.round(v * 100)}`}
          rowLabelWidth={64}
          tip={(r, c, v) => `${heatRows[r].label} 코호트 W${c + 1} · ${pct(v)}`}
        />
      </Card>
    </div>
  )
}

function Monthly({ data, s }: TabProps) {
  const months = summaryMonths(data)
  const mo = months.includes(s.mo) ? s.mo : defaultMonth(data)
  const byMonth = new Map(data.monthly_summary.map((r) => [r.month, r]))
  const cur = byMonth.get(mo)
  const prev = byMonth.get(addMonths(mo, -1))
  const n = Number(s.mr)
  const window = months.filter((m) => m <= mo).slice(-n)
  const rows = window.map((m) => byMonth.get(m)!).filter(Boolean)
  const vs = prev ? '전월 대비' : '전기 없음'
  const cancel = (r?: typeof cur) => (r ? ratio(r.cancels, r.applies) : null)

  const cohort = useMemo(() => {
    const m = new Map<string, { size: number; ret: number[] }>()
    for (const r of data.monthly_cohort) {
      if (r.cohort_month > mo || addMonths(r.cohort_month, r.month_offset) > mo) continue
      const z = m.get(r.cohort_month) ?? { size: 0, ret: Array<number>(7).fill(0) }
      if (r.month_offset === 0) z.size += r.cohort_size
      z.ret[r.month_offset] += r.retained
      m.set(r.cohort_month, z)
    }
    return m
  }, [data, mo])
  const cm = [...cohort.keys()].sort().slice(-7)
  const heatRows = cm.map((c) => {
    const z = cohort.get(c)!
    return {
      label: ym(c),
      head: num(z.size),
      cells: Array.from({ length: 6 }, (_, k) =>
        addMonths(c, k + 1) <= mo && z.size > 0 ? z.ret[k + 1] / z.size : null,
      ),
    }
  })

  const trend = rows.map((r) => ({
    date: r.month,
    new_persons: r.new_persons,
    returning: r.persons - r.new_persons,
  }))
  const series = [
    { key: 'returning', label: '재방문', color: S(1) },
    { key: 'new_persons', label: '신규', color: S(2) },
  ]

  const cols: Col<(typeof rows)[number]>[] = [
    { key: 'month', label: '월', value: (r) => r.month, render: (r) => <span className="tnum text-ink">{r.month}</span> },
    { key: 'persons', label: '방문자', value: (r) => r.persons, render: (r) => num(r.persons), num: true },
    { key: 'new_persons', label: '신규', value: (r) => r.new_persons, render: (r) => num(r.new_persons), num: true },
    { key: 'signups', label: '가입', value: (r) => r.signups, render: (r) => num(r.signups), num: true },
    { key: 'applies', label: '신청', value: (r) => r.applies, render: (r) => num(r.applies), num: true },
    { key: 'pay_count', label: '결제', value: (r) => r.pay_count, render: (r) => num(r.pay_count), num: true },
    { key: 'pay_amount', label: '결제 금액', value: (r) => r.pay_amount, render: (r) => won(r.pay_amount), num: true },
    { key: 'cancel', label: '신청분 취소율', value: (r) => cancel(r), render: (r) => pct(cancel(r)), num: true },
    { key: 'w1', label: 'W1', value: (r) => r.w1_retention, render: (r) => pct(r.w1_retention), num: true },
    { key: 'top', label: '상위 유입', value: (r) => channel2Label(r.top_channel) },
  ]

  return (
    <div className="flex flex-col gap-4">
      <TileRow title={`월간 · ${vs}`}>
        <Tile metricId="V04" label={`방문자 · ${mo}`} value={num(cur?.persons)} unit="명" delta={rel(cur?.persons ?? null, prev?.persons ?? null)} />
        <Tile metricId="V02" label="신규" value={num(cur?.new_persons)} unit="명" delta={rel(cur?.new_persons ?? null, prev?.new_persons ?? null)} />
        <Tile metricId="C10" label="가입" value={num(cur?.signups)} unit="명" delta={rel(cur?.signups ?? null, prev?.signups ?? null)} />
        <Tile
          metricId="C13"
          label="결제 금액"
          value={won(cur?.pay_amount)}
          unit="원"
          delta={rel(cur?.pay_amount ?? null, prev?.pay_amount ?? null)}
        />
        <Tile
          metricId="C21"
          label="신청분 취소율"
          value={pct(cancel(cur))}
          sub={`신청 ${num(cur?.applies)}건 중`}
          delta={rel(cancel(cur), cancel(prev), false, true)}
        />
        <Tile
          metricId="R02"
          label="W1 리텐션"
          value={pct(cur?.w1_retention)}
          sub="이달 첫 방문 코호트"
          delta={rel(cur?.w1_retention ?? null, prev?.w1_retention ?? null, true, true)}
        />
      </TileRow>

      <div className="grid gap-4 xl:grid-cols-[6fr_6fr]">
        <Card title="월간 방문자" meta={`최근 ${rows.length}개월 · 사람`} right={<Legend items={series} />}>
          <TimeChart
            data={trend}
            kind="stack"
            series={series}
            xFormat={(v) => ym(String(v))}
            height={240}
          />
        </Card>
        <Card title="월간 코호트 리텐션" metricId="R03" meta="첫 방문 월 기준 · %">
          <Heatmap
            cols={Array.from({ length: 6 }, (_, k) => `M${k + 1}`)}
            rows={heatRows}
            head
            headLabel="코호트"
            format={(v) => `${Math.round(v * 100)}`}
            rowLabelWidth={48}
            tip={(r, c, v) => `${heatRows[r].label} 코호트 M${c + 1} · ${pct(v)}`}
          />
        </Card>
      </div>

      <Card title="월간 브리핑" meta={`${rows[0]?.month ?? ''} ~ ${mo}`}>
        <DataTable cols={cols} rows={[...rows]} sortKey="month" rowKey={(r) => r.month} limit={12} selected={mo} />
      </Card>
    </div>
  )
}

export default function Periodic(p: TabProps) {
  return p.s.view === 'month' ? <Monthly {...p} /> : <Weekly {...p} />
}
