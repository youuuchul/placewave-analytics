import { useMemo } from 'react'
import { groupSum } from '../lib/agg'
import { addDays, md } from '../lib/date'
import { dec, num, pct, ratio } from '../lib/format'
import { PURPOSE, RATER_GROUP, REQUESTER, S } from '../lib/labels'
import type { Data, WeeklyBatch, WeeklyEvalOps, WeeklyRater } from '../lib/types'
import { ScatterPlot, TimeChart } from '../components/charts'
import { DataTable, type Col } from '../components/DataTable'
import { Card, type Delta, Empty, Legend, Tile, TileRow } from '../components/ui'
import { ReportLink } from '../components/ReportLink'
import type { TabProps } from './common'

export const OPS_KEYS = [
  'labels',
  'rework_labels',
  'handle_seconds',
  'gold_labels',
  'gold_correct',
  'final_labels',
  'label_pairs',
  'agree_pairs',
  'labels_g0',
  'labels_g1',
  'labels_g2',
  'labels_g3',
  'tasks_completed',
] as const satisfies readonly (keyof WeeklyEvalOps)[]
export type Ops = Record<(typeof OPS_KEYS)[number], number>

const LOW_ACC = 0.8
const LOW_MIN_GOLD = 10
export const GUIDELINE_V2 = '2026-06-01'

export const acc = (t: Ops) => ratio(t.gold_correct, t.gold_labels)
export const agree = (t: Ops) => ratio(t.agree_pairs, t.label_pairs)
export const perLabel = (t: Ops) => ratio(t.handle_seconds, t.labels)
export const rework = (t: Ops) => ratio(t.rework_labels, t.labels)

/** 코헨 카파(평가자 쌍 풀링): (Po − Pe) ÷ (1 − Pe), Pe = Σ 등급 비중². */
export function kappa(t: Ops): number | null {
  const po = agree(t)
  if (po == null || !t.final_labels) return null
  const pe = [t.labels_g0, t.labels_g1, t.labels_g2, t.labels_g3].reduce((a, g) => a + (g / t.final_labels) ** 2, 0)
  return pe < 1 ? (po - pe) / (1 - pe) : null
}

export function evalWeeks(data: Data): string[] {
  const set = new Set<string>()
  for (const r of data.weekly_eval_ops ?? []) if (addDays(r.week_start, 6) <= data.meta.to_date) set.add(r.week_start)
  return [...set].sort()
}

/**
 * 마감 위험 배치: 그 주 진행 배치를 배정 순서(우선순위 → 생성일)로 줄 세우고, 앞 배치까지의 남은 과제 누적을
 * 팀 처리량(최근 14일 완료 과제 ÷ 14)으로 나눈 예상 소요 일수가 마감까지 남은 일수보다 길면 위험. 마감이 지났으면 위험.
 * 평가자는 요청 부서와 상관없이 같은 대기열을 처리하므로 줄과 처리량은 부서 필터 전 전체로 본다.
 */
export function riskIds(all: WeeklyBatch[], perDay: number): Set<string> {
  const out = new Set<string>()
  let cum = 0
  for (const b of [...all].sort((x, y) => x.priority - y.priority || x.created_date.localeCompare(y.created_date))) {
    if (b.remaining_tasks <= 0) continue
    cum += b.remaining_tasks
    if (b.days_to_due < 0 || perDay <= 0 || cum / perDay > b.days_to_due) out.add(b.batch_id)
  }
  return out
}

/** 그 주 끝 기준 팀 처리량: 그 주와 전주 완료 과제 ÷ 14 (부서 필터 전). */
export function teamPace(data: Data, wk: string): number {
  const prev = addDays(wk, -7)
  const n = (data.weekly_eval_ops ?? [])
    .filter((r) => r.week_start === wk || r.week_start === prev)
    .reduce((a, r) => a + r.tasks_completed, 0)
  return n / 14
}

export function status(b: WeeklyBatch, risk: Set<string>): { text: string; color?: string } {
  if (b.remaining_tasks <= 0) return { text: '완료', color: 'var(--good)' }
  if (b.days_to_due < 0) return { text: '마감 지남', color: 'var(--bad)' }
  if (risk.has(b.batch_id)) return { text: '위험', color: 'var(--bad)' }
  return { text: '진행' }
}

