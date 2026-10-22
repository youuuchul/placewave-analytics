import { useMemo } from 'react'
import { inRange, segFilter, sum } from '../lib/agg'
import { md } from '../lib/date'
import { num, pct, ratio, won } from '../lib/format'
import { F, uniquePersons } from '../lib/persons'
import { ready, useTable, waitOf } from '../lib/source'
import type { DailyMetric, DailySubscription, DailyVenueRegistry, HourlyMetric } from '../lib/types'
import TrendCard, { type FixedTile, type TrendMetric } from '../components/TrendCard'
import RevenueCard from '../components/RevenueCard'
import { sumRevenue } from '../lib/revenue'
import { Pending, SectionTitle, Tile, TileRow } from '../components/ui'
import { delta, type TabProps, vsLabel } from './common'

const KEYS = [
  'persons',
  'new_persons',
  'sessions',
  'engaged_sessions',
  'signups',
  'applies',
  'pay_count',
  'pay_amount',
] as const

type M = TrendMetric<DailyMetric, HourlyMetric>

const VISITORS: [M, M] = [
  { label: '방문자', unit: '명', flag: F.visited, value: (r) => r.persons, hour: (r) => r.persons },
  { label: '신규 방문자', unit: '명', value: (r) => r.new_persons },
]
const SIGNUP: [M] = [{ label: '가입', unit: '명', value: (r) => r.signups }]
const PAY: [M, M] = [
  { label: '결제', unit: '건', value: (r) => r.pay_count, hour: (r) => r.pay_count },
  { label: '신청', unit: '건', value: (r) => r.applies, hour: (r) => r.applies },
]
type SM = TrendMetric<DailySubscription, HourlyMetric>
const SUBS: [SM, SM] = [
  { label: '활성 구독자', unit: '명', value: (r) => r.active_subscribers, bucketAgg: 'last' },
  { label: '신규 구독', unit: '건', value: (r) => r.new_subscribers },
]

interface PartnerDay {
  kst_date: string
  partner_total: number
  new_contracts: number
  churned_contracts: number
  mrr: number
}
type PM = TrendMetric<PartnerDay, HourlyMetric>
const PARTNERS: [PM, PM] = [
  { label: '파트너 공간', unit: '곳', value: (r) => r.partner_total, bucketAgg: 'last' },
  { label: '신규 계약', unit: '건', value: (r) => r.new_contracts },
]

/** 상권 × 일 공간 현황을 일 합계로. */
function partnerDays(rows: DailyVenueRegistry[] | undefined): PartnerDay[] {
  const m = new Map<string, PartnerDay>()
  for (const r of rows ?? []) {
    const z = m.get(r.kst_date) ?? { kst_date: r.kst_date, partner_total: 0, new_contracts: 0, churned_contracts: 0, mrr: 0 }
    z.partner_total += r.partner_total
    z.new_contracts += r.new_contracts
    z.churned_contracts += r.churned_contracts
    z.mrr += r.mrr_basic + r.mrr_pro
    m.set(r.kst_date, z)
  }
  return [...m.values()].sort((a, b) => a.kst_date.localeCompare(b.kst_date))
}

/** 날짜 d 이하 마지막 날의 행. */
function lastAt<T extends { kst_date: string }>(rows: T[], d: string): T | undefined {
  let last: T | undefined
  for (const r of rows) {
    if (r.kst_date > d) break
    last = r
  }
  return last
}

/** 기간 [from, to] 의 구독 행 합(신규·해지). 행이 없으면 null. */
function subSum(rows: DailySubscription[] | undefined, from: string, to: string) {
  let n = 0
  const z = { new: 0, churned: 0 }
  for (const r of rows ?? []) {
    if (r.kst_date < from || r.kst_date > to) continue
    z.new += r.new_subscribers
    z.churned += r.churned_subscribers
    n++
  }
  return n ? z : null
}

/** 날짜 d 이하 마지막 날의 구독 행. */
function subAt(rows: DailySubscription[] | undefined, d: string): DailySubscription | undefined {
  let last: DailySubscription | undefined
  for (const r of rows ?? []) {
    if (r.kst_date > d) break
    last = r
  }
  return last
}

