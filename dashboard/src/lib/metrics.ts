import { useEffect, useState } from 'react'

export interface MetricDef {
  id: string
  name: string
  tab: string
  group: string
  definition: string
  formula: string
  unit: string
  denominator: string
  mart_columns: string[]
  why: string
  axis?: string
  /** 'down' 이면 낮을수록 좋은 지표 — 증가를 나쁜 색으로 */
  direction?: 'up' | 'down'
}

export interface TabGuide {
  id: string
  name: string
  question: string
  users: string[]
  key_metrics: string[]
}

/** 북극성 지표 절. 문구는 metrics.json 에만 두고 화면은 읽어서 그린다. */
export interface NorthStar {
  metric: string
  definition: string
  reasons: { head: string; body: string }[]
  axes: { axis: string; inputs: string[]; guardrails: { id: string; rule: string }[] }[]
  rejected: { name: string; reason: string }[]
  limits: string[]
  sources: { label: string; url: string }[]
}

export interface MetricSpec {
  groups: { id: string; name: string }[]
  axes?: { id: string; name: string }[]
  north_star?: NorthStar
  tabs: TabGuide[]
  metrics: MetricDef[]
}

type Loaded = MetricSpec | 'error' | null

let cache: Loaded = null
let job: Promise<void> | null = null
const subs = new Set<() => void>()

function load(): Promise<void> {
  if (!job)
    job = fetch(`${import.meta.env.BASE_URL}metrics.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(
        (j: MetricSpec) => void (cache = Array.isArray(j?.metrics) ? j : 'error'),
        () => void (cache = 'error'),
      )
      .then(() => subs.forEach((f) => f()))
  return job
}

/** metrics.json 을 한 번만 받아 공유한다. 받는 중 null, 실패 'error'. */
export function useMetricSpec(): Loaded {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((x) => x + 1)
    subs.add(f)
    if (!cache) load()
    return () => void subs.delete(f)
  }, [])
  return cache
}
