import { useMemo } from 'react'
import { eachDay, md } from '../lib/date'
import {
  AB,
  ARM_LABEL,
  EXP_METRICS,
  armDevices,
  compareArms,
  fmtP,
  holm,
  inSpan,
  p95Diff,
  ratioEstimate,
  signedMs,
  srm,
  verdict,
  type ArmCompare,
} from '../lib/experiments'
import { num, pct } from '../lib/format'
import { DEVICE_PLATFORM_LABEL, QUERY_INTENT, S } from '../lib/labels'
import type { ExpRankerRequest } from '../lib/types'
import { TimeChart } from '../components/charts'
import { Card, Legend } from '../components/ui'
import { Block, Bullets, Dataset, DashLinks, Para, Scroll, SideTable, TONE, type Cell } from './Frame'
import { CRITERIA, GUARD, ROLES } from './ExpDesign'

const ciText = (c: ArmCompare | { metric: { diff: (v: number) => string; bound: (v: number) => string }; ci: { d: number; lo: number; hi: number } } | null) =>
  c ? `${c.metric.diff(c.ci.d)} (${c.metric.bound(c.ci.lo)} ~ ${c.metric.bound(c.ci.hi)})` : '—'

export interface ResultLine {
  key: string
  role: string
  label: string
  c: string
  t: string
  ci: string
  naive: string
  p: number
  holm: number | null
  call: string
  tone: 'good' | 'bad' | 'muted'
}

/** 결과 표 한 줄씩: 주 지표는 단일 검정, 보조 지표는 Holm 보정, 가드레일은 허용 폭 대비. 화면과 대조 스크립트가 같은 규칙을 쓴다. */
export function resultLines(run: ExpRankerRequest[]): ResultLine[] {
  const cmp = Object.fromEntries(ROLES.filter((x) => x.m).map((x) => [x.key, compareArms(run, x.m!)]))
  const lat = p95Diff(run)
  const sec = ROLES.filter((x) => x.role === '보조 지표').map((x) => x.key)
  const adj = holm(sec.map((k) => cmp[k]?.ci.p ?? 1))
  const holmOf = Object.fromEntries(sec.map((k, i) => [k, adj[i]]))
  return ROLES.map((x): ResultLine => {
    if (x.key === 'p95') {
      const ok = lat.ci.hi <= GUARD.p95.limit
      return {
        key: 'p95',
        role: x.role,
        label: '응답 시간 p95',
        c: `${lat.c.toFixed(0)}ms`,
        t: `${lat.t.toFixed(0)}ms`,
        ci: `${signedMs(lat.ci.d)} (${signedMs(lat.ci.lo)} ~ ${signedMs(lat.ci.hi)})`,
        naive: '—',
        p: lat.ci.p,
        holm: null,
        call: ok ? '허용 폭 안' : '허용 폭 밖',
        tone: ok ? 'good' : 'bad',
      }
    }
    const c = cmp[x.key]!
    const m = x.m!
    let call: string
    let tone: ResultLine['tone']
    if (x.role === '가드레일') {
      const limit = x.key === 'ctr' ? GUARD.ctr.limit : GUARD.apply.limit
      const ok = c.ci.lo >= limit
      call = ok ? '허용 폭 안' : '허용 폭 밖'
      tone = ok ? 'good' : 'bad'
    } else {
      const v = x.role === '보조 지표' && holmOf[x.key] >= 0.05 ? '차이 없음' : verdict(c.ci, m.down)
      call = v
      tone = v === '개선' ? 'good' : v === '악화' ? 'bad' : 'muted'
    }
    return {
      key: x.key,
      role: x.role,
      label: m.label,
      c: m.fmt(c.c.value),
      t: m.fmt(c.t.value),
      ci: ciText(c),
      naive: c.naive ? `${m.diff(c.naive.d)} (${m.bound(c.naive.lo)} ~ ${m.bound(c.naive.hi)})` : '—',
      p: c.ci.p,
      holm: x.role === '보조 지표' ? holmOf[x.key] : null,
      call,
      tone,
    }
  })
}

