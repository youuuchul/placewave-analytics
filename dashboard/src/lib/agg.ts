import { addDays, diffDays, eachDay, mondayOf } from './date'
import { type PersonRow, type SegState, pdCh, pdDay, pdFlags, pdKey, pdMs, pdPf, pdSpan } from './persons'
import type { Data, PersonDay, Seg } from './types'
import type { State } from './state'

export interface Range {
  from: string
  to: string
  days: number
  oneDay: boolean
  prevFrom: string
  prevTo: string
}

export function clampDate(d: string, min: string, max: string): string {
  return d < min ? min : d > max ? max : d
}

export function campaignSpans(data: Data): Map<string, { name: string; from: string; to: string }> {
  const m = new Map<string, { name: string; from: string; to: string }>()
  for (const r of data.daily_ad) {
    const c = m.get(r.campaign_id)
    if (!c) m.set(r.campaign_id, { name: r.campaign_name, from: r.kst_date, to: r.kst_date })
    else {
      if (r.kst_date < c.from) c.from = r.kst_date
      if (r.kst_date > c.to) c.to = r.kst_date
    }
  }
  return m
}

export function resolveRange(s: State, data: Data): Range {
  const { from_date: min, to_date: max } = data.meta
  let from: string
  let to: string
  if (s.p === '1') {
    from = to = clampDate(s.d || max, min, max)
  } else if (s.p === 'custom' && s.from && s.to) {
    from = clampDate(s.from < s.to ? s.from : s.to, min, max)
    to = clampDate(s.from < s.to ? s.to : s.from, min, max)
  } else if (s.p === 'target') {
    const spans = campaignSpans(data)
    const c = spans.get(s.camp)
    if (c) {
      from = c.from
      to = c.to
    } else {
      const all = [...spans.values()]
      from = all.reduce((a, c2) => (c2.from < a ? c2.from : a), max)
      to = all.reduce((a, c2) => (c2.to > a ? c2.to : a), min)
    }
  } else {
    const n = s.p === 'custom' ? 28 : Number(s.p)
    to = max
    from = clampDate(addDays(max, -(n - 1)), min, max)
  }
  const days = diffDays(from, to) + 1
  return { from, to, days, oneDay: days === 1, prevFrom: addDays(from, -days), prevTo: addDays(from, -1) }
}

export function spanRange(from: string, to: string): Range {
  const days = diffDays(from, to) + 1
  return { from, to, days, oneDay: days === 1, prevFrom: addDays(from, -days), prevTo: addDays(from, -1) }
}

export function segFilter(s: State) {
  return (r: Seg) =>
    (s.ch === 'all' || r.channel1 === s.ch) &&
    (s.pf === 'all' || r.device_platform === s.pf) &&
    (s.ms === 'all' || r.member_seg === s.ms)
}

export function inRange<T extends { kst_date: string }>(rows: T[], from: string, to: string): T[] {
  return rows.filter((r) => r.kst_date >= from && r.kst_date <= to)
}

export function sum<T, K extends keyof T>(rows: T[], keys: K[]): Record<K, number> {
  const out = {} as Record<K, number>
  for (const k of keys) out[k] = 0
  for (const r of rows) for (const k of keys) out[k] += r[k] as unknown as number
  return out
}

export function byDate<T extends { kst_date: string }, K extends keyof T>(
  rows: T[],
  keys: K[],
  from: string,
  to: string,
): ({ date: string } & Record<K, number>)[] {
  const idx = new Map<string, Record<K, number>>()
  for (const d of eachDay(from, to)) {
    const z = {} as Record<K, number>
    for (const k of keys) z[k] = 0
    idx.set(d, z)
  }
  for (const r of rows) {
    const z = idx.get(r.kst_date)
    if (!z) continue
    for (const k of keys) z[k] += r[k] as unknown as number
  }
  return [...idx.entries()].map(([date, v]) => ({ date, ...v }))
}

export function groupSum<T, K extends keyof T>(
  rows: T[],
  keyOf: (r: T) => string,
  keys: K[],
): Map<string, Record<K, number>> {
  const m = new Map<string, Record<K, number>>()
  for (const r of rows) {
    const g = keyOf(r)
    let z = m.get(g)
    if (!z) {
      z = {} as Record<K, number>
      for (const k of keys) z[k] = 0
      m.set(g, z)
    }
    for (const k of keys) z[k] += r[k] as unknown as number
  }
  return m
}