export default function Overview({ data, s, set, range }: TabProps) {
  const seg = segFilter(s)
  const m = useMemo(() => data.daily_metrics.filter(seg), [data, s.ch, s.pf, s.ms])
  const cur = sum(inRange(m, range.from, range.to), [...KEYS])
  const prev = sum(inRange(m, range.prevFrom, range.prevTo), [...KEYS])
  const d = (k: (typeof KEYS)[number], goodUp = true) => delta(data, range, cur[k], prev[k], goodUp)

  const segState = { ch: s.ch, pf: s.pf, ms: s.ms }
  const pdL = useTable(data, 'person_day')
  const hourL = useTable(data, 'hourly_metrics', range.oneDay)
  const venueL = useTable(data, 'daily_venue')
  const pd = ready(pdL)
  const visitors = (from: string, to: string, fallback: number) =>
    pd ? (uniquePersons(pd, from, to, F.visited, segState).get('') ?? 0) : fallback
  const vCur = useMemo(() => visitors(range.from, range.to, cur.persons), [data, pd, range.from, range.to, s.ch, s.pf, s.ms])
  const vPrev = useMemo(
    () => visitors(range.prevFrom, range.prevTo, prev.persons),
    [data, pd, range.prevFrom, range.prevTo, s.ch, s.pf, s.ms],
  )

  const status = useMemo(() => {
    const to = data.meta.to_date
    let members = 0
    for (const r of data.daily_metrics) if (r.kst_date <= to) members += r.signups
    const dv = ready(venueL)
    const venues = dv ? new Set(dv.filter((r) => r.kst_date <= to).map((r) => r.venue_id)).size : null
    let registered: number | null = null
    let partners: number | null = null
    const reg = data.daily_venue_registry
    if (reg?.length) {
      const last = reg.reduce((a, r) => (r.kst_date <= to && r.kst_date > a ? r.kst_date : a), '')
      registered = 0
      partners = 0
      for (const r of reg)
        if (r.kst_date === last) {
          registered += r.registered_total
          partners += r.partner_total
        }
    }
    return { to, members, venues, registered, partners }
  }, [data, venueL])

  const segOn = s.ch !== 'all' || s.pf !== 'all' || s.ms !== 'all'
  const rev = data.daily_revenue
  const rCur = rev ? sumRevenue(rev, range.from, range.to) : null
  const rPrev = rev ? sumRevenue(rev, range.prevFrom, range.prevTo) : null

  const vs = vsLabel(data, range)
  const subEnd = subAt(data.daily_subscription, range.to)
  const subPrev = subAt(data.daily_subscription, range.prevTo)
  const money = !segOn && rCur && rPrev ? { cur: rCur, prev: rPrev } : null
  const pDays = useMemo(() => partnerDays(data.daily_venue_registry), [data])
  const pEnd = lastAt(pDays, range.to)
  const pPrevEnd = lastAt(pDays, range.prevTo)
  const pSum = (from: string, to: string) => pDays.filter((r) => r.kst_date >= from && r.kst_date <= to).reduce((a, r) => a + r.churned_contracts, 0)
  const share = (r: typeof rCur) => (r ? ratio(r.tier.basic.gmv + r.tier.pro.gmv, r.gmv) : null)
  const aov = (r: typeof rCur) => (r ? ratio(r.gmv, r.payCount - r.refundCount) : null)
  const payTiles: FixedTile[] = [
    { label: '결제', unit: '건', cur: cur.pay_count, prev: prev.pay_count },
    { label: '객단가', unit: '원', cur: aov(rCur), prev: aov(rPrev), format: won },
    { label: '거래액', unit: '원', cur: rCur?.gmv ?? null, prev: rPrev?.gmv ?? null, format: won },
  ]
  const partnerTiles: FixedTile[] = [
    { label: '파트너 공간', unit: '곳', cur: pEnd?.partner_total ?? null, prev: pPrevEnd?.partner_total ?? null },
    { label: '계약 해지', unit: '건', cur: pSum(range.from, range.to), prev: pSum(range.prevFrom, range.prevTo), lowerIsBetter: true },
    { label: '플랜 MRR', unit: '원', cur: pEnd?.mrr ?? null, prev: pPrevEnd?.mrr ?? null, format: won },
    { label: '파트너 거래액 비중', unit: '', cur: share(rCur), prev: share(rPrev), format: (v) => pct(v), rate: true },
  ]
  const sCur = subSum(data.daily_subscription, range.from, range.to)
  const sPrev = subSum(data.daily_subscription, range.prevFrom, range.prevTo)
  const subTiles: FixedTile[] = [
    { label: '활성 구독자', unit: '명', cur: subEnd?.active_subscribers ?? null, prev: subPrev?.active_subscribers ?? null },
    { label: '신규 구독', unit: '건', cur: sCur?.new ?? null, prev: sPrev?.new ?? null },
    { label: '구독 해지', unit: '건', cur: sCur?.churned ?? null, prev: sPrev?.churned ?? null, lowerIsBetter: true },
    { label: 'MRR', unit: '원', cur: subEnd?.mrr ?? null, prev: subPrev?.mrr ?? null, format: won },
  ]

  const card = {
    daily: data.daily_metrics,
    hourly: ready(hourL) ?? [],
    persons: pd,
    hourWait: range.oneDay ? waitOf(hourL) : null,
    seg: segState,
    range,
    dataFrom: data.meta.from_date,
    dataTo: data.meta.to_date,
    onDrill: (p: { p: '1'; d: string } | { p: 'custom'; from: string; to: string }) => set(p, true),
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-2.5 text-[13px]">
        <span className="text-xs text-muted">{md(status.to)} 기준</span>
        <span className="text-ink2">
          누적 회원 <span className="tnum font-semibold text-ink">{num(status.members)}</span>명
        </span>
        {status.registered == null ? (
          <span className="text-ink2">
            공간{' '}
            {status.venues == null && waitOf(venueL) ? (
              <Pending wait={waitOf(venueL)} h={14} w="w-10" inline />
            ) : (
              <span className="tnum font-semibold text-ink">{num(status.venues)}</span>
            )}
            {waitOf(venueL) !== 'error' && '곳'}
          </span>
        ) : (
          <>
            <span className="text-ink2">
              등록 공간 <span className="tnum font-semibold text-ink">{num(status.registered)}</span>곳
            </span>
            <span className="text-ink2">
              파트너 공간 <span className="tnum font-semibold text-ink">{num(status.partners)}</span>곳
            </span>
          </>
        )}
      </section>

      <TileRow cols={money ? 'lg:grid-cols-6' : 'lg:grid-cols-3'} title={`핵심 지표 · ${vs}`}>
        <Tile metricId="C12" label="결제" value={num(cur.pay_count)} unit="건" delta={d('pay_count')} />
        <Tile metricId="V12" label="방문자" value={num(vCur)} unit="명" delta={delta(data, range, vCur, vPrev)} wait={waitOf(pdL)} />
        <Tile metricId="C10" label="가입" value={num(cur.signups)} unit="명" delta={d('signups')} />
        {money && (
          <Tile
            metricId="S01"
            label="활성 구독자"
            value={num(subEnd?.active_subscribers)}
            unit="명"
            sub={subEnd ? `${md(subEnd.kst_date)} 기준` : undefined}
            delta={delta(data, range, subEnd?.active_subscribers ?? null, subPrev?.active_subscribers ?? null)}
          />
        )}
        {money && (
          <Tile
            metricId="P02"
            label="파트너 공간"
            value={num(pEnd?.partner_total)}
            unit="곳"
            sub={`파트너 거래액 비중 ${pct(share(rCur))}`}
            delta={delta(data, range, pEnd?.partner_total ?? null, pPrevEnd?.partner_total ?? null)}
          />
        )}
        {money && (
          <Tile
            metricId="M01"
            label="플랫폼 매출"
            value={won(money.cur.total)}
            unit="원"
            delta={delta(data, range, money.cur.total, money.prev.total)}
          />
        )}
      </TileRow>

      <SectionTitle>추이</SectionTitle>
      <TrendCard title="결제" metrics={PAY} {...card} fixedTiles={segOn ? undefined : payTiles} />
      <TrendCard title="방문자" metrics={VISITORS} {...card} personWait={waitOf(pdL)} />
      <TrendCard title="가입" metrics={SIGNUP} {...card} axes={['ch', 'pf']} />
      {!segOn && data.daily_subscription && (
        <TrendCard
          title="활성 구독자"
          metrics={SUBS}
          {...card}
          daily={data.daily_subscription}
          hourly={[]}
          persons={undefined}
          fixedTiles={subTiles}
          gaps
        />
      )}
      {!segOn && pDays.length > 0 && (
        <TrendCard
          title="파트너 공간"
          metrics={PARTNERS}
          {...card}
          daily={pDays}
          hourly={[]}
          persons={undefined}
          fixedTiles={partnerTiles}
          gaps
        />
      )}
      {!segOn && (
        <RevenueCard
          title="플랫폼 매출 · 구성"
          rows={rev}
          range={range}
          dataFrom={data.meta.from_date}
          dataTo={data.meta.to_date}
          onDrill={card.onDrill}
          gmv={false}
        />
      )}
    </div>
  )
}
