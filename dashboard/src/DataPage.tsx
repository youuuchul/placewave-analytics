import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Card } from './components/ui'
import { useTable, waitOf } from './lib/source'
import type { Data, LazyKey } from './lib/types'

const REPO = 'https://github.com/youuuchul/placewave-analytics'
const PREVIEW_ROWS = 20

interface CatalogColumn {
  name: string
  type: string
  description: string
}

interface CatalogTable {
  layer: string
  name: string
  description?: string
  grain: string
  keys: string[]
  partition: string | null
  cluster: string[]
  rows: number | null
  size_mb: number | null
  sources: string[]
  consumers: string[]
  checks: string[]
  sql: string
  columns: CatalogColumn[]
}

export interface Catalog {
  built_at: string
  project: string
  location: string
  layers: string[]
  tables: CatalogTable[]
}

const LAYER_LABEL: Record<string, string> = {
  raw: '원천 적재',
  staging: '정제·중간·차원',
  marts: '화면용 지표·리스트',
  ops: '실행 기록·검사',
}

const idOf = (t: CatalogTable) => `${t.layer}.${t.name}`

export function useCatalog(): Catalog | null | 'missing' {
  const [cat, setCat] = useState<Catalog | null | 'missing'>(null)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}catalog.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((c: Catalog) => (Array.isArray(c?.tables) && c.tables.length ? setCat(c) : setCat('missing')))
      .catch(() => setCat('missing'))
  }, [])
  return cat
}

function fmtCell(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('ko-KR') : v.toLocaleString('ko-KR', { maximumFractionDigits: 4 })
  return String(v)
}

function fmtSize(mb: number | null): string {
  if (mb == null) return '—'
  if (mb < 1) return `${Math.max(1, Math.round(mb * 1024)).toLocaleString('ko-KR')} KB`
  return `${mb.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MB`
}

function list(v: string[]): string {
  return v.length ? v.join(', ') : '—'
}

