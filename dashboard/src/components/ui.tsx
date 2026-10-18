import type { ReactNode } from 'react'
import { retryFailed, type Wait } from '../lib/source'
import MetricHelp from './MetricHelp'
import { useMetricSpec } from '../lib/metrics'

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {label && <span className="text-xs text-muted">{label}</span>}
      <div role="radiogroup" aria-label={label} className="flex h-8 items-center rounded-lg bg-wash p-0.5">
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={`h-7 whitespace-nowrap rounded-md px-2.5 text-[13px] transition-colors ${
                on ? 'bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--ring)]' : 'text-ink2 hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Select({
  label,
  value,
  options,
  onChange,
  width = 'w-40',
}: {
  label?: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  width?: string
}) {
  return (
    <label className="flex shrink-0 items-center gap-2">
      {label && <span className="text-xs text-muted">{label}</span>}
      <select
        className={`ctl h-8 ${width} truncate rounded-lg border-0 bg-wash pl-2.5 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export interface Delta {
  value: number | null
  goodUp?: boolean | null
  points?: boolean
  /** 비율이 아닌 지표(개수·지수)는 차이 값으로 쓴다: 단위와 소수 자릿수 */
  abs?: { unit: string; digits: number }
}

export function Tile({
  label,
  value,
  unit,
  sub,
  delta,
  wait = null,
  metricId,
}: {
  label: string
  value: string
  unit?: string
  sub?: string
  delta?: Delta
  wait?: Wait
  metricId?: string
}) {
  const spec = useMetricSpec()
  const down = metricId && spec && spec !== 'error' && spec.metrics.find((m) => m.id === metricId)?.direction === 'down'
  const d = delta && down && delta.goodUp !== null ? { ...delta, goodUp: false } : delta
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3.5">
      <div className="flex min-w-0 items-center text-[13px] text-ink2">
        <span className="truncate">{label}</span>
        {metricId && <MetricHelp id={metricId} />}
      </div>
      {wait ? (
        <div className="flex h-[33px] items-center">
          <Pending wait={wait} h={22} w="w-24" />
        </div>
      ) : (
        <div className="flex items-baseline gap-1">
          <span className="text-[26px] font-semibold leading-tight tracking-tight text-ink">{value}</span>
          {unit && value !== '—' && <span className="text-sm text-ink2">{unit}</span>}
        </div>
      )}
      <div className="flex min-h-[18px] items-center text-xs text-muted">{!wait && d && <DeltaText d={d} />}</div>
      <div className="min-h-[16px] truncate text-xs text-muted">{!wait && sub}</div>
    </div>
  )
}

/** 지연 표를 받는 동안 값 자리의 회색 바, 실패하면 한 줄. */
export function Pending({ wait, h = 240, w = 'w-full', inline = false }: { wait: Wait; h?: number; w?: string; inline?: boolean }) {
  const Tag = inline ? 'span' : 'div'
  if (wait === 'error')
    return (
      <Tag
        data-pending="error"
        className={`${inline ? 'inline-flex' : 'flex'} flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted`}
        style={inline ? undefined : { minHeight: Math.min(h, 22) }}
      >
        <span className="whitespace-nowrap">불러오지 못함</span>
        <button
          type="button"
          onClick={retryFailed}
          className="whitespace-nowrap rounded border border-line px-1.5 text-xs leading-5 text-ink2 hover:text-ink"
        >
          다시 시도
        </button>
      </Tag>
    )
  return <Tag data-pending="loading" className={`${inline ? 'inline-block align-middle' : 'block'} ${w} animate-pulse rounded-md bg-wash`} style={{ height: h }} />
}

function DeltaText({ d }: { d: Delta }) {
  if (d.value == null || !Number.isFinite(d.value)) return <span>—</span>
  const up = d.value > 0
  const flat = Math.abs(d.value) < (d.abs ? 0.5 * 10 ** -d.abs.digits : 0.0005)
  const mag = d.abs
    ? Math.abs(d.value).toFixed(d.abs.digits) + d.abs.unit
    : (Math.abs(d.value) * 100).toFixed(1) + (d.points ? '%p' : '%')
  const good = flat || d.goodUp === null ? null : up === (d.goodUp ?? true)
  const color = good == null ? 'var(--muted)' : good ? 'var(--good)' : 'var(--bad)'
  return (
    <span className="tnum whitespace-nowrap">
      <span style={{ color }} className="font-medium">
        {flat ? (d.abs ? '±' : '') : up ? '▲ ' : '▼ '}
        {mag}
      </span>
    </span>
  )
}

/** 구획 위 소제목 한 줄. 스코어보드·추이 묶음의 이름과 비교 기준을 적는다. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="-mb-2.5 px-1 text-xs font-medium text-muted">{children}</h3>
}

export function TileRow({ children, cols = 'lg:grid-cols-6', title }: { children: ReactNode; cols?: string; title?: string }) {
  const row = (
    <div className="card overflow-hidden">
      <div className={`-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 ${cols} [&>*]:border-b [&>*]:border-r [&>*]:border-line`}>
        {children}
      </div>
    </div>
  )
  if (!title) return row
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {row}
    </>
  )
}

export function Card({
  title,
  meta,
  right,
  children,
  className = '',
  wait = null,
  waitH = 240,
  metricId,
}: {
  title: string
  meta?: string
  right?: ReactNode
  children: ReactNode
  className?: string
  wait?: Wait
  waitH?: number
  metricId?: string
}) {
  return (
    <section className={`card flex min-w-0 flex-col p-4 sm:p-5 ${className}`}>
      <header className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="flex items-center text-[15px] font-semibold text-ink">
            {title}
            {metricId && <MetricHelp id={metricId} />}
          </h2>
          {meta && !wait && <span className="truncate text-xs text-muted">{meta}</span>}
        </div>
        {!wait && right}
      </header>
      {wait ? <Pending wait={wait} h={waitH} /> : children}
    </section>
  )
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'line' | 'box' | 'ring' }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.kind === 'line' ? (
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: i.color }} />
          ) : i.kind === 'ring' ? (
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: i.color }} />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  )
}

export function Empty({ h = 240 }: { h?: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-muted" style={{ height: h }}>
      해당 기간 데이터 없음
    </div>
  )
}

export function Stage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3">{children}</div>
    </div>
  )
}
