import { useMemo, useRef, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Range } from '../lib/agg'
import { addDays, addMonths, eachDay, md } from '../lib/date'
import { compact, won } from '../lib/format'
import { GMV_COLOR, REVENUE_KINDS } from '../lib/labels'
import { type DayRevenue, revenueByDay } from '../lib/revenue'
import type { DailyRevenue } from '../lib/types'
import MetricHelp from './MetricHelp'
import { type Bucket, DeltaMark, GRAIN_LABEL, MiniSeg, autoGrain, axisStep, axisWidth, buckets, change } from './TrendCard'

type Grain = 'auto' | 'day' | 'week' | 'month'

interface Point extends DayRevenue {
  i: number
  x: string
  total: number
  prev: number | null
}

/**
 * 매출 구성 추이 카드 — 플랫폼 매출(수수료·멤버십·파트너 플랜) 누적 막대 + 거래액 보조선(오른쪽 축)
 * + 전기 플랫폼 매출 점선 + 분해 타일. 매출 마트에는 세그먼트 축이 없어 세그먼트 상태를 받지 않는다.
 * tiles = false 면 분해 타일 없이 차트만 그린다(같은 값을 스코어보드가 보여 주는 탭).
 */
export default function RevenueCard({
  rows,
  range,
  dataFrom,
  dataTo,
  onDrill,
  tiles: withTiles = true,
  title = '매출 구성',
  gmv: withGmv = true,
}: {
  rows?: DailyRevenue[]
  range: Range
  dataFrom: string
  dataTo: string
  onDrill: (p: { p: '1'; d: string } | { p: 'custom'; from: string; to: string }) => void
  tiles?: boolean
  title?: string
  /** false 면 거래액 선·오른쪽 축·타일 없이 플랫폼 매출 구성만 그린다(개요). */
  gmv?: boolean
}) {
  const [pick, setPick] = useState<Grain>('auto')
  const hoverIdx = useRef<number | null>(null)
  const byDay = useMemo(() => revenueByDay(rows ?? []), [rows])
  const hasPrev = range.prevFrom >= dataFrom

  const auto = autoGrain(range)
  const monthCount = range.oneDay ? 1 : buckets(range, 'month').length
  const grainOk = { day: !range.oneDay, week: range.days >= 8, month: monthCount >= 2 }
  const grain = pick === 'auto' || !grainOk[pick] ? auto : pick
  const chartable = grain !== 'hour'
  const sumOf = (z: DayRevenue) => z.fee + z.membership + z.plan

  const sumSpan = (a: string, b: string): DayRevenue => {
    const z = { fee: 0, membership: 0, plan: 0, gmv: 0 }
    for (const d of eachDay(a, b)) {
      const v = byDay.get(d)
      if (v) {
        z.fee += v.fee
        z.membership += v.membership
        z.plan += v.plan
        z.gmv += v.gmv
      }
    }
    return z
  }

  const series = useMemo((): { points: Point[]; bks: Bucket[] } => {
    if (!chartable) return { points: [], bks: [] }
    const bks = buckets(range, grain as 'day' | 'week' | 'month')
    const points = bks.map((b, i) => {
      const c = sumSpan(b.from, b.to)
      const p = sumSpan(addDays(b.from, -range.days), addDays(b.to, -range.days))
      return {
        i,
        x: b.label,
        ...c,
        total: sumOf(c),
        prev: hasPrev ? sumOf(p) : null,
      }
    })
    return { points, bks }
  }, [byDay, grain, range.from, range.to, range.days, hasPrev, chartable])

  const cur = sumSpan(range.from, range.to)
  const prev = hasPrev ? sumSpan(range.prevFrom, range.prevTo) : null
  const tiles = [
    { label: '플랫폼 매출', cur: sumOf(cur), prev: prev ? sumOf(prev) : null, color: '', line: false, id: 'M01' },
    ...REVENUE_KINDS.map((k) => ({
      label: k.label,
      cur: cur[k.key],
      prev: prev ? prev[k.key] : null,
      color: k.color,
      line: false,
      id: k.metricId,
    })),
    ...(withGmv ? [{ label: '거래액', cur: cur.gmv, prev: prev ? prev.gmv : null, color: GMV_COLOR, line: true, id: 'M09' }] : []),
  ]

  const spanOf = (a: string, b: string) =>
    a === b ? md(a) : a.slice(0, 4) === b.slice(0, 4) ? `${md(a)}~${md(b)}` : `${a}~${b}`
  const meta = `${chartable ? GRAIN_LABEL[grain] + ' · ' : ''}${spanOf(range.from, range.to)} · ${
    hasPrev ? `전기 ${spanOf(range.prevFrom, range.prevTo)}` : '전기 없음'
  }`

  const drill = (i: number) => {
    const b = series.bks[i]
    if (!b) return
    if (grain === 'day') onDrill({ p: '1', d: b.from })
    else if (grain === 'week') onDrill({ p: 'custom', from: b.from, to: b.to })
    else {
      const m = b.from.slice(0, 7)
      const start = `${m}-01`
      const end = addDays(`${addMonths(m, 1)}-01`, -1)
      onDrill({ p: 'custom', from: start < dataFrom ? dataFrom : start, to: end > dataTo ? dataTo : end })
    }
  }

  return (
    <section className="card flex min-w-0 flex-col p-4 sm:p-5">
      <header className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="flex items-center text-[15px] font-semibold text-ink">
            {title}
            <MetricHelp id="M05" />
          </h2>
          {rows && <span className="tnum truncate text-xs text-muted">{meta}</span>}
        </div>
        {rows && !range.oneDay && (
          <MiniSeg
            label="단위"
            value={pick === 'auto' || !grainOk[pick] ? 'auto' : pick}
            onChange={setPick}
            options={[
              { value: 'auto', label: '자동' },
              { value: 'day', label: '일', disabled: !grainOk.day },
              { value: 'week', label: '주', disabled: !grainOk.week },
              { value: 'month', label: '월', disabled: !grainOk.month },
            ]}
          />
        )}
      </header>

      {!rows ? (
        <div className="flex min-h-[22px] items-center text-sm text-muted">데이터 없음</div>
      ) : (
        <div className={chartable && withTiles ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_188px]' : ''}>
          {chartable && (
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink2">
                {REVENUE_KINDS.map((k) => (
                  <span key={k.key} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: k.color }} />
                    {k.label}
                  </span>
                ))}
                {withGmv && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: GMV_COLOR }} />
                    거래액 · 오른쪽 축
                  </span>
                )}
                {hasPrev && (
                  <span className="inline-flex items-center gap-1.5">
                    <svg width="14" height="2" aria-hidden>
                      <line x1="0" y1="1" x2="14" y2="1" stroke="var(--muted)" strokeWidth="2" strokeDasharray="3 3" />
                    </svg>
                    전기 플랫폼 매출
                  </span>
                )}
              </div>
              <div className={`-ml-2 cursor-pointer ${withTiles ? 'h-[300px]' : 'h-[280px]'}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={series.points}
                    margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    barCategoryGap="22%"
                    onMouseMove={(st) => {
                      hoverIdx.current = st?.activeTooltipIndex == null ? null : Number(st.activeTooltipIndex)
                    }}
                    onMouseLeave={() => {
                      hoverIdx.current = null
                    }}
                    onClick={(st) => {
                      const i = st?.activeTooltipIndex == null ? hoverIdx.current : Number(st.activeTooltipIndex)
                      if (i != null) drill(i)
                    }}
                  >
                    <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
                    <XAxis
                      dataKey="x"
                      tick={{ fill: 'var(--muted)', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--axis)' }}
                      interval={axisStep(series.points.length)}
                    />
                    <YAxis
                      yAxisId="l"
                      tickFormatter={compact}
                      tick={{ fill: 'var(--muted)', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={axisWidth(Math.max(0, ...series.points.map((p) => Math.max(p.total, p.prev ?? 0))), compact)}
                    />
                    <YAxis
                      yAxisId="r"
                      hide={!withGmv}
                      orientation="right"
                      tickFormatter={compact}
                      tick={{ fill: 'var(--muted)', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={axisWidth(Math.max(0, ...series.points.map((p) => p.gmv)), compact)}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--wash)' }}
                      allowEscapeViewBox={{ x: false, y: false }}
                      wrapperStyle={{ zIndex: 10 }}
                      isAnimationActive={false}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const p = payload[0].payload as Point
                        const b = series.bks[p.i]
                        return (
                          <div className="card pointer-events-none min-w-[180px] px-3 py-2 text-xs shadow-lg">
                            <div className="tnum mb-1.5 font-medium text-ink">{b?.title}</div>
                            {[...REVENUE_KINDS].reverse().map((k) => (
                              <div key={k.key} className="flex items-center justify-between gap-4 py-0.5">
                                <span className="inline-flex items-center gap-1.5 text-ink2">
                                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: k.color }} />
                                  {k.label}
                                </span>
                                <span className="tnum font-medium text-ink">{won(p[k.key])}</span>
                              </div>
                            ))}
                            <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1">
                              <span className="text-ink2">플랫폼 매출</span>
                              <span className="tnum font-medium text-ink">{won(p.total)}</span>
                            </div>
                            {withGmv && (
                              <div className="flex items-center justify-between gap-4 py-0.5">
                                <span className="inline-flex items-center gap-1.5 text-ink2">
                                  <span className="inline-block h-0.5 w-2.5 rounded-full" style={{ background: GMV_COLOR }} />
                                  거래액
                                </span>
                                <span className="tnum font-medium text-ink">{won(p.gmv)}</span>
                              </div>
                            )}
                            {hasPrev && (
                              <>
                                <div className="py-0.5">
                                  <DeltaMark v={change(p.total, p.prev)} suffix="전기 대비" />
                                </div>
                                <div className="tnum py-0.5 text-muted">
                                  전기 {b?.prevTitle}: {p.prev == null ? '—' : won(p.prev)}
                                </div>
                              </>
                            )}
                          </div>
                        )
                      }}
                    />
                    {REVENUE_KINDS.map((k, i) => (
                      <Bar
                        key={k.key}
                        yAxisId="l"
                        dataKey={k.key}
                        stackId="r"
                        fill={k.color}
                        maxBarSize={28}
                        radius={i === REVENUE_KINDS.length - 1 ? [4, 4, 0, 0] : 0}
                        stroke="var(--surface)"
                        strokeWidth={1}
                        isAnimationActive={false}
                      />
                    ))}
                    <Line
                      yAxisId="r"
                      hide={!withGmv}
                      dataKey="gmv"
                      stroke={GMV_COLOR}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: GMV_COLOR, stroke: 'var(--surface)', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                    {hasPrev && (
                      <Line
                        yAxisId="l"
                        dataKey="prev"
                        stroke="var(--muted)"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        dot={false}
                        activeDot={false}
                        isAnimationActive={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {(withTiles || !chartable) && (
          <div className="self-start overflow-hidden rounded-lg border border-line">
            <div
              className={`-mb-px -mr-px grid [&>*]:border-b [&>*]:border-r [&>*]:border-line ${
                chartable ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-1' : 'grid-cols-2 sm:grid-cols-5'
              }`}
            >
              {tiles.map((t) => (
                <div key={t.label} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-xs text-ink2">
                    {t.color &&
                      (t.line ? (
                        <span className="inline-block h-0.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                      ) : (
                        <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: t.color }} />
                      ))}
                    <span className="truncate">{t.label}</span>
                    <MetricHelp id={t.id} />
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="tnum text-lg font-semibold leading-tight text-ink">{won(t.cur)}</span>
                    <span className="text-[11px] text-muted">원</span>
                  </div>
                  {hasPrev && (
                    <div className="text-[11px]">
                      <DeltaMark v={change(t.cur, t.prev)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      )}
    </section>
  )
}