function rel(cur: number | null, prev: number | null, points = false, goodUp: boolean | null = true): Delta {
  if (cur == null || prev == null) return { value: null, goodUp, points }
  return { value: points ? cur - prev : prev ? cur / prev - 1 : null, goodUp, points }
}

/** 개수·지수 지표의 전주 대비 차이 값(`▲ 2명`, `▼ 0.01`). */
function diff(cur: number | null, prev: number | null, unit: string, digits = 0): Delta {
  return { value: cur == null || prev == null ? null : cur - prev, abs: { unit, digits } }
}

interface RaterRow {
  rater_id: string
  rater_group: string
  labels: number
  rework_labels: number
  handle_seconds: number
  gold_labels: number
  gold_correct: number
  label_pairs: number
  agree_pairs: number
}

export default function EvalOps({ data, s, set }: TabProps) {
  const weeks = evalWeeks(data)
  const wk = weeks.includes(s.wk) ? s.wk : weeks[weeks.length - 1]
  const prevWk = addDays(wk, -7)
  const rq = (r: { requester: string }) => s.rq === 'all' || r.requester === s.rq
  const zero = Object.fromEntries(OPS_KEYS.map((k) => [k, 0])) as Ops

  const ops = useMemo(() => (data.weekly_eval_ops ?? []).filter(rq), [data, s.rq])
  const byWeek = useMemo(() => groupSum(ops, (r) => r.week_start, [...OPS_KEYS]), [ops])
  const cur = byWeek.get(wk) ?? zero
  const prev = byWeek.get(prevWk) ?? zero

  const raters = (w: string): RaterRow[] => {
    const m = new Map<string, RaterRow>()
    for (const r of (data.weekly_rater ?? []) as WeeklyRater[]) {
      if (r.week_start !== w || !rq(r)) continue
      const z = m.get(r.rater_id) ?? {
        rater_id: r.rater_id,
        rater_group: r.rater_group,
        labels: 0,
        rework_labels: 0,
        handle_seconds: 0,
        gold_labels: 0,
        gold_correct: 0,
        label_pairs: 0,
        agree_pairs: 0,
      }
      z.labels += r.labels
      z.rework_labels += r.rework_labels
      z.handle_seconds += r.handle_seconds
      z.gold_labels += r.gold_labels
      z.gold_correct += r.gold_correct
      z.label_pairs += r.label_pairs
      z.agree_pairs += r.agree_pairs
      m.set(r.rater_id, z)
    }
    return [...m.values()].filter((r) => r.labels > 0)
  }
  const rCur = useMemo(() => raters(wk), [data, wk, s.rq])
  const rPrev = useMemo(() => raters(prevWk), [data, prevWk, s.rq])
  const low = (r: RaterRow) => r.gold_labels >= LOW_MIN_GOLD && r.gold_correct / r.gold_labels < LOW_ACC
  const perHour = (r: RaterRow) => (r.handle_seconds > 0 ? r.labels / (r.handle_seconds / 3600) : 0)

  const weekBatches = (w: string) => ((data.weekly_batch ?? []) as WeeklyBatch[]).filter((b) => b.week_start === w)
  const riskCur = riskIds(weekBatches(wk), teamPace(data, wk))
  const riskPrev = riskIds(weekBatches(prevWk), teamPace(data, prevWk))
  const bCur = weekBatches(wk).filter(rq)
  const bPrev = weekBatches(prevWk).filter(rq)
  const atRisk = (b: WeeklyBatch) => (b.week_start === wk ? riskCur : riskPrev).has(b.batch_id)
  const prog = (bs: WeeklyBatch[]) =>
    ratio(
      bs.reduce((a, b) => a + b.done_tasks, 0),
      bs.reduce((a, b) => a + b.target_tasks, 0),
    )
  const doneCur = bCur.reduce((a, b) => a + b.done_tasks, 0)
  const targetCur = bCur.reduce((a, b) => a + b.target_tasks, 0)
  const hasPrev = byWeek.has(prevWk)
  const vs = hasPrev ? '전주 대비' : '전기 없음'

  const trendWeeks = weeks.filter((w) => w <= wk).slice(-12)
  const groupWeek = useMemo(
    () => groupSum(ops, (r) => `${r.week_start}|${r.rater_group}`, ['labels']),
    [ops],
  )
  const quality = trendWeeks.map((w) => {
    const t = byWeek.get(w) ?? zero
    return { date: w, acc: acc(t), agree: agree(t), kappa: kappa(t) }
  })
  const volume = trendWeeks.map((w) => ({
    date: w,
    internal: groupWeek.get(`${w}|internal`)?.labels ?? 0,
    vendor: groupWeek.get(`${w}|vendor`)?.labels ?? 0,
  }))
  const marks = trendWeeks.includes(GUIDELINE_V2) ? [{ x: GUIDELINE_V2, label: '평가 지침 개정' }] : []

  const byGuide = groupSum(
    ops.filter((r) => r.week_start <= wk),
    (r) => r.guideline_version,
    [...OPS_KEYS],
  )
  const guideRows = (['v1', 'v2'] as const).filter((g) => byGuide.has(g)).map((g) => ({ g, t: byGuide.get(g)! }))

  const bCols: Col<WeeklyBatch>[] = [
    { key: 'id', label: '배치', value: (b) => b.batch_id },
    { key: 'rq', label: '요청', value: (b) => REQUESTER[b.requester] ?? b.requester },
    { key: 'purpose', label: '목적', value: (b) => PURPOSE[b.purpose] ?? b.purpose },
    { key: 'due', label: '마감', value: (b) => b.due_date, render: (b) => md(b.due_date), num: true },
    { key: 'target', label: '목표', value: (b) => b.target_tasks, render: (b) => num(b.target_tasks), num: true },
    { key: 'done', label: '완료', value: (b) => b.done_tasks, render: (b) => num(b.done_tasks), num: true },
    {
      key: 'prog',
      label: '진척률',
      value: (b) => ratio(b.done_tasks, b.target_tasks),
      render: (b) => {
        const v = ratio(b.done_tasks, b.target_tasks) ?? 0
        return (
          <span className="inline-flex items-center justify-end gap-2">
            <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-wash sm:inline-block">
              <span className="block h-full rounded-full" style={{ width: `${v * 100}%`, background: status(b, riskCur).color ?? 'var(--s1)' }} />
            </span>
            {pct(v, 0)}
          </span>
        )
      },
      num: true,
    },
    { key: 'left', label: '남은 과제', value: (b) => b.remaining_tasks, render: (b) => num(b.remaining_tasks), num: true },
    {
      key: 'state',
      label: '상태',
      value: (b) => (b.remaining_tasks <= 0 ? 3 : atRisk(b) ? 0 : 2),
      render: (b) => {
        const st = status(b, riskCur)
        return (
          <span className="font-medium" style={{ color: st.color }}>
            {st.text}
          </span>
        )
      },
      num: true,
    },
  ]

  const rCols: Col<RaterRow>[] = [
    { key: 'id', label: '평가자', value: (r) => r.rater_id },
    { key: 'group', label: '그룹', value: (r) => RATER_GROUP[r.rater_group] ?? r.rater_group },
    { key: 'labels', label: '라벨', value: (r) => r.labels, render: (r) => num(r.labels), num: true },
    { key: 'speed', label: '시간당 처리', value: perHour, render: (r) => num(perHour(r)), num: true },
    {
      key: 'acc',
      label: '정답셋 정확도',
      value: (r) => ratio(r.gold_correct, r.gold_labels),
      render: (r) => (
        <span style={{ color: low(r) ? 'var(--bad)' : undefined }} className={low(r) ? 'font-medium' : ''}>
          {pct(ratio(r.gold_correct, r.gold_labels))}
        </span>
      ),
      num: true,
    },
    { key: 'gold', label: '정답셋 라벨', value: (r) => r.gold_labels, render: (r) => num(r.gold_labels), num: true },
    { key: 'agree', label: '일치율', value: (r) => ratio(r.agree_pairs, r.label_pairs), render: (r) => pct(ratio(r.agree_pairs, r.label_pairs)), num: true },
    { key: 'rework', label: '재작업률', value: (r) => ratio(r.rework_labels, r.labels), render: (r) => pct(ratio(r.rework_labels, r.labels)), num: true },
  ]
  const points = rCur
    .filter((r) => r.gold_labels > 0)
    .map((r) => ({
      id: r.rater_id,
      x: perHour(r),
      y: r.gold_correct / r.gold_labels,
      color: r.rater_group === 'internal' ? S(2) : S(1),
      ring: low(r) ? 'var(--bad)' : undefined,
      label: `${r.rater_id} · ${RATER_GROUP[r.rater_group]}`,
      detail: `${num(r.labels)}건`,
    }))

  const nRaters = rCur.length
  const nPrev = rPrev.length

  if (!weeks.length)
    return (
      <Card title="평가 운영">
        <Empty />
      </Card>
    )

  return (
    <div className="flex flex-col gap-4">
      <TileRow title={`진척 · ${md(wk)} 주 · ${vs}`} cols="lg:grid-cols-3">
        <Tile
          metricId="L02"
          label="목표 대비 진척률"
          value={pct(prog(bCur), 0)}
          sub={`과제 ${num(doneCur)} / ${num(targetCur)}`}
          delta={rel(prog(bCur), prog(bPrev), true)}
        />
        <Tile metricId="L12" label="완료 과제" value={num(cur.tasks_completed)} unit="건" delta={rel(cur.tasks_completed, prev.tasks_completed)} />
        <Tile
          metricId="L03"
          label="마감 위험 배치"
          value={num(bCur.filter(atRisk).length)}
          unit="개"
          sub={`진행 배치 ${num(bCur.filter((b) => b.remaining_tasks > 0).length)}개 중`}
          delta={diff(bCur.filter(atRisk).length, hasPrev ? bPrev.filter(atRisk).length : null, '개')}
        />
      </TileRow>
      <TileRow title="생산성" cols="lg:grid-cols-4">
        <Tile metricId="L01" label="라벨 수" value={num(cur.labels)} unit="건" delta={rel(cur.labels, prev.labels)} />
        <Tile metricId="L04" label="활동 평가자" value={num(nRaters)} unit="명" delta={diff(nRaters, hasPrev ? nPrev : null, '명')} />
        <Tile
          metricId="L05"
          label="평가자당 라벨 수"
          value={num(ratio(cur.labels, nRaters))}
          unit="건"
          delta={rel(ratio(cur.labels, nRaters), ratio(prev.labels, nPrev))}
        />
        <Tile metricId="L06" label="건당 처리 시간" value={dec(perLabel(cur), 1)} unit="초" delta={rel(perLabel(cur), perLabel(prev), false, false)} />
      </TileRow>
      <TileRow title="품질" cols="lg:grid-cols-5">
        <Tile metricId="L07" label="정답셋 정확도" value={pct(acc(cur))} sub={`정답셋 ${num(cur.gold_labels)}건`} delta={rel(acc(cur), acc(prev), true)} />
        <Tile metricId="L08" label="평가자 간 일치율" value={pct(agree(cur))} delta={rel(agree(cur), agree(prev), true)} />
        <Tile metricId="L09" label="일치도 카파" value={dec(kappa(cur), 2)} delta={diff(kappa(cur), kappa(prev), '', 2)} />
        <Tile metricId="L10" label="재작업률" value={pct(rework(cur))} delta={rel(rework(cur), rework(prev), true)} />
        <Tile
          metricId="L11"
          label="기준 미달 평가자"
          value={num(rCur.filter(low).length)}
          unit="명"
          sub={`정확도 ${pct(LOW_ACC, 0)} 미만`}
          delta={diff(rCur.filter(low).length, hasPrev ? rPrev.filter(low).length : null, '명')}
        />
      </TileRow>

      <Card title="배치 진척" metricId="L02" meta={`${md(wk)} 주 말 기준`}>
        {bCur.length ? (
          <DataTable cols={bCols} rows={bCur} sortKey="state" rowKey={(b) => b.batch_id} minW="min-w-[720px]" />
        ) : (
          <Empty h={120} />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="품질 추이"
          meta="주별"
          right={
            <Legend
              items={[
                { label: '정확도', color: S(1), kind: 'line' },
                { label: '일치율', color: S(2), kind: 'line' },
                { label: '카파', color: S(3), kind: 'line' },
              ]}
            />
          }
        >
          <TimeChart
            data={quality}
            kind="line"
            series={[
              { key: 'acc', label: '정확도', color: S(1) },
              { key: 'agree', label: '일치율', color: S(2) },
              { key: 'kappa', label: '카파', color: S(3) },
            ]}
            yFormat={(v) => dec(v, 1)}
            valueFormat={(v) => dec(v, 3)}
            tipTitle={(d) => `${d} 주`}
            marks={marks}
            yDomain={[0.4, 1]}
            decimals
          />
        </Card>
        <Card
          title="라벨 수"
          meta="주별"
          right={
            <Legend
              items={[
                { label: '내부', color: S(2) },
                { label: '외부', color: S(1) },
              ]}
            />
          }
        >
          <TimeChart
            data={volume}
            kind="stack"
            series={[
              { key: 'vendor', label: '외부', color: S(1) },
              { key: 'internal', label: '내부', color: S(2) },
            ]}
            tipTitle={(d) => `${d} 주`}
            marks={marks}
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <Card
          title="처리 속도 × 정확도"
          meta={`${md(wk)} 주`}
          right={
            <Legend
              items={[
                { label: '내부', color: S(2) },
                { label: '외부', color: S(1) },
                { label: '기준 미달', color: 'var(--bad)', kind: 'ring' },
              ]}
            />
          }
        >
          {points.length ? (
            <ScatterPlot points={points} xLabel="시간당 처리" yLabel="정답셋 정확도" yRef={LOW_ACC} />
          ) : (
            <Empty h={280} />
          )}
        </Card>
        <Card title="평가자" metricId="L11" meta={`${md(wk)} 주`}>
          {rCur.length ? (
            <DataTable cols={rCols} rows={rCur} sortKey="labels" rowKey={(r) => r.rater_id} minW="min-w-[640px]" />
          ) : (
            <Empty h={120} />
          )}
        </Card>
      </div>

      <Card
        title="평가 지침 개정 전 · 후"
        metricId="L09"
        meta={`${md(wk)} 주까지 누적`}
        right={<ReportLink s={s} set={set} id="guide-v2" label="개선 보고서 보기" />}
      >
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-axis text-muted">
                <th className="py-2 text-left font-medium">지침</th>
                <th className="py-2 pr-3 text-right font-medium">라벨</th>
                <th className="py-2 pr-3 text-right font-medium">정답셋 정확도</th>
                <th className="py-2 pr-3 text-right font-medium">일치율</th>
                <th className="py-2 pr-3 text-right font-medium">카파</th>
                <th className="py-2 pr-3 text-right font-medium">건당 처리 시간</th>
                <th className="py-2 text-right font-medium">재작업률</th>
              </tr>
            </thead>
            <tbody>
              {guideRows.map(({ g, t }) => (
                <tr key={g} className="border-b border-line">
                  <td className="py-2 text-ink2">{g === 'v1' ? '개정 전 (v1)' : '개정 후 (v2)'}</td>
                  <td className="tnum py-2 pr-3 text-right text-ink">{num(t.labels)}</td>
                  <td className="tnum py-2 pr-3 text-right text-ink">{pct(acc(t))}</td>
                  <td className="tnum py-2 pr-3 text-right text-ink">{pct(agree(t))}</td>
                  <td className="tnum py-2 pr-3 text-right text-ink">{dec(kappa(t), 2)}</td>
                  <td className="tnum py-2 pr-3 text-right text-ink">{dec(perLabel(t), 1)}초</td>
                  <td className="tnum py-2 text-right text-ink">{pct(rework(t))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