export default function E1({ rows }: { rows: ExpRankerRequest[] }) {
  const run = useMemo(() => inSpan(rows, AB.run), [rows])
  const pre = useMemo(() => inSpan(rows, AB.pre), [rows])
  const lines = useMemo(() => resultLines(run), [run])
  const dev = armDevices(run)
  const s = srm(dev.control, dev.treatment)
  const preS = compareArms(pre, EXP_METRICS.success)
  const primary = lines[0]
  const guardsOk = lines.filter((l) => l.role === '가드레일').every((l) => l.call === '허용 폭 안')
  const launch = primary.call === '개선' && guardsOk && s.p >= 0.001

  // 기기 2대 이상인 사람이 두 집단을 함께 봤는가
  const both = useMemo(() => {
    const arms = new Map<string, Set<string>>()
    for (const r of run) if (r.person_id) arms.set(r.person_id, (arms.get(r.person_id) ?? new Set()).add(r.arm))
    const multi = [...arms.values()].filter((a) => a.size > 1).length
    return { multi, persons: arms.size }
  }, [run])

  const days = eachDay(AB.run[0], AB.run[1])
  const daily = days.map((d) => {
    const day = run.filter((r) => r.kst_date === d)
    const est = (arm: 'control' | 'treatment') => ratioEstimate(day.filter((r) => r.arm === arm), EXP_METRICS.success)?.value ?? null
    return { date: d, control: est('control'), treatment: est('treatment') }
  })
  const seg = (field: 'query_intent' | 'device_platform', labels: Record<string, string>) =>
    [...new Set(run.map((r) => r[field]))]
      .sort()
      .map((v) => {
        const c = compareArms(run.filter((r) => r[field] === v), EXP_METRICS.success)
        return c ? [labels[v] ?? v, num(c.c.den + c.t.den), c.metric.fmt(c.c.value), c.metric.fmt(c.t.value), ciText(c)] : null
      })
      .filter((x): x is string[] => x != null)

  const table: Cell[][] = days.flatMap((d) =>
    (['control', 'treatment'] as const).map((arm) => {
      const g = run.filter((r) => r.kst_date === d && r.arm === arm)
      const clicked = g.filter((r) => r.is_clicked)
      return [
        d,
        ARM_LABEL[arm],
        new Set(g.map((r) => r.client_id)).size,
        g.length,
        g.filter((r) => r.is_zero_result).length,
        clicked.length,
        clicked.reduce((a, r) => a + (r.first_click_position ?? 0), 0),
        clicked.filter((r) => (r.first_click_position ?? 99) <= 3).length,
        g.filter((r) => r.is_reformulated).length,
        g.filter((r) => r.is_session_first).length,
        g.filter((r) => r.session_applied).length,
      ]
    }),
  )
  const series = [
    { key: 'control', label: '대조군 (v1)', color: S(1) },
    { key: 'treatment', label: '실험군 (v2)', color: S(2) },
  ]

  return (
    <>
      <Block title="배경">
        <Para>
          7/6 실험 설계서대로 {md(AB.run[0])}~{md(AB.run[1])} 2주 동안 기기 해시 50:50 으로 기존 랭킹(대조군)과 새 랭킹(실험군)을 비교했다. 7/20 진행 점검에서
          배정·실험 전 비교·가드레일은 기준 안이었다. 이 보고서는 기간이 끝난 뒤 한 번 하는 판정이다.
        </Para>
      </Block>

      <Block title="사전 점검">
        <SideTable
          heads={['항목', '결과']}
          rows={[
            ['배정 비율 (2주, 검색한 기기)', `대조군 ${num(dev.control)} · 실험군 ${num(dev.treatment)} (${pct(s.share)} : ${pct(1 - s.share)}) · 카이제곱 p ${fmtP(s.p)}`],
            ['실험 전 2주 검색 성공률 차이', preS ? `${ciText(preS)} · p ${fmtP(preS.ci.p)}` : '—'],
            ['기기 2대 이상으로 두 집단을 함께 본 사람', `${num(both.multi)}명 (기간 중 검색한 사람의 ${pct(both.multi / Math.max(1, both.persons))})`],
          ]}
        />
      </Block>

      <Block title="결과">
        <Card title="대조군 · 실험군 비교" meta={`${md(AB.run[0])}~${md(AB.run[1])} · 전체 검색`}>
          <Scroll>
            <table data-report="ab-ranker-v2" className="w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-axis text-muted">
                  <th className="py-2 text-left font-medium">역할</th>
                  <th className="py-2 text-left font-medium">지표</th>
                  <th className="py-2 pr-3 text-right font-medium">대조군 (v1)</th>
                  <th className="py-2 pr-3 text-right font-medium">실험군 (v2)</th>
                  <th className="py-2 pr-3 text-right font-medium">차이 (95% 구간, 기기 단위)</th>
                  <th className="py-2 pr-3 text-right font-medium">p값</th>
                  <th className="py-2 pr-3 text-right font-medium">Holm p</th>
                  <th className="py-2 pr-3 text-right font-medium">판정 기준</th>
                  <th className="py-2 text-right font-medium">판정</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} data-metric={l.key} className="border-b border-line">
                    <td className="py-2 text-muted">{l.role}</td>
                    <td className="py-2 text-ink2">{l.label}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink">{l.c}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink">{l.t}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink2">{l.ci}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink2">{fmtP(l.p)}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink2">{l.holm == null ? '—' : fmtP(l.holm)}</td>
                    <td className="py-2 pr-3 text-right text-[12px] text-muted">{CRITERIA[l.key]}</td>
                    <td className="py-2 text-right font-medium" style={{ color: TONE[l.tone] }}>
                      {l.call}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </Card>
        <Card title="검정 단위에 따른 차이" meta="같은 지표의 95% 구간">
          <SideTable
            heads={['지표', '요청 하나하나를 독립으로 본 구간', '기기 단위 구간 (판정에 사용)']}
            rows={lines.filter((l) => l.naive !== '—').map((l) => [l.label, l.naive, l.ci])}
          />
        </Card>
        <Card
          title="일별 검색 성공률"
          meta={`${md(AB.run[0])}~${md(AB.run[1])}`}
          right={<Legend items={series.map((x) => ({ label: x.label, color: x.color, kind: 'line' as const }))} />}
        >
          <TimeChart data={daily} kind="line" series={series} yFormat={(v) => pct(v, 0)} valueFormat={(v) => pct(v)} decimals />
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="의도 유형별 검색 성공률" meta="탐색적 · 보정 없음">
            <SideTable heads={['의도', '검색', '대조군', '실험군', '차이 (95% 구간)']} rows={seg('query_intent', QUERY_INTENT)} />
          </Card>
          <Card title="플랫폼별 검색 성공률" meta="탐색적 · 보정 없음">
            <SideTable heads={['플랫폼', '검색', '대조군', '실험군', '차이 (95% 구간)']} rows={seg('device_platform', DEVICE_PLATFORM_LABEL)} />
          </Card>
        </div>
      </Block>

      <Block title="해석">
        <Bullets
          items={[
            `주 지표 검색 성공률은 ${primary.c} → ${primary.t}, 차이 ${primary.ci}로 구간 하한이 0보다 크다(p ${fmtP(primary.p)}).`,
            `보조 지표는 Holm 보정 뒤에도 ${lines.filter((l) => l.role === '보조 지표' && l.call === '개선').map((l) => l.label).join(' · ') || '없음'}이 개선이다. 결과 0건이 줄어 검색이 해석되고, 관련도 높은 결과가 위로 와서 첫 클릭 순위가 앞당겨졌다.`,
            `가드레일 3개는 ${guardsOk ? '모두 허용 폭 안이다' : '허용 폭을 넘은 항목이 있다'}. ${lines
              .filter((l) => l.role === '가드레일')
              .map((l) => `${l.label} ${l.ci}`)
              .join(', ')}.`,
            '요청을 독립으로 본 구간은 기기 단위 구간보다 좁다. 한 기기의 검색끼리는 성향이 비슷해 정보가 겹치기 때문이며, 판정은 기기 단위 구간으로 했다.',
            '일별 성공률 차이는 첫 날부터 마지막 날까지 비슷한 폭으로 이어져, 첫 며칠에만 몰린 신규성 효과로 보이지 않는다. 의도 유형·플랫폼별 차이는 탐색용이다.',
          ]}
        />
      </Block>

      <Block title="결정">
        <Para>
          {launch
            ? `출시. 주 지표가 개선이고 가드레일이 모두 허용 폭 안이며 배정 비율에 이상이 없어 설계서의 출시 조건을 채웠다. ${AB.v2All} 부터 모든 세션에 새 랭킹을 적용했다.`
            : '보류. 설계서의 출시 조건을 채우지 못했다.'}
        </Para>
      </Block>

      <Block title="한계">
        <Bullets
          items={[
            '두 변경(라벨 학습 정렬, 동의어·부분 일치)을 함께 넣어 각각의 효과를 나눌 수 없다.',
            `기기 2대 이상으로 두 집단을 함께 본 사람이 ${pct(both.multi / Math.max(1, both.persons))} 있어 효과가 조금 작게 잡혔을 수 있다.`,
          ]}
        />
      </Block>

      <Block title="데이터셋 구성">
        <Dataset
          path={['raw.search_log · raw.search_click_log', 'staging.int_search', 'marts.exp_ranker_request']}
          grain={
            <>
              <span className="font-mono text-[12.5px]">exp_ranker_request</span> 1행 = 검색 요청 1건(세션 시작일 6/22~7/26). 배정 열 arm 은 기기 해시 규칙을 실험
              전 기간에도 붙인 값, 기기 단위 클러스터 분석용 client_id 포함
            </>
          }
          measures={[
            ['검색 성공률', 'is_clicked', '요청'],
            ['결과 0건 비율', 'is_zero_result', '요청'],
            ['평균 첫 클릭 순위', 'first_click_position (클릭한 요청)', 'is_clicked'],
            ['상위 3위 클릭 비중', 'first_click_position ≤ 3', 'is_clicked'],
            ['재검색률', 'is_reformulated', '요청'],
            ['결과 클릭률', 'is_clicked', 'NOT is_zero_result'],
            ['검색 세션 신청 전환', 'session_applied', 'is_session_first'],
            ['응답 시간 p95', 'latency_ms 95번째 백분위수', '—'],
          ]}
          rule={`세션 시작일 ${AB.run[0]} ~ ${AB.run[1]}. 비율 지표는 기기별 분자·분모 합으로 델타 방법 분산, p95 는 기기 부트스트랩`}
          rows={run.length}
          sql="bigquery/reports/ab_ranker_v2.sql"
          table={{
            title: '기간 내 집계 · 일 × 집단',
            head: ['날짜', '집단', '기기', '검색', '결과 0건', '클릭 검색', '첫 클릭 순위 합', '상위 3위 클릭', '재검색', '검색 세션', '신청 세션'],
            rows: table,
          }}
          csv="placewave_ab_ranker_v2.csv"
        />
      </Block>

      <Block title="대시보드에서 보기">
        <DashLinks
          items={[
            { label: '검색 탭 · 실험 기간', q: `tab=search&p=custom&from=${AB.run[0]}&to=${AB.run[1]}` },
            { label: '검색 탭 · 적용 전후 6주', q: 'tab=search&p=custom&from=2026-06-29&to=2026-08-09' },
          ]}
        />
      </Block>
    </>
  )
}