export function bucketed<T extends { kst_date: string }, K extends keyof T>(
  rows: T[],
  keys: K[],
  range: Range,
): { weekly: boolean; rows: ({ date: string } & Record<K, number>)[] } {
  const daily = byDate(rows, keys, range.from, range.to)
  if (range.days <= 120) return { weekly: false, rows: daily }
  const m = new Map<string, { date: string } & Record<K, number>>()
  for (const r of daily) {
    const w = mondayOf(r.date)
    let z = m.get(w)
    if (!z) {
      z = { date: w } as { date: string } & Record<K, number>
      for (const k of keys) (z as Record<K, number>)[k] = 0
      m.set(w, z)
    }
    for (const k of keys) (z as Record<K, number>)[k] += r[k]
  }
  return { weekly: true, rows: [...m.values()] }
}

/**
 * 기간·세그먼트 안에서 마스크별 고유 사람 수를 그룹별로 한 번에 센다.
 *
 * 마스크의 비트를 같은 날 모두 가진 사람만 센다(누적 퍼널 단계용). 비트 하나짜리 마스크는
 * `uniquePersons` 와 같다. 세그먼트 귀속도 `uniquePersons` 와 같다 — 'last'(기본)는 사람마다
 * 기간 안에서 마스크 하나라도 맞는 마지막 날의 세그먼트 값 하나로 귀속하므로 세그먼트 값별 수의 합이
 * 전체와 같고, 'day' 는 그날 행의 값으로 센다.
 *
 * Args:
 *   pd: person_day.bin 을 읽은 것.
 *   from: 기간 시작일.
 *   to: 기간 끝일.
 *   masks: 비트 마스크 목록(F 값의 OR).
 *   seg: 세그먼트 필터 상태.
 *   groups: 행 → 그룹 키 목록. 기본은 '' 하나(기간 전체).
 *   by: 세그먼트 귀속 규칙.
 *
 * Returns:
 *   그룹 키 → 마스크 순서대로의 고유 사람 수.
 */
export function uniqueByMasks(
  pd: PersonDay,
  from: string,
  to: string,
  masks: number[],
  seg: SegState,
  groups: (r: PersonRow) => string[] = () => [''],
  by: 'last' | 'day' = 'last',
): Map<string, number[]> {
  const lo = diffDays(pd.base_date, from)
  const hi = diffDays(pd.base_date, to)
  const [i0, i1] = pdSpan(pd, lo, hi)
  const w = pd.w
  const hit = (f: number) => masks.some((m) => (f & m) === m)
  const last = new Map<number, number>()
  if (by === 'last') for (let i = i0; i < i1; i++) if (hit(pdFlags(w[2 * i + 1]))) last.set(pdKey(w[2 * i]), i)
  const sets = new Map<string, Set<number>[]>()
  const row: PersonRow = { off: 0, channel1: '', device_platform: '', member_seg: '' }
  for (let i = i0; i < i1; i++) {
    const a = w[2 * i]
    const b = w[2 * i + 1]
    const f = pdFlags(b)
    if (!hit(f)) continue
    const j = by === 'last' ? last.get(pdKey(a))! : i
    row.channel1 = pd.codes.c[pdCh(w[2 * j])]
    row.device_platform = pd.codes.p[pdPf(w[2 * j])]
    row.member_seg = pd.codes.m[pdMs(w[2 * j + 1])]
    if (seg.ch !== 'all' && row.channel1 !== seg.ch) continue
    if (seg.pf !== 'all' && row.device_platform !== seg.pf) continue
    if (seg.ms !== 'all' && row.member_seg !== seg.ms) continue
    row.off = pdDay(a) - lo
    const k = pdKey(a)
    for (const g of groups(row)) {
      let s = sets.get(g)
      if (!s) sets.set(g, (s = masks.map(() => new Set<number>())))
      masks.forEach((m, j) => {
        if ((f & m) === m) s[j].add(k)
      })
    }
  }
  const out = new Map<string, number[]>()
  for (const [g, s] of sets) out.set(g, s.map((x) => x.size))
  return out
}
