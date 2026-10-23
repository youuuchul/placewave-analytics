import { useState, type MouseEvent } from 'react'
import { md } from './lib/date'
import { ready, useTable, waitOf } from './lib/source'
import type { State } from './lib/state'
import type { Data } from './lib/types'
import { openReport, ReportLink } from './components/ReportLink'
import { Pending, Segmented } from './components/ui'
import { GroupChip } from './reports/Frame'
import { BUNDLES, findReport, shortTitle, type Bundle, type ReportMeta } from './reports/registry'
import D1 from './reports/D1'
import E1 from './reports/E1'
import ExpCheck from './reports/ExpCheck'
import ExpDesign from './reports/ExpDesign'
import I1 from './reports/I1'
import LabelOps from './reports/LabelOps'
import M1 from './reports/M1'
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
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex flex-wrap items-center gap-2">
          <GroupChip meta={meta} step={n} />
          {meta.major && <span className="rounded-md border border-[var(--accent)] px-1.5 py-0.5 text-xs font-medium text-accent">주요</span>}
        </span>
        <span className="tnum text-xs text-muted">{md(meta.date)}</span>
      </span>
      <span className={`text-[15px] leading-snug ${meta.major ? 'font-bold text-accent' : 'font-semibold text-ink'}`}>{meta.title}</span>
      <span className="text-[13px] leading-relaxed text-ink2">{meta.conclusion}</span>
      <span className="tnum mt-auto text-xs text-muted">{meta.period}</span>
    </a>
  )
}

function BundleList({ b, view, ...p }: { b: Bundle; view: 'stage' | 'time' } & Omit<Props, 'data'>) {
  const n = (m: ReportMeta) => b.steps.indexOf(m) + 1
  if (view === 'time')
    return (
      <ol className="flex flex-col gap-2">
        {[...b.steps]
          .sort((x, y) => x.date.localeCompare(y.date))
          .map((m) => (
            <li key={m.id} className="grid gap-x-4 gap-y-1 sm:grid-cols-[72px_minmax(0,1fr)]">
              <span className="tnum pt-4 text-[13px] font-medium text-ink2">{md(m.date)}</span>
              <StepCard meta={m} n={n(m)} {...p} />
            </li>
          ))}
      </ol>
    )
  return (
    <div className="flex flex-col gap-5">
      {b.stages.map((st) => (
        <section key={st} className="flex flex-col gap-2">
          <h4 className="text-[13px] font-medium text-muted">{st}</h4>
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {b.steps
              .filter((m) => m.stage === st)
              .map((m) => (
                <li key={m.id}>
                  <StepCard meta={m} n={n(m)} {...p} />
                </li>
              ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function List(p: Omit<Props, 'data'>) {
  const [view, setView] = useState<'stage' | 'time'>('stage')
  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-8 break-keep px-4 pb-20 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">보고서</h2>
        <Segmented
          label="보기"
          value={view}
          onChange={setView}
          options={[
            { value: 'stage', label: '단계별' },
            { value: 'time', label: '시간순' },
          ]}
        />
      </div>
      {BUNDLES.map((b) => (
        <section key={b.id} className="flex flex-col gap-4" data-bundle={b.id}>
          <div className="flex flex-col gap-1">
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-[17px] font-semibold text-ink">
              {b.title}
              <span className="tnum text-[13px] font-normal text-muted">
                {b.period} · 보고서 {b.steps.length}건
              </span>
            </h3>
            <p className="max-w-[860px] text-[14px] leading-relaxed text-ink2">{b.conclusion}</p>
          </div>
          <BundleList b={b} view={view} {...p} />
        </section>
      ))}
    </main>
  )
}

/** 묶음의 단계 타임라인(시간 순서). 칸을 누르면 그 단계로 간다. */
function Steps({ bundle, index, s, set }: { bundle: Bundle; index: number } & Omit<Props, 'data'>) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8" aria-label={`${bundle.title} 단계`}>
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
                {i + 1} · {m.kind}
              </span>
              <span className={`text-[13px] leading-snug ${on || m.major ? 'font-semibold' : ''} ${m.major ? 'text-accent' : on ? 'text-ink' : 'text-ink2'}`}>
                {shortTitle(m)}
              </span>
              <span className="tnum hidden text-[11px] text-muted sm:block">{md(m.date)}</span>
            </a>
          </li>
        )
      })}
    </ol>
  )
}

function Body({ meta, data, s, set }: { meta: ReportMeta } & Props & { data: Data }) {
  const id = meta.id
  const exp = id === 'ab-ranker-design' || id === 'ab-ranker-check' || id === 'ab-ranker-v2'
  const sL = useTable(data, 'daily_search', id === 'issue-reindex-0901' || id === 'ab-ranker-check')
  const qL = useTable(data, 'daily_query', id === 'issue-reindex-0901' || id === 'search-failures')
  const eL = useTable(data, 'exp_ranker_request', exp)
  const mL = useTable(data, 'ranker_eval', id === 'ranker-model')
  const search = ready(sL)
  const queries = ready(qL)
  const rows = ready(eL)
  const pairs = ready(mL)
  const wait = (h = 320, ...ls: Parameters<typeof waitOf>) => <Pending wait={waitOf(...ls) ?? 'loading'} h={h} />
  if (id === 'labeling-ops') return <LabelOps data={data} s={s} set={set} />
  if (id === 'guide-v2') return <X1 data={data} />
  if (id === 'search-failures') return queries ? <D1 queries={queries} /> : wait(320, qL)
  if (id === 'ranker-model')
    return pairs ? <M1 pairs={pairs} queries={data.ranker_query_eval ?? []} features={data.ranker_feature ?? []} /> : wait(320, mL)
  if (id === 'ab-ranker-design') return rows ? <ExpDesign rows={rows} /> : wait(320, eL)
  if (id === 'ab-ranker-check') return rows && search ? <ExpCheck rows={rows} search={search} /> : wait(320, eL, sL)
  if (id === 'ab-ranker-v2') return rows ? <E1 rows={rows} /> : wait(320, eL)
  return search && queries ? <I1 data={data} search={search} queries={queries} /> : wait(320, sL, qL)
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
              {bundle.period} · 보고서 {bundle.steps.length}건
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
          {meta.written ? `작성 ${meta.date} · 최종 수정 ${meta.written}` : `작성 ${meta.date}`} · {meta.period} · {meta.sources.join(' · ')}
        </p>
        <div className="card border-l-2 border-l-[var(--accent)] px-4 py-3">
          <span className="text-xs text-muted">한 줄 결론</span>
          <p className="text-[16px] font-medium leading-snug text-ink">{meta.conclusion}</p>
        </div>
      </div>
      {data ? <Body meta={meta} data={data} s={s} set={set} /> : <Pending wait="loading" h={320} />}
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
