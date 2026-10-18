import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { campaignSpans, resolveRange, spanRange } from './lib/agg'
import { md } from './lib/date'
import { type State, type TabId, toHref, useUrlState } from './lib/state'
import type { Data } from './lib/types'
import { loadIndex, ready, useTable } from './lib/source'
import { MonthLine, PeriodLine, SegmentControls, SegmentLine, WeekLine } from './components/FilterBar'
import { Segmented, Select } from './components/ui'
import Overview from './tabs/Overview'
import FunnelTab from './tabs/FunnelTab'
import Search, { rankerSpan } from './tabs/Search'
import EvalOps, { evalWeeks } from './tabs/EvalOps'
import About from './About'
import DataPage from './DataPage'
import MetricsPage from './MetricsPage'
import Spaces from './tabs/Spaces'
import Header, { goPage } from './components/Header'
import Events from './tabs/Events'
import Members from './tabs/Members'
import Acquisition from './tabs/Acquisition'
import Periodic, { completeWeeks, defaultMonth, summaryMonths } from './tabs/Periodic'
import { PRICE_TIER, REQUESTER } from './lib/labels'
import type { TabProps } from './tabs/common'

interface TabDef {
  id: TabId
  label: string
  views?: { value: string; label: string }[]
  el: ComponentType<TabProps>
}

const TABS: TabDef[] = [
  { id: 'overview', label: '개요', el: Overview },
  { id: 'funnel', label: '퍼널', el: FunnelTab },
  {
    id: 'search',
    label: '검색',
    el: Search,
    views: [
      { value: 'quality', label: '품질' },
      { value: 'ranker', label: '랭킹 실험' },
    ],
  },
  {
    id: 'events',
    label: '행사·결제',
    el: Events,
    views: [
      { value: 'flow', label: '흐름' },
      { value: 'event', label: '행사별' },
      { value: 'venue', label: '공간별' },
      { value: 'revenue', label: '매출 구성' },
    ],
  },
  {
    id: 'members',
    label: '회원',
    el: Members,
    views: [
      { value: 'member', label: '회원' },
      { value: 'subscription', label: '구독' },
    ],
  },
  { id: 'venues', label: '공간', el: Spaces },
  {
    id: 'acquisition',
    label: '유입·광고',
    el: Acquisition,
    views: [
      { value: 'channel', label: '채널' },
      { value: 'campaign', label: '캠페인' },
    ],
  },
  { id: 'evalops', label: '평가 운영', el: EvalOps },
  {
    id: 'periodic',
    label: '주간·월간',
    el: Periodic,
    views: [
      { value: 'week', label: '주간' },
      { value: 'month', label: '월간' },
    ],
  },
]

function uniq(v: string[]): { value: string; label: string }[] {
  return [...new Set(v)].sort((a, b) => a.localeCompare(b, 'ko')).map((x) => ({ value: x, label: x }))
}

