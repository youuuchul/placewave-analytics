import type { ReactNode } from 'react'
import { addDays, addMonths, md, mdPad } from '../lib/date'
import type { Range } from '../lib/agg'
import type { Preset, State } from '../lib/state'
import { Segmented, Select } from './ui'

const PRESETS: { value: Preset; label: string }[] = [
  { value: '1', label: '1일' },
  { value: '7', label: '7일' },
  { value: '28', label: '28일' },
  { value: '90', label: '90일' },
  { value: '365', label: '1년' },
  { value: 'custom', label: '직접' },
]

function Line({ children }: { children: ReactNode }) {
  return (
    <div className="scrollbar-none flex h-12 items-center gap-4 overflow-x-auto whitespace-nowrap px-4 sm:px-6">
      {children}
    </div>
  )
}

function Stepper({ onPrev, onNext, prevOk, nextOk, children }: {
  onPrev: () => void
  onNext: () => void
  prevOk: boolean
  nextOk: boolean
  children: ReactNode
}) {
  const btn = 'flex h-8 w-8 items-center justify-center rounded-lg bg-wash text-ink2 hover:text-ink disabled:opacity-30'
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" aria-label="이전" className={btn} disabled={!prevOk} onClick={onPrev}>
        ‹
      </button>
      {children}
      <button type="button" aria-label="다음" className={btn} disabled={!nextOk} onClick={onNext}>
        ›
      </button>
    </div>
  )
}

export function PeriodLine({
  s,
  set,
  range,
  min,
  max,
  extra,
}: {
  s: State
  set: (p: Partial<State>) => void
  range: Range
  min: string
  max: string
  extra?: { value: Preset; label: string }
}) {
  const presets = extra ? [...PRESETS, extra] : PRESETS
  const dateCls = 'ctl tnum h-8 rounded-lg border-0 bg-wash px-2 text-[13px] text-ink outline-none'
  return (
    <Line>
      <Segmented
        options={presets}
        value={s.p}
        onChange={(p) => {
          if (p === 'custom') set({ p, from: range.from, to: range.to })
          else if (p === '1') set({ p, d: range.to })
          else set({ p })
        }}
      />
      {s.p === '1' && (
        <Stepper
          prevOk={range.from > min}
          nextOk={range.to < max}
          onPrev={() => set({ d: addDays(range.from, -1) })}
          onNext={() => set({ d: addDays(range.from, 1) })}
        >
          <input
            type="date"
            className={dateCls}
            min={min}
            max={max}
            value={range.from}
            onChange={(e) => e.target.value && set({ d: e.target.value })}
          />
        </Stepper>
      )}
      {s.p === 'custom' && (
        <div className="flex shrink-0 items-center gap-1.5 text-muted">
          <input
            type="date"
            className={dateCls}
            min={min}
            max={max}
            value={range.from}
            onChange={(e) => e.target.value && set({ from: e.target.value, to: range.to })}
          />
          ~
          <input
            type="date"
            className={dateCls}
            min={min}
            max={max}
            value={range.to}
            onChange={(e) => e.target.value && set({ to: e.target.value, from: range.from })}
          />
        </div>
      )}
      <span className="tnum ml-auto shrink-0 pl-2 text-xs text-muted">
        {range.oneDay
          ? range.from
          : `${range.from} ~ ${range.from.slice(0, 4) === range.to.slice(0, 4) ? mdPad(range.to) : range.to} · ${range.days}일`}
      </span>
    </Line>
  )
}

export function WeekLine({
  weeks,
  value,
  onChange,
}: {
  weeks: string[]
  value: string
  onChange: (w: string) => void
}) {
  const i = weeks.indexOf(value)
  return (
    <Line>
      <span className="text-xs text-muted">주차</span>
      <Stepper
        prevOk={i > 0}
        nextOk={i < weeks.length - 1}
        onPrev={() => onChange(weeks[i - 1])}
        onNext={() => onChange(weeks[i + 1])}
      >
        <Select
          value={value}
          width="w-48"
          onChange={onChange}
          options={[...weeks].reverse().map((w) => ({ value: w, label: `${w} ~ ${md(addDays(w, 6))}` }))}
        />
      </Stepper>
    </Line>
  )
}

export function MonthLine({
  months,
  value,
  onChange,
  partialTo,
}: {
  months: string[]
  value: string
  onChange: (m: string) => void
  partialTo?: string
}) {
  const i = months.indexOf(value)
  return (
    <Line>
      <span className="text-xs text-muted">월</span>
      <Stepper
        prevOk={i > 0}
        nextOk={i < months.length - 1}
        onPrev={() => onChange(months[i - 1])}
        onNext={() => onChange(months[i + 1])}
      >
        <Select
          value={value}
          width="w-44"
          onChange={onChange}
          options={[...months].reverse().map((m) => ({
            value: m,
            label:
              partialTo && partialTo.startsWith(m) ? `${m} (${md(partialTo)}까지)` : `${m}`,
          }))}
        />
      </Stepper>
      <span className="tnum ml-auto shrink-0 pl-2 text-xs text-muted">
        전월 {addMonths(value, -1)}
      </span>
    </Line>
  )
}

export function SegmentLine({ children }: { children: ReactNode }) {
  return <Line>{children}</Line>
}

export function SegmentControls({ s, set }: { s: State; set: (p: Partial<State>) => void }) {
  return (
    <>
      <Segmented
        label="채널"
        value={s.ch}
        onChange={(ch) => set({ ch })}
        options={[
          { value: 'all', label: '전체' },
          { value: 'paid', label: '유료' },
          { value: 'non_paid', label: '비유료' },
        ]}
      />
      <Segmented
        label="플랫폼"
        value={s.pf}
        onChange={(pf) => set({ pf })}
        options={[
          { value: 'all', label: '전체' },
          { value: 'ios', label: 'iOS' },
          { value: 'android', label: 'Android' },
          { value: 'web', label: '웹' },
        ]}
      />
      <Segmented
        label="회원"
        value={s.ms}
        onChange={(ms) => set({ ms })}
        options={[
          { value: 'all', label: '전체' },
          { value: 'member', label: '회원' },
          { value: 'guest', label: '비회원' },
        ]}
      />
    </>
  )
}
