import type { MouseEvent, ReactNode } from 'react'
import { md } from '../lib/date'
import { type State, toHref } from '../lib/state'

type Page = State['page']

export const DATA_NOTE_ID = 'data-note'

export function goPage(s: State, set: (patch: Partial<State>) => void, page: Page, anchor = '') {
  window.history.pushState(null, '', toHref({ ...s, page, r: '' }) + (anchor ? `#${anchor}` : ''))
  set({ page, r: '' })
  setTimeout(() => {
    const el = anchor ? document.getElementById(anchor) : null
    if (el) el.scrollIntoView({ block: 'start' })
    else window.scrollTo(0, 0)
  }, 0)
}

function PageLink({
  s,
  set,
  page,
  anchor,
  className,
  children,
}: {
  s: State
  set: (patch: Partial<State>) => void
  page: Page
  anchor?: string
  className: string
  children: ReactNode
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    goPage(s, set, page, anchor)
  }
  return (
    <a
      href={toHref({ ...s, page, r: '' }) + (anchor ? `#${anchor}` : '')}
      onClick={onClick}
      aria-current={s.page === page && !anchor ? 'page' : undefined}
      className={className}
    >
      {children}
    </a>
  )
}

const NAV: { page: Page; label: string; short: string }[] = [
  { page: '', label: '대시보드', short: '대시보드' },
  { page: 'about', label: '프로젝트 개요', short: '개요' },
  { page: 'data', label: '데이터 카탈로그', short: '데이터' },
  { page: 'metrics', label: '지표 가이드', short: '지표' },
  { page: 'reports', label: '보고서', short: '보고서' },
]

export default function Header({
  s,
  set,
  toDate,
  onTheme,
}: {
  s: State
  set: (patch: Partial<State>) => void
  toDate?: string
  onTheme: () => void
}) {
  const items = NAV
  return (
    <header className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-2 pt-5 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <PageLink s={s} set={set} page="" className="flex shrink-0 items-center gap-2 sm:gap-3">
          <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden className="shrink-0">
            <path
              d="M1 9h3l2-6 3 10 2-6h4"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h1 className="whitespace-nowrap text-lg font-semibold tracking-tight">
            Placewave <span className="hidden font-normal text-ink2 sm:inline">KPI</span>
          </h1>
        </PageLink>
        <nav className="flex items-center gap-0.5 sm:ml-2">
          {items.map((it) => {
            const on = s.page === it.page
            return (
              <PageLink
                key={it.page || 'dash'}
                s={s}
                set={set}
                page={it.page}
                className={`flex h-8 items-center whitespace-nowrap rounded-lg px-2 text-[13px] sm:px-2.5 ${
                  on
                    ? 'bg-wash font-semibold text-ink'
                    : it.page === 'about'
                      ? 'font-medium text-accent hover:bg-wash'
                      : 'text-ink2 hover:text-ink'
                }`}
              >
                <span className="sm:hidden">{it.short}</span>
                <span className="hidden sm:inline">{it.label}</span>
              </PageLink>
            )
          })}
        </nav>
      </div>
      <div className="flex w-full min-w-0 items-center gap-3 sm:ml-auto sm:w-auto">
        {toDate && (
          <>
            <span className="tnum hidden shrink-0 text-xs text-muted sm:inline">기준일 {toDate}</span>
            <span className="tnum shrink-0 text-xs text-muted sm:hidden">기준일 {md(toDate)}</span>
          </>
        )}
        <button
          type="button"
          onClick={onTheme}
          aria-label="테마 전환"
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-wash text-ink2 hover:text-ink sm:ml-0"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </header>
  )
}
