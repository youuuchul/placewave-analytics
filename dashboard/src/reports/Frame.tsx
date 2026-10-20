import type { ReactNode } from 'react'
import { num } from '../lib/format'
import { REPO, type ReportMeta } from './registry'

export const SYNTHETIC_NOTE = '모든 수치는 가상 서비스 시나리오와 분포 규칙으로 생성한 합성 데이터'

export function GroupChip({ meta }: { meta: ReportMeta }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="rounded-md bg-wash px-1.5 py-0.5 font-medium text-ink2">
        {meta.group} · {meta.code}
      </span>
      {!meta.causal && <span className="rounded-md border border-line px-1.5 py-0.5 text-muted">전후 비교(인과 아님)</span>}
    </span>
  )
}

/** 보고서 한 건의 칸. 모든 보고서가 같은 순서·같은 제목으로 쓴다. */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex max-w-[760px] flex-col gap-1.5 text-[14px] leading-relaxed text-ink2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-[var(--muted)]" />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  )
}

export function Para({ children }: { children: ReactNode }) {
  return <p className="max-w-[760px] text-[14px] leading-relaxed text-ink2">{children}</p>
}

/** 가로로 넘치면 스크롤되는 표 틀. */
export function Scroll({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">{children}</div>
}

/** 두 조건(대조군·실험군, 개정 전·후, 회귀 전·중·후)을 나란히 놓는 표. */
export function SideTable({ heads, rows }: { heads: string[]; rows: ReactNode[][] }) {
  return (
    <Scroll>
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-axis text-muted">
            {heads.map((h, i) => (
              <th key={i} className={`py-2 font-medium ${i ? 'pl-3 text-left' : 'w-[22%] text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top">
              {r.map((c, j) => (
                <td key={j} className={`py-2 ${j ? 'pl-3 text-ink' : 'text-ink2'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  )
}

/** 설계 칸: 항목 · 내용 두 열. */
export function Spec({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid max-w-[860px] grid-cols-1 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[160px_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="pt-0.5 text-[13px] text-muted">{k}</dt>
          <dd className="leading-relaxed text-ink2">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function QA({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="flex max-w-[860px] flex-col divide-y divide-[var(--line)] rounded-xl border border-line">
      {items.map(([q, a]) => (
        <details key={q} className="group px-4 py-3">
          <summary className="cursor-pointer list-none text-[14px] font-medium text-ink marker:hidden">
            <span className="mr-2 text-muted group-open:hidden">+</span>
            <span className="mr-2 hidden text-muted group-open:inline">−</span>
            {q}
          </summary>
          <div className="pt-2 text-[14px] leading-relaxed text-ink2">{a}</div>
        </details>
      ))}
    </div>
  )
}

export type Cell = string | number | null

/** CSV 내려받기(엑셀 한글 깨짐 방지 BOM 포함). */
export function downloadCsv(name: string, head: string[], rows: Cell[][]) {
  const esc = (v: Cell) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const body = [head, ...rows].map((r) => r.map(esc).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 데이터셋 구성 칸: 경로 · 그레인 · 지표별 분자·분모 · 기간 규칙 · 행 수 · 재현 SQL · 기간 내 집계 표(+CSV). */
export function Dataset({
  path,
  grain,
  measures,
  rule,
  rows,
  sql,
  table,
  csv,
}: {
  path: string[]
  grain: ReactNode
  measures: [string, string, string][]
  rule: ReactNode
  rows: number | null
  sql: string
  table: { head: string[]; rows: Cell[][]; title: string }
  csv: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <Spec
        items={[
          [
            '경로',
            <span className="flex flex-wrap items-center gap-1.5 font-mono text-[12.5px]">
              {path.map((p, i) => (
                <span key={p} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-muted">→</span>}
                  <span className="rounded bg-wash px-1.5 py-0.5 text-ink">{p}</span>
                </span>
              ))}
            </span>,
          ],
          ['마트 그레인', grain],
          ['기간 규칙', rule],
          ['기간 내 마트 행 수', <span className="tnum">{rows == null ? '—' : `${num(rows)}행`}</span>],
          [
            '재현 SQL',
            <a href={`${REPO}/blob/main/${sql}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              마트·정제층 재집계 쿼리 ↗
            </a>,
          ],
        ]}
      />
      <Scroll>
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-axis text-muted">
              <th className="py-2 text-left font-medium">지표</th>
              <th className="py-2 pl-3 text-left font-medium">분자</th>
              <th className="py-2 pl-3 text-left font-medium">분모</th>
            </tr>
          </thead>
          <tbody>
            {measures.map(([m, n, d]) => (
              <tr key={m} className="border-b border-line">
                <td className="py-2 text-ink2">{m}</td>
                <td className="py-2 pl-3 font-mono text-[12.5px] text-ink">{n}</td>
                <td className="py-2 pl-3 font-mono text-[12.5px] text-ink">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] text-ink2">
            {table.title} · <span className="tnum">{num(table.rows.length)}행</span>
          </span>
          <button
            type="button"
            onClick={() => downloadCsv(csv, table.head, table.rows)}
            className="h-8 rounded-lg bg-wash px-3 text-[13px] text-ink2 hover:text-ink"
          >
            CSV 내려받기
          </button>
        </div>
        <Scroll>
          <div className="max-h-[360px] overflow-y-auto rounded-xl border border-line">
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead className="sticky top-0 bg-[var(--surface)]">
                <tr className="border-b border-axis text-muted">
                  {table.head.map((h, i) => (
                    <th key={h} className={`whitespace-nowrap px-3 py-2 font-medium ${i < 2 ? 'text-left' : 'text-right'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-b-0">
                    {r.map((c, j) => (
                      <td key={j} className={`tnum whitespace-nowrap px-3 py-1.5 ${j < 2 ? 'text-left text-ink2' : 'text-right text-ink'}`}>
                        {typeof c === 'number' ? num(c) : (c ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Scroll>
      </div>
    </div>
  )
}

/** 대시보드 딥링크 묶음. */
export function DashLinks({ items }: { items: { label: string; q: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((it) => (
        <li key={it.q}>
          <a href={`?${it.q}`} className="card inline-flex items-center gap-2 px-3 py-2 text-[13px] text-ink hover:shadow-[0_0_0_1px_var(--axis)]">
            {it.label}
            <span aria-hidden className="text-muted">
              →
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/** 판정 색. */
export const TONE: Record<'good' | 'bad' | 'muted', string> = { good: 'var(--good)', bad: 'var(--bad)', muted: 'var(--muted)' }