/** 상권 선택지: 기준일 등록 공간 수 내림차순, '기타'는 맨 아래. */
function regionsBySize(data: Data): { value: string; label: string }[] {
  const size = new Map<string, number>()
  const reg = (data.daily_venue_registry ?? []).filter((r) => r.kst_date <= data.meta.to_date)
  const last = reg.reduce((a, r) => (r.kst_date > a ? r.kst_date : a), '')
  for (const r of reg) if (r.kst_date === last) size.set(r.region, (size.get(r.region) ?? 0) + r.registered_total)
  for (const v of data.venue_registry ?? []) if (!size.has(v.region)) size.set(v.region, 0)
  const rank = (r: string) => (r === '기타' ? 1 : 0)
  return [...size.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .map(([x]) => ({ value: x, label: x }))
}

type Theme = 'light' | 'dark' | null

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const v = localStorage.getItem('np-theme')
      return v === 'light' || v === 'dark' ? v : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme) root.setAttribute('data-theme', theme)
    else root.removeAttribute('data-theme')
    try {
      if (theme) localStorage.setItem('np-theme', theme)
      else localStorage.removeItem('np-theme')
    } catch {
      /* 저장 불가 환경: 이번 세션만 적용 */
    }
  }, [theme])
  const toggle = () => {
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const now = theme ?? (sysDark ? 'dark' : 'light')
    setTheme(now === 'dark' ? 'light' : 'dark')
  }
  return [theme, toggle]
}

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState(false)
  const [s, set] = useUrlState()
  const [, toggleTheme] = useTheme()

  useEffect(() => {
    loadIndex()
      .then(setData)
      .catch(() => setErr(true))
  }, [])

  const legacy = (s.tab as string) === 'explore' ? (s.view === 'venue' ? 'events' : 'funnel') : s.tab
  const tab = TABS.find((t) => t.id === legacy) ?? TABS[0]
  const view = tab.views ? (tab.views.some((v) => v.value === s.view) ? s.view : tab.views[0].value) : ''
  const isTarget = (t: TabId, v: string) => v === 'campaign' || (t === 'search' && v === 'ranker')
  const target = isTarget(tab.id, view)
  const p = s.p === '' || (s.p === 'target' && !target) ? (target ? 'target' : '28') : s.p
  const st: State = { ...s, tab: tab.id, view, p }
  const searchRows = ready(useTable(data, 'daily_search', tab.id === 'search'))
  const span = useMemo(() => (searchRows ? rankerSpan(searchRows) : null), [searchRows])
  const range = useMemo(() => {
    if (!data) return null
    if (tab.id === 'search' && view === 'ranker' && p === 'target' && span) return spanRange(span.from, span.to)
    return resolveRange(st, data)
  }, [data, st.p, st.d, st.from, st.to, st.camp, tab.id, view, span])
  const venues = ready(useTable(data, 'daily_venue', tab.id === 'events' && view === 'venue')) ?? []
  const events = ready(useTable(data, 'daily_event', tab.id === 'events' && view === 'event')) ?? []

  const go = (patch: Partial<State>) => {
    const next = { ...st, ...patch }
    const was = isTarget(st.tab, st.view)
    const now = isTarget(next.tab, next.view)
    if (now && !was) patch = { ...patch, p: '' }
    else if (!now && st.p === 'target') patch = { ...patch, p: '' }
    set(patch)
  }

  const header = <Header s={s} set={set} toDate={data?.meta.to_date} onTheme={toggleTheme} />

  if (s.page === 'about')
    return (
      <div className="min-h-screen">
        {header}
        <About
          hrefs={{ data: toHref({ ...s, page: 'data' }), metrics: toHref({ ...s, page: 'metrics' }) }}
          onPage={(page) => goPage(s, set, page)}
        />
      </div>
    )

  if (s.page === 'metrics')
    return (
      <div className="min-h-screen">
        {header}
        <MetricsPage />
      </div>
    )

  if (s.page === 'data')
    return (
      <div className="min-h-screen">
        {header}
        <DataPage data={data} table={s.table} onTable={(table) => set({ table })} />
      </div>
    )

  if (err)
    return <div className="flex h-screen items-center justify-center text-sm text-muted">데이터를 불러오지 못했습니다</div>
  if (!data || !range) return <div className="h-screen" />

  const { from_date: min, to_date: max } = data.meta
  const El = tab.el

  let periodLine
  let segLine
  const views = tab.views
  if (tab.id === 'evalops') {
    const weeks = evalWeeks(data)
    const wk = weeks.includes(st.wk) ? st.wk : weeks[weeks.length - 1]
    periodLine = <WeekLine weeks={weeks} value={wk} onChange={(w) => set({ wk: w })} />
    segLine = (
      <SegmentLine>
        <Segmented
          label="요청 부서"
          value={st.rq}
          onChange={(rq) => set({ rq })}
          options={[
            { value: 'all', label: '전체' },
            ...Object.entries(REQUESTER).map(([value, label]) => ({ value: value as 'search' | 'promotion', label })),
          ]}
        />
      </SegmentLine>
    )
  } else if (tab.id === 'periodic') {
    if (view === 'month') {
      const months = summaryMonths(data)
      const mo = months.includes(st.mo) ? st.mo : defaultMonth(data)
      periodLine = <MonthLine months={months} value={mo} onChange={(m) => set({ mo: m })} partialTo={max} />
      segLine = (
        <SegmentLine>
          <Segmented
            label="범위"
            value={st.mr}
            onChange={(mr) => set({ mr })}
            options={[
              { value: '6', label: '6개월' },
              { value: '12', label: '12개월' },
            ]}
          />
        </SegmentLine>
      )
    } else {
      const weeks = completeWeeks(data)
      const wk = weeks.includes(st.wk) ? st.wk : weeks[weeks.length - 1]
      periodLine = <WeekLine weeks={weeks} value={wk} onChange={(w) => set({ wk: w })} />
      segLine = (
        <SegmentLine>
          <SegmentControls s={st} set={set} />
        </SegmentLine>
      )
    }
  } else {
    const spans = campaignSpans(data)
    periodLine = (
      <PeriodLine
        s={st}
        set={set}
        range={range}
        min={min}
        max={max}
        extra={
          view === 'campaign'
            ? { value: 'target', label: '캠페인 기간' }
            : tab.id === 'search' && view === 'ranker'
              ? { value: 'target', label: '실험 기간' }
              : undefined
        }
      />
    )
    let controls: ReactNode = <SegmentControls s={st} set={set} />
    if (tab.id === 'venues') {
      const regs = regionsBySize(data)
      controls = (
        <Select
          label="상권"
          value={regs.some((r) => r.value === st.sr) ? st.sr : 'all'}
          width="w-40"
          onChange={(sr) => set({ sr })}
          options={[{ value: 'all', label: '전체' }, ...regs]}
        />
      )
    } else if (view === 'revenue' || view === 'subscription') controls = null
    else if (view === 'venue')
      controls = (
        <>
          <Select
            label="지역"
            value={st.rg}
            width="w-32"
            onChange={(rg) => set({ rg })}
            options={[{ value: 'all', label: '전체' }, ...uniq(venues.map((r) => r.region))]}
          />
          <Select
            label="무드"
            value={st.gn}
            width="w-32"
            onChange={(gn) => set({ gn })}
            options={[{ value: 'all', label: '전체' }, ...uniq(venues.map((r) => r.genre))]}
          />
        </>
      )
    else if (view === 'event')
      controls = (
        <>
          <Select
            label="유형"
            value={st.et}
            width="w-36"
            onChange={(et) => set({ et })}
            options={[{ value: 'all', label: '전체' }, ...uniq(events.map((r) => r.event_type))]}
          />
          <Select
            label="가격대"
            value={st.pt}
            width="w-32"
            onChange={(pt) => set({ pt })}
            options={[
              { value: 'all', label: '전체' },
              ...Object.entries(PRICE_TIER).map(([value, label]) => ({ value, label })),
            ]}
          />
        </>
      )
    else if (view === 'campaign')
      controls = (
        <Select
          label="캠페인"
          value={spans.has(st.camp) ? st.camp : ''}
          width="w-64"
          onChange={(camp) => set({ camp, p: 'target' })}
          options={[
            { value: '', label: '전체 캠페인' },
            ...[...spans.entries()]
              .sort((a, b) => b[1].from.localeCompare(a[1].from))
              .map(([id, c]) => ({ value: id, label: `${c.name} · ${md(c.from)}~${md(c.to)}` })),
          ]}
        />
      )
    segLine = controls && <SegmentLine>{controls}</SegmentLine>
  }

  return (
    <div className="min-h-screen">
      {header}

      <div className="sticky top-0 z-20 bg-page">
        <nav className="scrollbar-none mx-auto flex max-w-[1280px] gap-1 overflow-x-auto border-b border-line px-4 sm:px-6">
          {TABS.map((t) => {
            const on = t.id === tab.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => go({ tab: t.id, view: t.views?.[0].value ?? '' })}
                className={`relative h-11 shrink-0 whitespace-nowrap px-3 text-sm transition-colors ${
                  on ? 'font-semibold text-ink' : 'text-ink2 hover:text-ink'
                }`}
              >
                {t.label}
                {on && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[var(--ink)]" />}
              </button>
            )
          })}
        </nav>
        {views && (
          <nav
            aria-label="보기"
            className="scrollbar-none mx-auto flex max-w-[1280px] gap-1 overflow-x-auto border-b border-line px-4 sm:px-6"
          >
            {views.map((v) => {
              const on = v.value === view
              return (
                <button
                  key={v.value}
                  type="button"
                  aria-current={on ? 'page' : undefined}
                  onClick={() => go({ view: v.value })}
                  className={`relative h-10 shrink-0 whitespace-nowrap px-3 text-[13px] transition-colors ${
                    on ? 'font-semibold text-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  {v.label}
                  {on && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[var(--ink)]" />}
                </button>
              )
            })}
          </nav>
        )}
        <div className="mx-auto max-w-[1280px] border-b border-line">
          {periodLine}
          {segLine && (
            <>
              <div className="mx-4 h-px bg-line sm:mx-6" />
              {segLine}
            </>
          )}
        </div>
      </div>

      <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-4 sm:px-6">
        <El data={data} s={st} set={set} range={range} />
      </main>
    </div>
  )
}
