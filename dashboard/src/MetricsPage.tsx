import { useMemo, useState } from 'react'
import { type MetricDef, useMetricSpec } from './lib/metrics'

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-8 whitespace-nowrap rounded-full px-3 text-[13px] transition-colors ${
        on ? 'bg-[var(--ink)] font-medium text-[var(--surface)]' : 'bg-wash text-ink2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/** 지표 코드 칩. 누르면 아래 지표 목록이 그 코드로 검색된다. */
function MetricChip({ id, name, onClick }: { id: string; name?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 items-center gap-1 rounded-md bg-wash px-2 text-xs text-ink2 hover:text-ink"
    >
      <span className="tnum text-[11px] text-muted">{id}</span>
      {name}
    </button>
  )
}

function hit(m: MetricDef, q: string): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  return [m.id, m.name, m.definition, m.formula, ...m.mart_columns].some((x) => x.toLowerCase().includes(s))
}

export default function MetricsPage() {
  const spec = useMetricSpec()
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    if (!spec || spec === 'error') return []
    return spec.metrics.filter((m) => (tab === 'all' || m.tab === tab) && hit(m, q.trim()))
  }, [spec, tab, q])

  if (spec === null) return <main className="mx-auto h-40 max-w-[1280px]" />
  if (spec === 'error')
    return <main className="mx-auto max-w-[1280px] px-4 pt-8 text-sm text-muted sm:px-6">지표 정의를 불러오지 못했습니다</main>

  const byId = new Map(spec.metrics.map((m) => [m.id, m]))
  const ns = spec.north_star
  const axisName = new Map((spec.axes ?? []).map((a) => [a.id, a.name]))
  const groupName = new Map(spec.groups.map((g) => [g.id, g.name]))
  const count = (id: string) => spec.metrics.filter((m) => m.tab === id).length
  const jump = (id: string) => {
    setTab('all')
    setQ(id)
    setTimeout(() => document.getElementById('metric-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0)
  }

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-10 px-4 pb-20 pt-8 sm:px-6">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">지표 가이드</h2>
        <span className="tnum text-sm text-muted">
          지표 {spec.metrics.length} · 탭 {spec.tabs.filter((t) => !t.report).length}
        </span>
      </div>

      {ns && (
        <section className="flex flex-col gap-3" id="north-star">
          <h3 className="text-[15px] font-semibold text-ink">북극성 지표</h3>
          <p className="max-w-[860px] text-[14px] leading-relaxed text-ink">{ns.definition}</p>
          <div className="card overflow-hidden">
            <div className="hidden grid-cols-[112px_minmax(0,1.4fr)_minmax(0,1fr)] gap-4 border-b border-axis px-4 py-2 text-xs font-medium text-muted lg:grid">
              <span>축</span>
              <span>입력 지표</span>
              <span>가드레일</span>
            </div>
            {ns.axes.map((a) => (
              <div
                key={a.axis}
                className="grid gap-x-4 gap-y-1.5 border-b border-line px-4 py-3 last:border-b-0 lg:grid-cols-[112px_minmax(0,1.4fr)_minmax(0,1fr)] lg:items-center"
              >
                <span className="text-[14px] font-semibold text-ink">{a.axis}</span>
                <span className="flex flex-wrap gap-1">
                  {a.inputs.map((k) => (
                    <MetricChip key={k} id={k} name={byId.get(k)?.name} onClick={() => jump(k)} />
                  ))}
                </span>
                <span className="flex flex-wrap gap-1">
                  {a.guardrails.map((g) => (
                    <MetricChip key={g.id} id={g.id} name={`${byId.get(g.id)?.name ?? ''} ${g.rule}`} onClick={() => jump(g.id)} />
                  ))}
                </span>
              </div>
            ))}
          </div>
          <details className="group max-w-[960px] rounded-xl border border-line px-4 py-3">
            <summary className="cursor-pointer list-none text-[13px] font-medium text-ink2 marker:hidden">
              <span className="mr-1 text-muted group-open:hidden">+</span>
              <span className="mr-1 hidden text-muted group-open:inline">−</span>
              근거 더 보기
            </summary>
            <div className="flex flex-col gap-4 pt-3 text-[13px] leading-relaxed text-ink2">
              <ul className="flex flex-col gap-1.5">
                {ns.reasons.map((r) => (
                  <li key={r.head}>
                    <span className="font-medium text-ink">{r.head}</span> {r.body}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted">고르지 않은 후보</span>
                <ul className="flex flex-col gap-1">
                  {ns.rejected.map((r) => (
                    <li key={r.name}>
                      <span className="text-ink">{r.name}</span> · {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted">한계</span>
                <ul className="flex flex-col gap-1">
                  {ns.limits.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {ns.sources.map((x) => (
                  <a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {x.label} ↗
                  </a>
                ))}
              </div>
            </div>
          </details>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-[15px] font-semibold text-ink">탭별 질문</h3>
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[112px_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1.4fr)] gap-4 border-b border-axis px-4 py-2 text-xs font-medium text-muted lg:grid">
            <span>탭</span>
            <span>답하는 질문</span>
            <span>주 사용자</span>
            <span>핵심 지표</span>
          </div>
          {spec.tabs.map((t) => (
            <div
              key={t.id}
              className="grid gap-x-4 gap-y-1.5 border-b border-line px-4 py-3 last:border-b-0 lg:grid-cols-[112px_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1.4fr)] lg:items-center"
            >
              <span className="text-[14px] font-semibold text-ink">{t.name}</span>
              <span className="text-[13px] leading-snug text-ink2">{t.question}</span>
              <span className="text-xs text-muted lg:text-[13px] lg:text-ink2">{t.users.join(' · ')}</span>
              <span className="flex flex-wrap gap-1">
                {t.key_metrics.map((k) => (
                  <MetricChip key={k} id={k} name={byId.get(k)?.name} onClick={() => jump(k)} />
                ))}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section id="metric-list" className="flex scroll-mt-4 flex-col gap-3">
        <h3 className="text-[15px] font-semibold text-ink">지표</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            <Chip on={tab === 'all'} onClick={() => setTab('all')}>
              전체 <span className="tnum opacity-60">{spec.metrics.length}</span>
            </Chip>
            {spec.tabs.map((t) => (
              <Chip key={t.id} on={tab === t.id} onClick={() => setTab(t.id)}>
                {t.name} <span className="tnum opacity-60">{count(t.id)}</span>
              </Chip>
            ))}
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·코드·마트 열"
            aria-label="지표 검색"
            className="ctl h-8 w-full rounded-lg border-0 bg-wash px-3 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent sm:ml-auto sm:w-56"
          />
        </div>

        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,200px)_minmax(0,1.3fr)_minmax(0,1.2fr)_72px_minmax(0,1fr)] gap-4 border-b border-axis px-4 py-2 text-xs font-medium text-muted lg:grid">
            <span>지표</span>
            <span>정의</span>
            <span>산식 · 분모</span>
            <span>단위</span>
            <span>마트 열</span>
          </div>
          {list.length === 0 && <div className="px-4 py-6 text-sm text-muted">일치하는 지표 없음</div>}
          {list.map((m) => (
            <div
              key={m.id}
              id={`m-${m.id}`}
              className="grid gap-x-4 gap-y-2 border-b border-line px-4 py-3 text-[13px] last:border-b-0 lg:grid-cols-[minmax(0,200px)_minmax(0,1.3fr)_minmax(0,1.2fr)_72px_minmax(0,1fr)]"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className={`font-semibold text-ink ${m.id === ns?.metric ? 'text-[15px]' : ''}`}>{m.name}</span>
                <span className="tnum text-xs text-muted">
                  {m.id} · {groupName.get(m.group) ?? m.group}
                  {m.axis && axisName.has(m.axis) ? ` · ${axisName.get(m.axis)}` : ''}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="leading-snug text-ink2">{m.definition}</span>
                <span className="text-xs leading-snug text-muted">{m.why}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <code className="break-words font-mono text-[12px] leading-snug text-ink">{m.formula}</code>
                {m.denominator !== '—' && <span className="text-xs text-muted">분모 · {m.denominator}</span>}
              </div>
              <span className="text-ink2">
                <span className="text-xs text-muted lg:hidden">단위 · </span>
                {m.unit}
              </span>
              <div className="flex min-w-0 flex-wrap content-start gap-1">
                {m.mart_columns.map((c) => (
                  <code key={c} className="max-w-full truncate rounded bg-wash px-1.5 py-0.5 font-mono text-[11px] text-ink2">
                    {c}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
