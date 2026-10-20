import type { MouseEvent } from 'react'
import { ready, useTable, waitOf } from './lib/source'
import type { State } from './lib/state'
import type { Data } from './lib/types'
import { openReport, ReportLink } from './components/ReportLink'
import { Pending } from './components/ui'
import { GroupChip, SYNTHETIC_NOTE } from './reports/Frame'
import { GROUP_ORDER, REPORTS, type ReportMeta } from './reports/registry'
import E1 from './reports/E1'
import I1 from './reports/I1'
import X1 from './reports/X1'

type Props = { data: Data | null; s: State; set: (patch: Partial<State>) => void }

function ReportCard({ meta, s, set }: { meta: ReportMeta } & Omit<Props, 'data'>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    openReport(s, set, meta.id)
  }
  return (
    <a
      href={`?page=reports&r=${meta.id}`}
      onClick={onClick}
      data-report-card={meta.id}
      className="card flex h-full flex-col gap-3 p-4 transition-shadow hover:shadow-[0_0_0_1px_var(--axis)] sm:p-5"
    >
      <GroupChip meta={meta} />
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
        <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[32px]">보고서</h2>
        <p className="text-[13px] text-muted">{SYNTHETIC_NOTE}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {GROUP_ORDER.map((g) => (
          <section key={g} className="flex flex-col gap-3">
            <h3 className="text-[13px] font-medium text-muted">{g}</h3>
            {REPORTS.filter((r) => r.group === g).map((r) => (
              <ReportCard key={r.id} meta={r} {...p} />
            ))}
          </section>
        ))}
      </div>
    </main>
  )
}

function Body({ meta, data }: { meta: ReportMeta; data: Data }) {
  const needSearch = meta.id === 'ab-ranker-v2' || meta.id === 'issue-reindex-0901'
  const sL = useTable(data, 'daily_search', needSearch)
  const qL = useTable(data, 'daily_query', meta.id === 'issue-reindex-0901')
  if (meta.id === 'guide-v2') return <X1 data={data} />
  const search = ready(sL)
  if (meta.id === 'ab-ranker-v2') return search ? <E1 rows={search} /> : <Pending wait={waitOf(sL) ?? 'loading'} h={320} />
  const queries = ready(qL)
  return search && queries ? <I1 data={data} search={search} queries={queries} /> : <Pending wait={waitOf(sL, qL) ?? 'loading'} h={320} />
}

export default function Reports({ data, s, set }: Props) {
  const meta = REPORTS.find((r) => r.id === s.r)
  if (!meta) return <List s={s} set={set} />
  const i = REPORTS.indexOf(meta)
  const next = REPORTS[(i + 1) % REPORTS.length]
  return (
    <main className="mx-auto flex max-w-[1080px] flex-col gap-10 break-keep px-4 pb-20 pt-6 sm:px-6" data-report={meta.id}>
      <div className="flex flex-col gap-4">
        <ReportLink s={s} set={set} id="" label="보고서 목록" back className="w-fit text-[13px] text-muted hover:text-ink" />
        <GroupChip meta={meta} />
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
      <div className="flex justify-end border-t border-line pt-4">
        <ReportLink s={s} set={set} id={next.id} label={`다음 보고서 · ${next.code} ${next.title.split(' — ')[0]}`} className="text-[13px] text-accent hover:underline" />
      </div>
    </main>
  )
}
