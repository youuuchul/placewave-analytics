import type { MouseEvent } from 'react'
import { type State, toHref } from '../lib/state'

/** 보고서 상세(또는 목록)로 가는 링크. 새 탭 열기는 그대로 두고, 일반 클릭은 기록을 남기며 페이지만 바꾼다. */
export function openReport(s: State, set: (patch: Partial<State>) => void, id: string) {
  window.history.pushState(null, '', toHref({ ...s, page: 'reports', r: id }))
  set({ page: 'reports', r: id })
  setTimeout(() => window.scrollTo(0, 0), 0)
}

export function ReportLink({
  s,
  set,
  id,
  label,
  className = 'text-xs font-medium text-accent hover:underline',
  back = false,
}: {
  s: State
  set: (patch: Partial<State>) => void
  id: string
  label: string
  className?: string
  back?: boolean
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    openReport(s, set, id)
  }
  return (
    <a href={toHref({ ...s, page: 'reports', r: id })} onClick={onClick} className={className}>
      {back ? `← ${label}` : `${label} →`}
    </a>
  )
}
