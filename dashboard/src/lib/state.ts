import { useCallback, useEffect, useRef, useState } from 'react'

export type TabId = 'overview' | 'funnel' | 'search' | 'events' | 'members' | 'venues' | 'acquisition' | 'evalops' | 'periodic'
export type Preset = '' | '1' | '7' | '28' | '90' | '365' | 'custom' | 'target'

export interface State {
  tab: TabId
  view: string
  p: Preset
  d: string
  from: string
  to: string
  ch: 'all' | 'paid' | 'non_paid'
  pf: 'all' | 'ios' | 'android' | 'web'
  ms: 'all' | 'member' | 'guest'
  rg: string
  gn: string
  et: string
  pt: string
  camp: string
  wk: string
  mo: string
  mr: '6' | '12'
  aud: string
  sr: string
  sg: string
  sp: 'all' | 'partner' | 'other'
  rq: 'all' | 'search' | 'promotion'
  page: '' | 'about' | 'data' | 'metrics' | 'reports'
  table: string
  r: string
}

export const DEFAULTS: State = {
  tab: 'overview',
  view: '',
  p: '',
  d: '',
  from: '',
  to: '',
  ch: 'all',
  pf: 'all',
  ms: 'all',
  rg: 'all',
  gn: 'all',
  et: 'all',
  pt: 'all',
  camp: '',
  wk: '',
  mo: '',
  mr: '6',
  aud: 'new,returning,past_payer',
  sr: 'all',
  sg: 'all',
  sp: 'all',
  rq: 'all',
  page: '',
  table: '',
  r: '',
}

function read(): State {
  const q = new URLSearchParams(window.location.search)
  const s = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS) as (keyof State)[]) {
    const v = q.get(k)
    if (v != null) (s as Record<string, string>)[k] = v
  }
  return s
}

export function toHref(s: State): string {
  const q = new URLSearchParams()
  for (const k of Object.keys(DEFAULTS) as (keyof State)[]) {
    if (s[k] !== DEFAULTS[k]) q.set(k, String(s[k]))
  }
  const qs = q.toString()
  return qs ? `?${qs}` : window.location.pathname
}

function write(s: State, push: boolean) {
  const url = toHref(s) + window.location.hash
  if (push) window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}

export function useUrlState(): [State, (patch: Partial<State>, push?: boolean) => void] {
  const [state, setState] = useState<State>(read)
  const pushNext = useRef(false)
  useEffect(() => {
    write(state, pushNext.current)
    pushNext.current = false
  }, [state])
  useEffect(() => {
    const onPop = () => setState(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const update = useCallback((patch: Partial<State>, push = false) => {
    if (push) pushNext.current = true
    setState((s) => ({ ...s, ...patch }))
  }, [])
  return [state, update]
}
