import type { MouseEvent } from 'react'
import { ready, useTable, waitOf } from './lib/source'
import type { State } from './lib/state'
import type { Data } from './lib/types'
import { openReport, ReportLink } from './components/ReportLink'
import { Pending } from './components/ui'
import { GroupChip, SYNTHETIC_NOTE } from './reports/Frame'
import { BUNDLES, findReport, shortTitle, type Bundle, type ReportMeta } from './reports/registry'
import D1 from './reports/D1'
import E1 from './reports/E1'
import I1 from './reports/I1'
import X1 from './reports/X1'

type Props = { data: Data | null; s: State; set: (patch: Partial<State>) => void }

function opener(s: State, set: Props['set'], id: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    openReport(s, set, id)
  }
}

function StepCard({ meta, n, s, set }: { meta: ReportMeta; n: number } & Omit<Props, 'data'>) {
  return (
    <a
      href={`?page=reports&r=${meta.id}`}
      onClick={opener(s, set, meta.id)}
      data-report-card={meta.id}
      className="card flex h-full flex-col gap-3 p-4 transition-shadow hover:shadow-[0_0_0_1px_var(--axis)] sm:p-5"
    >
      <GroupChip meta={meta} step={n} />
      <span className="text-[15px] font-semibold leading-snug text-ink">{meta.title}</span>
      <span className="text-[13px] leading-relaxed text-ink2">{meta.conclusion}</span>
      <span className="tnum mt-auto text-xs text-muted">
        {meta.period} · {meta.sources.join(' · ')}
      </span>
    </a>
  )
}

function List(p: Omit<Props, 'data'>) {
  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-8 break-keep px-4 pb-20 pt-8 sm:px-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">보고서</h2>
        <p className="text-[13px] text-muted">{SYNTHETIC_NOTE}</p>
      </div>
      {BUNDLES.map((b) => (
        <section key={b.id} className="flex flex-col gap-3" data-bundle={b.id}>
          <div className="flex flex-col gap-1">
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-[17px] font-semibold text-ink">
              {b.title}
              <span className="tnum text-[13px] font-normal text-muted">
                {b.period} · {b.steps.length}단계
              </span>
            </h3>
            <p className="max-w-[860px] text-[14px] leading-relaxed text-ink2">{b.conclusion}</p>
          </div>
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {b.steps.map((m, i) => (
              <li key={m.id}>
                <StepCard meta={m} n={i + 1} {...p} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  )
}

/** 묶음의 단계 타임라인. 칸을 누르면 그 단계로 간다. */
function Steps({ bundle, index, s, set }: { bundle: Bundle; index: number } & Omit<Props, 'data'>) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`${bundle.title} 단계`}>
      {bundle.steps.map((m, i) => {
        const on = i === index
        return (
          <li key={m.id}>
            <a
              href={`?page=reports&r=${m.id}`}
              onClick={opener(s, set, m.id)}
              aria-current={on ? 'step' : undefined}
              className={`flex h-full flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors ${
                on ? 'border-[var(--accent)] bg-[var(--surface)]' : 'border-line hover:border-[var(--axis)]'
              }`}
            >
              <span className={`text-[11px] ${on ? 'font-medium text-accent' : 'text-muted'}`}>
                {i + 1} · {m.group}
              </span>
              <span className={`text-[13px] leading-snug ${on ? 'font-semibold text-ink' : 'text-ink2'}`}>{shortTitle(m)}</span>
              <span className="tnum hidden text-[11px] text-muted sm:block">{m.period}</span>
            </a>
          </li>
        )
      })}
    </ol>
  )
}

function Body({ meta, data }: { meta: ReportMeta; data: Data }) {
  const needSearch = meta.id === 'ab-ranker-v2' || meta.id === 'issue-reindex-0901'
  const needQuery = meta.id === 'issue-reindex-0901' || meta.id === 'search-failures'
  const sL = useTable(data, 'daily_search', needSearch)
  const qL = useTable(data, 'daily_query', needQuery)
  if (meta.id === 'guide-v2') return <X1 data={data} />
  const search = ready(sL)
  const queries = ready(qL)
  if (meta.id === 'search-failures') return queries ? <D1 queries={queries} /> : <Pending wait={waitOf(qL) ?? 'loading'} h={320} />
  if (meta.id === 'ab-ranker-v2') return search ? <E1 rows={search} /> : <Pending wait={waitOf(sL) ?? 'loading'} h={320} />
  return search && queries ? <I1 data={data} search={search} queries={queries} /> : <Pending wait={waitOf(sL, qL) ?? 'loading'} h={320} />
}

export default function Reports({ data, s, set }: Props) {
  const found = findReport(s.r)
  if (!found) return <List s={s} set={set} />
  const { bundle, index } = found
  const meta = bundle.steps[index]
  const prev = bundle.steps[index - 1]
  const next = bundle.steps[index + 1]
  return (
    <main className="mx-auto flex max-w-[1080px] flex-col gap-10 break-keep px-4 pb-20 pt-6 sm:px-6" data-report={meta.id}>
      <div className="flex flex-col gap-3" data-bundle-head={bundle.id}>
        <ReportLink s={s} set={set} id="" label="보고서 목록" back className="w-fit text-[13px] text-muted hover:text-ink" />
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-ink">
            {bundle.title}
            <span className="tnum text-[13px] font-normal text-muted">
              {bundle.period} · {bundle.steps.length}단계
            </span>
          </span>
          <p className="max-w-[860px] text-[13px] leading-relaxed text-ink2">{bundle.conclusion}</p>
        </div>
        <Steps bundle={bundle} index={index} s={s} set={set} />
      </div>
      <div className="flex flex-col gap-4" data-step-head={meta.id}>
        <GroupChip meta={meta} step={index + 1} />
        <h2 className="text-[24px] font-semibold leading-tight tracking-tight text-ink sm:text-[28px]">{meta.title}</h2>
        <p className="tnum text-[13px] text-muted">
          {meta.period} · {meta.sources.join(' · ')} · {SYNTHETIC_NOTE}
        </p>
        <div className="card border-l-2 border-l-[var(--accent)] px-4 py-3">
          <span className="text-xs text-muted">한 줄 결론</span>
          <p className="text-[16px] font-medium leading-snug text-ink">{meta.conclusion}</p>
        </div>
      </div>
      {data ? <Body meta={meta} data={data} /> : <Pending wait="loading" h={320} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        {prev ? (
          <ReportLink s={s} set={set} id={prev.id} label={`이전 단계 · ${index} ${shortTitle(prev)}`} back className="text-[13px] text-accent hover:underline" />
        ) : (
          <span />
        )}
        {next ? (
          <ReportLink s={s} set={set} id={next.id} label={`다음 단계 · ${index + 2} ${shortTitle(next)}`} className="text-[13px] text-accent hover:underline" />
        ) : (
          <ReportLink s={s} set={set} id="" label="보고서 목록" className="text-[13px] text-accent hover:underline" />
        )}
      </div>
    </main>
  )
}