function TableList({
  cat,
  sel,
  onSel,
}: {
  cat: Catalog
  sel: string
  onSel: (id: string) => void
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const toggle = (l: string) =>
    setClosed((c) => {
      const n = new Set(c)
      if (n.has(l)) n.delete(l)
      else n.add(l)
      return n
    })
  return (
    <nav className="card hidden self-start overflow-hidden lg:block" aria-label="표 목록">
      {cat.layers.map((l) => {
        const ts = cat.tables.filter((t) => t.layer === l)
        const open = !closed.has(l)
        return (
          <div key={l} className="border-b border-line last:border-b-0">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(l)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-wash"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`}>
                <path d="M3 1.5L6.5 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="font-mono text-[13px] font-semibold text-ink">{l}</span>
              <span className="truncate text-xs text-muted">{LAYER_LABEL[l] ?? ''}</span>
              <span className="tnum ml-auto text-xs text-muted">{ts.length}</span>
            </button>
            {open && (
              <ul className="pb-1.5">
                {ts.map((t) => {
                  const id = idOf(t)
                  const on = id === sel
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        aria-current={on ? 'true' : undefined}
                        onClick={() => onSel(id)}
                        className={`flex w-full flex-col gap-0.5 py-1.5 pl-9 pr-4 text-left ${on ? 'bg-[var(--bar-wash)]' : 'hover:bg-wash'}`}
                      >
                        <span className={`truncate font-mono text-[13px] ${on ? 'font-semibold text-ink' : 'text-ink'}`}>{t.name}</span>
                        <span className="truncate text-xs text-muted">{t.description || t.grain}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function Meta({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${wide ? 'sm:col-span-2 lg:col-span-4' : ''}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="break-words text-[13px] text-ink">{children}</dd>
    </div>
  )
}

function Preview({ t, rows }: { t: CatalogTable; rows: Record<string, unknown>[] }) {
  const cols = useMemo(() => {
    const present = new Set(rows.flatMap((r) => Object.keys(r)))
    const ordered = t.columns.map((c) => c.name).filter((c) => present.has(c))
    return [...ordered, ...[...present].filter((c) => !ordered.includes(c))]
  }, [t, rows])
  const shown = rows.slice(0, PREVIEW_ROWS)
  return (
    <Card title="미리보기" meta={`${shown.length.toLocaleString('ko-KR')}행 / 추출 ${rows.length.toLocaleString('ko-KR')}행`}>
      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-axis">
              {cols.map((c) => {
                const num = typeof shown[0]?.[c] === 'number'
                return (
                  <th key={c} className={`whitespace-nowrap py-2 pr-4 font-mono font-medium text-muted last:pr-0 ${num ? 'text-right' : 'text-left'}`}>
                    {c}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-b border-line">
                {cols.map((c) => {
                  const v = r[c]
                  const num = typeof v === 'number'
                  return (
                    <td key={c} className={`whitespace-nowrap py-1.5 pr-4 last:pr-0 ${num ? 'tnum text-right text-ink' : 'text-ink2'}`}>
                      {fmtCell(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

const LAZY_ROWS: string[] = ['hourly_metrics', 'daily_channel', 'daily_venue', 'daily_event', 'weekly_path'] satisfies LazyKey[]

function Detail({ t, data }: { t: CatalogTable; data: Data | null }) {
  const lazy = t.layer === 'marts' && LAZY_ROWS.includes(t.name)
  const lz = useTable(data, (lazy ? t.name : 'daily_venue') as Exclude<LazyKey, 'person_day'>, lazy)
  const wait = lazy ? waitOf(lz) : null
  const rows = !(t.layer === 'marts' && data)
    ? undefined
    : lazy
      ? lz.state === 'ready'
        ? (lz.value as unknown as Record<string, unknown>[])
        : undefined
      : ((data as unknown as Record<string, unknown>)[t.name] as Record<string, unknown>[] | undefined)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="card flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="min-w-0 break-all font-mono text-[17px] font-semibold text-ink">
            <span className="font-normal text-muted">{t.layer}.</span>
            {t.name}
          </h2>
          <a
            href={`${REPO}/blob/main/${t.sql}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs text-muted underline decoration-[var(--axis)] underline-offset-[3px] hover:text-ink2"
          >
            SQL ↗
          </a>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="1행 = " wide>
            {t.grain || '—'}
          </Meta>
          <Meta label="키">
            <span className="font-mono text-[12px]">{list(t.keys)}</span>
          </Meta>
          <Meta label="파티션">
            <span className="font-mono text-[12px]">{t.partition ?? '—'}</span>
          </Meta>
          <Meta label="클러스터">
            <span className="font-mono text-[12px]">{list(t.cluster)}</span>
          </Meta>
          <Meta label="행 수 · 크기">
            <span className="tnum">
              {t.rows == null ? '—' : t.rows.toLocaleString('ko-KR')} · {fmtSize(t.size_mb)}
            </span>
          </Meta>
          <Meta label="원천" wide>
            {list(t.sources)}
          </Meta>
          <Meta label="소비" wide>
            {list(t.consumers)}
          </Meta>
          <Meta label="검사" wide>
            <span className="font-mono text-[12px]">{list(t.checks)}</span>
          </Meta>
        </dl>
      </section>

      <Card title="컬럼" meta={`${t.columns.length}개`}>
        {t.columns.length ? (
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-axis text-left text-muted">
                  <th className="w-[42%] py-2 pr-3 font-medium sm:w-[30%]">이름</th>
                  <th className="hidden w-[14%] py-2 pr-3 font-medium sm:table-cell">타입</th>
                  <th className="py-2 font-medium">설명</th>
                </tr>
              </thead>
              <tbody>
                {t.columns.map((c) => (
                  <tr key={c.name} className="border-b border-line align-top">
                    <td className="break-all py-2 pr-3 font-mono text-[12px] text-ink">
                      {c.name}
                      <div className="text-[11px] text-muted sm:hidden">{c.type}</div>
                    </td>
                    <td className="hidden py-2 pr-3 font-mono text-[12px] text-ink2 sm:table-cell">{c.type}</td>
                    <td className="py-2 text-ink2">{c.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-muted">컬럼 정보 없음</div>
        )}
      </Card>

      {wait ? (
        <Card title="미리보기" wait={wait}>
          {null}
        </Card>
      ) : (
        rows && rows.length > 0 && <Preview t={t} rows={rows} />
      )}
    </div>
  )
}

export default function DataPage({
  data,
  table,
  onTable,
}: {
  data: Data | null
  table: string
  onTable: (id: string) => void
}) {
  const cat = useCatalog()
  if (cat === null) return <div className="h-screen" />
  if (cat === 'missing')
    return <main className="mx-auto max-w-[1280px] px-4 pb-20 pt-8 text-sm text-muted sm:px-6">카탈로그 없음</main>

  const t = cat.tables.find((x) => idOf(x) === table) ?? cat.tables.find((x) => idOf(x) === 'marts.daily_metrics') ?? cat.tables[0]
  const sel = idOf(t)
  const pick = (id: string) => {
    onTable(id)
    window.scrollTo(0, 0)
  }

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 pb-20 pt-4 sm:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-ink">
          표 <span className="tnum font-normal text-muted">{cat.tables.length}개</span>
        </h2>
        <span className="tnum text-xs text-muted">카탈로그 {cat.built_at.slice(0, 10)}</span>
      </div>
      <label className="flex items-center gap-2 lg:hidden">
        <span className="shrink-0 text-xs text-muted">표</span>
        <select
          className="ctl h-9 w-full min-w-0 truncate rounded-lg border-0 bg-wash pl-2.5 font-mono text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
          value={sel}
          onChange={(e) => pick(e.target.value)}
        >
          {cat.layers.map((l) => (
            <optgroup key={l} label={l}>
              {cat.tables
                .filter((x) => x.layer === l)
                .map((x) => (
                  <option key={idOf(x)} value={idOf(x)}>
                    {idOf(x)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <TableList cat={cat} sel={sel} onSel={pick} />
        <Detail t={t} data={data} />
      </div>
    </main>
  )
}
