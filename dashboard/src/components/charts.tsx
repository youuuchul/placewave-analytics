import { useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { md } from '../lib/date'
import { compact, num, pct } from '../lib/format'

export interface Series {
  key: string
  label: string
  color: string
}

type Row = Record<string, number | string | null>

function TipBox({
  title,
  rows,
  total,
}: {
  title: string
  rows: { label: string; color: string; value: string }[]
  total?: string
}) {
  return (
    <div className="card pointer-events-none min-w-[150px] px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-medium text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-1.5 text-ink2">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: r.color }} />
            {r.label}
          </span>
          <span className="tnum font-medium text-ink">{r.value}</span>
        </div>
      ))}
      {total && (
        <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1">
          <span className="text-ink2">합계</span>
          <span className="tnum font-medium text-ink">{total}</span>
        </div>
      )}
    </div>
  )
}

export function TimeChart({
  data,
  series,
  kind,
  height = 260,
  xKey = 'date',
  xFormat,
  yFormat = compact,
  valueFormat = num,
  tipTitle,
  decimals = false,
  marks = [],
  yDomain,
}: {
  data: Row[]
  series: Series[]
  kind: 'line' | 'bar' | 'stack' | 'area'
  height?: number
  xKey?: string
  xFormat?: (v: string | number) => string
  yFormat?: (v: number) => string
  valueFormat?: (v: number) => string
  tipTitle?: (v: string | number) => string
  decimals?: boolean
  marks?: { x: string; label: string }[]
  yDomain?: [number, number]
}) {
  const fx = xFormat ?? ((v: string | number) => (typeof v === 'string' ? md(v) : String(v)))
  const ft = tipTitle ?? ((v: string | number) => (typeof v === 'string' ? v : String(v)))
  const bars = kind === 'bar' || kind === 'stack'
  // x축: 라벨 8개 안팎을 고정 간격으로 (마지막 라벨을 억지로 넣지 않는다)
  const xStep = Math.max(0, Math.ceil(data.length / 8) - 1)
  // y축: 가장 긴 눈금 글자에 맞춰 폭을 잡는다
  const yMax = data.reduce((m, r) => {
    const v = kind === 'stack' ? series.reduce((a, s) => a + Number(r[s.key] ?? 0), 0) : Math.max(...series.map((s) => Number(r[s.key] ?? 0)))
    return Math.max(m, Number.isFinite(v) ? v : 0)
  }, 0)
  const yWidth = Math.max(36, Math.ceil(yFormat(yDomain?.[1] ?? yMax).length * 7 + 10))
  // 사건 표식: 가까운 표식끼리는 이름을 위아래로 엇갈린다
  const xs = data.map((r) => String(r[xKey]))
  const near = Math.max(2, Math.round(data.length * 0.12))
  let last = -Infinity
  let lane = 0
  const placed = [...marks]
    .map((m) => ({ ...m, i: xs.indexOf(m.x) }))
    .sort((a, b) => a.i - b.i)
    .map((m) => {
      lane = m.i - last < near ? (lane + 1) % 2 : 0
      last = m.i
      return { ...m, dy: lane * 14 }
    })
  return (
    <div style={{ height }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
          <XAxis
            dataKey={xKey}
            tickFormatter={fx}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--axis)' }}
            interval={xStep}
          />
          <YAxis
            tickFormatter={yFormat}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={yWidth}
            allowDecimals={decimals}
            domain={yDomain ?? [0, 'auto']}
          />
          <Tooltip
            cursor={bars ? { fill: 'var(--wash)' } : { stroke: 'var(--axis)', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const rows = series.map((s) => ({
                label: s.label,
                color: s.color,
                value: (payload[0].payload as Row)[s.key] == null ? '—' : valueFormat(Number((payload[0].payload as Row)[s.key])),
              }))
              const total =
                kind === 'stack' && series.length > 1
                  ? valueFormat(series.reduce((a, s) => a + Number((payload[0].payload as Row)[s.key] ?? 0), 0))
                  : undefined
              return <TipBox title={ft(label as string)} rows={[...rows].reverse()} total={total} />
            }}
          />
          {placed.map((m) => (
            <ReferenceLine
              key={m.x}
              x={m.x}
              stroke="var(--axis)"
              strokeDasharray="3 3"
              label={{ value: m.label, position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 11, dy: m.dy }}
            />
          ))}
          {series.map((s, i) => {
            if (kind === 'line')
              return (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={data.length <= 14 ? { r: 4, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 } : false}
                  activeDot={{ r: 5, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 }}
                  isAnimationActive={false}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )
            if (kind === 'area')
              return (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.1}
                  dot={false}
                  activeDot={{ r: 4, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              )
            const top = kind === 'bar' || i === series.length - 1
            return (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={s.color}
                stackId={kind === 'stack' ? 'a' : undefined}
                maxBarSize={24}
                radius={top ? [4, 4, 0, 0] : 0}
                stroke={kind === 'stack' ? 'var(--surface)' : undefined}
                strokeWidth={kind === 'stack' ? 1 : 0}
                isAnimationActive={false}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Heatmap({
  cols,
  rows,
  format,
  head,
  headLabel,
  rowLabelWidth = 64,
  tip,
  minCell = 28,
}: {
  cols: string[]
  rows: { label: string; head?: string; cells: (number | null)[] }[]
  format: (v: number) => string
  head?: boolean
  headLabel?: string
  rowLabelWidth?: number
  tip?: (r: number, c: number, v: number) => string
  minCell?: number
}) {
  const [hover, setHover] = useState<[number, number] | null>(null)
  let max = 0
  for (const r of rows) for (const v of r.cells) if (v != null && v > max) max = v
  const template = `${rowLabelWidth}px ${head ? '56px ' : ''}repeat(${cols.length}, minmax(${minCell}px, 1fr))`
  return (
    <div className="overflow-x-auto">
      <div className="min-w-fit">
        <div className="grid gap-[2px] text-[11px]" style={{ gridTemplateColumns: template }}>
          <div />
          {head && <div className="px-1 pb-1 text-right text-muted">{headLabel}</div>}
          {cols.map((c, ci) => (
            <div
              key={c}
              className={`pb-1 text-center ${hover && hover[1] === ci ? 'font-semibold text-ink' : 'text-muted'}`}
            >
              {c}
            </div>
          ))}
          {rows.map((r, ri) => (
            <Row key={r.label}>
              <div
                className={`tnum flex items-center pr-2 ${hover && hover[0] === ri ? 'font-semibold text-ink' : 'text-ink2'}`}
              >
                {r.label}
              </div>
              {head && <div className="tnum flex items-center justify-end px-1 text-ink2">{r.head}</div>}
              {r.cells.map((v, ci) => {
                if (v == null) return <div key={ci} className="h-7 rounded-[3px]" />
                const t = max > 0 ? v / max : 0
                const p = Math.round(t * 100)
                return (
                  <div
                    key={ci}
                    title={tip ? tip(ri, ci, v) : undefined}
                    onMouseEnter={() => setHover([ri, ci])}
                    onMouseLeave={() => setHover(null)}
                    className="tnum flex h-7 items-center justify-center rounded-[3px] outline-offset-1 hover:outline hover:outline-2 hover:outline-[var(--ink)]"
                    style={{
                      background: `color-mix(in oklab, var(--seq-hi) ${p}%, var(--seq-lo))`,
                      color: p > 55 ? 'var(--seq-ink-hi)' : 'var(--seq-ink-lo)',
                    }}
                  >
                    {format(v)}
                  </div>
                )
              })}
            </Row>
          ))}
        </div>
      </div>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const first = steps[0]?.value ?? 0
  const w = (v: number) => (first > 0 ? Math.min(1, v / first) : 0)
  return (
    <div className="flex flex-col">
      <div className="mb-1.5 grid grid-cols-[88px_1fr_72px] gap-3 text-[11px] text-muted sm:grid-cols-[112px_1fr_88px]">
        <span />
        <span>첫 단계 대비</span>
        <span className="text-right">명</span>
      </div>
      {steps.map((s, i) => {
        const prev = i === 0 ? null : steps[i - 1].value
        const conv = prev == null ? null : prev > 0 ? s.value / prev : 0
        const drop = prev == null ? 0 : Math.max(0, prev - s.value)
        const cur = w(s.value)
        const before = prev == null ? cur : w(prev)
        const share = first > 0 ? s.value / first : 0
        const tip =
          prev == null
            ? `${s.label} ${num(s.value)}명 · 기준`
            : `${s.label} ${num(s.value)}명 · 첫 단계 대비 ${pct(share)} · 이전 단계 대비 ${pct(conv ?? 0)} · 이탈 ${num(drop)}명`
        return (
          <div key={s.label}>
            {conv != null && (
              <div className="grid grid-cols-[88px_1fr_72px] gap-3 sm:grid-cols-[112px_1fr_88px]">
                <span />
                <span className="tnum flex items-center gap-1.5 py-1 text-[11px] text-muted">
                  <span aria-hidden>↓</span>
                  <span className="font-medium text-ink2">{pct(conv)}</span>
                  <span>전환 · 이탈 {num(drop)}명</span>
                </span>
                <span />
              </div>
            )}
            <div
              title={tip}
              className="group grid grid-cols-[88px_1fr_72px] items-center gap-3 text-[13px] sm:grid-cols-[112px_1fr_88px]"
            >
              <span className="truncate text-ink2">{s.label}</span>
              <div className="relative h-7 rounded-[4px] bg-[var(--bar-wash)]">
                {prev != null && before > cur && (
                  <div
                    className="absolute inset-y-0 rounded-r-[4px] opacity-60"
                    style={{
                      left: `${cur * 100}%`,
                      width: `${(before - cur) * 100}%`,
                      background:
                        'repeating-linear-gradient(135deg, var(--axis) 0 2px, transparent 2px 6px)',
                    }}
                  />
                )}
                <div
                  className="absolute inset-y-0 left-0 rounded-[4px] bg-[var(--s1)] transition-opacity group-hover:opacity-90"
                  style={{ width: `${Math.max(cur * 100, cur > 0 ? 0.8 : 0)}%` }}
                />
                <span
                  className="tnum absolute inset-y-0 flex items-center text-xs font-medium"
                  style={cur > 0.18 ? { left: 8, color: '#fff' } : { left: `calc(${cur * 100}% + 6px)`, color: 'var(--ink)' }}
                >
                  {i === 0 ? '100%' : pct(share)}
                </span>
              </div>
              <span className="tnum text-right font-medium text-ink">{num(s.value)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function BarList({
  items,
  format = num,
}: {
  items: { label: string; value: number; color?: string }[]
  format?: (v: number) => string
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="flex flex-col gap-2">
      {items.map((i) => (
        <div key={i.label} className="grid grid-cols-[120px_1fr_64px] items-center gap-3 text-[13px]">
          <span className="inline-flex items-center gap-1.5 truncate text-ink2">
            {i.color && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: i.color }} />}
            {i.label}
          </span>
          <div className="h-5">
            <div
              className="h-full rounded-r-[4px]"
              style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? 'var(--s1)' }}
            />
          </div>
          <span className="tnum text-right text-ink">{format(i.value)}</span>
        </div>
      ))}
    </div>
  )
}

export interface Point {
  id: string
  x: number
  y: number
  color: string
  /** 기준 미달 등 강조할 점의 테두리 색 */
  ring?: string
  label: string
  detail: string
}

/** 평가자 산점도처럼 점 수십 개를 두 지표 축에 놓는다. 기준선(yRef)은 점선. */
export function ScatterPlot({
  points,
  xLabel,
  yLabel,
  xFormat = num,
  yFormat = (v: number) => pct(v, 0),
  yRef,
  height = 280,
}: {
  points: Point[]
  xLabel: string
  yLabel: string
  xFormat?: (v: number) => string
  yFormat?: (v: number) => string
  yRef?: number
  height?: number
}) {
  const ys = points.map((p) => p.y)
  const lo = Math.max(0, Math.floor((Math.min(...ys, yRef ?? 1) - 0.05) * 20) / 20)
  return (
    <div style={{ height }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeWidth={1} />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            tickFormatter={xFormat}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--axis)' }}
            label={{ value: xLabel, position: 'insideBottom', offset: -10, fill: 'var(--muted)', fontSize: 11 }}
            domain={['auto', 'auto']}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            tickFormatter={yFormat}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
            domain={[lo, 1]}
          />
          {yRef != null && <ReferenceLine y={yRef} stroke="var(--bad)" strokeDasharray="3 3" />}
          <Tooltip
            cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as Point
              return (
                <TipBox
                  title={p.label}
                  rows={[
                    { label: xLabel, color: p.color, value: xFormat(p.x) },
                    { label: yLabel, color: p.color, value: yFormat(p.y) },
                    { label: '라벨', color: p.color, value: p.detail },
                  ]}
                />
              )
            }}
          />
          <Scatter
            data={points}
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number; payload?: Point }) => (
              <circle
                cx={props.cx}
                cy={props.cy}
                r={props.payload?.ring ? 7 : 6}
                fill={props.payload?.color}
                stroke={props.payload?.ring ?? 'var(--surface)'}
                strokeWidth={props.payload?.ring ? 3 : 2}
              />
            )}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

