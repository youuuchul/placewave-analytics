import { useMemo } from 'react'
import { inRange } from '../lib/agg'
import { addDays, md, mondayOf } from '../lib/date'
import { FAILED_MIN, FAILED_ZERO, queryStats } from '../lib/experiments'
import { num, pct } from '../lib/format'
import { QUERY_INTENT, S } from '../lib/labels'
import type { DailyQuery } from '../lib/types'
import { TimeChart } from '../components/charts'
import { Card } from '../components/ui'
import { Block, Bullets, DashLinks, Dataset, Para, SideTable, Spec, type Cell } from './Frame'

const FROM = '2026-03-04'
const TO = '2026-03-31'
const FIRST_BATCH = '2026-04-01'
const MARKS = [
  { x: '2026-03-30', label: '평가 시작' },
  { x: '2026-07-13', label: '새 랭킹 A/B' },
  { x: '2026-08-31', label: '재색인' },
]

export default function D1({ queries }: { queries: DailyQuery[] }) {
  const win = useMemo(() => inRange(queries, FROM, TO), [queries])
  const stats = useMemo(() => queryStats(queries, FROM, TO), [queries])
  const failed = [...stats.filter((q) => q.failed)].sort((x, y) => y.zero / y.searches - x.zero / x.searches)
  const total = win.reduce((a, r) => ({ searches: a.searches + r.searches, zero: a.zero + r.zero_result_searches }), { searches: 0, zero: 0 })
  const failedZero = failed.reduce((a, q) => a + q.zero, 0)
  const firstBatch = failed.filter((q) => q.evalDate === FIRST_BATCH).length

  const weekly = useMemo(() => {
    const m = new Map<string, Map<string, [number, number]>>()
    for (const r of queries) {
      const w = mondayOf(r.kst_date)
      const qs = m.get(w) ?? new Map<string, [number, number]>()
      const z = qs.get(r.query_norm) ?? [0, 0]
      qs.set(r.query_norm, [z[0] + r.searches, z[1] + r.zero_result_searches])
      m.set(w, qs)
    }
    return [...m]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([w, qs]) => ({ date: w, failed: [...qs.values()].filter(([s, z]) => s >= FAILED_MIN && z / s >= FAILED_ZERO).length }))
  }, [queries])

  const byIntent = Object.entries(
    failed.reduce<Record<string, number>>((a, q) => ({ ...a, [q.q.query_intent]: (a[q.q.query_intent] ?? 0) + 1 }), {}),
  ).sort((x, y) => y[1] - x[1])
  const weeks = (from: string, to: string) => weekly.filter((w) => w.date >= from && w.date <= to).map((w) => w.failed)
  const pre = weeks('2026-02-02', '2026-07-06')
  const post = weeks('2026-07-27', '2026-08-24')
  const regWeek = weekly.find((w) => w.date === '2026-08-31')?.failed ?? 0

  const table: Cell[][] = [...stats]
    .sort((x, y) => Number(y.failed) - Number(x.failed) || y.zero / y.searches - x.zero / x.searches)
    .map((q) => [
      q.q.query_norm,
      QUERY_INTENT[q.q.query_intent] ?? q.q.query_intent,
      q.searches,
      q.zero,
      pct(q.zero / q.searches),
      q.failed ? '실패' : '',
      q.evalDate,
    ])

  return (
    <>
      <Block title="배경·질문">
        <Para>
          런칭 뒤 검색이 늘면서 결과가 0건인 검색이 쌓였다. 관련성 평가를 시작하기 전 28일(3/4~3/31) 검색 {num(total.searches)}건 중{' '}
          {pct(total.zero / total.searches)}가 결과 0건이었다. 질문은 어떤 검색어가 반복해서 실패하는지, 그중 무엇부터 평가해 고칠지 두 가지다.
        </Para>
      </Block>

      <Block title="무엇을 정했나">
        <Bullets
          items={[
            '실패 검색어 기준: 기간 안 검색 20건 이상이고 결과 0건 비율 30% 이상인 정규화 검색어. 한두 번의 오타가 아니라 반복해서 실패하는 검색어만 남긴다.',
            '4/1 관련성 평가를 시작하고, 매주 배치에 직전 7일의 실패 검색어 → 상위 검색량 → 무작위 순으로 검색어를 넣는다.',
            '검색 탭에 실패 검색어 표와 평가 편입일 열을 두어 실패가 평가로 넘어갔는지 확인한다.',
          ]}
        />
      </Block>

      <Block title="설계">
        <Spec
          items={[
            ['단위', '정규화 검색어(query_norm)'],
            ['관찰 기간', '평가 착수 전 28일(3/4~3/31)'],
            ['실패 기준', '기간 안 검색 20건 이상 ∧ 결과 0건 비율 30% 이상. 주 단위 추이는 월요일 시작 7일마다 같은 기준'],
            ['평가 편입', '기간 시작 ~ 끝 + 7일 안에 검색팀 배치(실패·상위 검색량·무작위 출처)에 들어간 첫 날. 추천 슬롯 배치는 뺀다'],
            ['성격', '관찰. 비교 대상 없이 기준을 정하고 평가할 검색어를 고른 단계다'],
          ]}
        />
      </Block>

      <Block title="결과">
        <SideTable
          heads={['지표', '평가 착수 전 28일 (3/4~3/31)']}
          rows={[
            ['검색 수', num(total.searches)],
            ['결과 0건 비율', pct(total.zero / total.searches)],
            ['검색 20건 이상 검색어', `${num(stats.length)}개`],
            ['실패 검색어', `${num(failed.length)}개`],
            ['전체 결과 0건 중 실패 검색어 몫', `${pct(failedZero / total.zero)} (${num(failedZero)} / ${num(total.zero)})`],
            ['4/1 첫 평가 배치 편입', `${num(firstBatch)}개`],
          ]}
        />
        <Card title="실패 검색어" meta={`${md(FROM)}~${md(TO)} · ${failed.length}개`}>
          <SideTable
            heads={['검색어', '의도', '검색 수', '결과 0건', '평가 편입일']}
            rows={failed.map((q) => [
              q.q.query_norm,
              QUERY_INTENT[q.q.query_intent] ?? q.q.query_intent,
              num(q.searches),
              pct(q.zero / q.searches),
              q.evalDate ? md(q.evalDate) : '—',
            ])}
          />
        </Card>
        <Card title="주별 실패 검색어 수" meta={`월요일 시작 7일 · ${md(weekly[0]?.date ?? FROM)}~${md(addDays(weekly[weekly.length - 1]?.date ?? TO, 6))}`}>
          <TimeChart
            data={weekly}
            kind="bar"
            series={[{ key: 'failed', label: '실패 검색어', color: S(4) }]}
            yFormat={(v) => num(v)}
            valueFormat={(v) => `${num(v)}개`}
            marks={MARKS}
          />
        </Card>
      </Block>

      <Block title="해석">
        <Bullets
          items={[
            `검색 20건 이상 검색어 ${num(stats.length)}개 중 ${num(failed.length)}개가 실패 기준을 넘었고, 이 ${num(failed.length)}개가 같은 기간 결과 0건의 ${pct(failedZero / total.zero)}를 차지했다. 실패는 드문 오타가 아니라 자주 찾는 검색어에 몰려 있었다.`,
            `실패 검색어를 의도로 나누면 ${byIntent.map(([k, n]) => `${QUERY_INTENT[k] ?? k} ${n}개`).join(' · ')}다. __D1_PATTERN__`,
            `${num(firstBatch)}개가 ${md(FIRST_BATCH)} 첫 평가 배치에 들어갔다.`,
            `주 단위로 보면 실패 검색어는 평가 착수 전후(2~6월) 주당 ${Math.min(...pre)}~${Math.max(...pre)}개였고, 새 랭킹 전체 적용(7/27) 뒤 ${Math.max(...post) === 0 ? '0개가 됐다' : `주당 ${Math.max(...post)}개 이하로 줄었다`}. 재색인 회귀 주(8/31)에 ${regWeek}개로 다시 나타났다(단계 7).`,
          ]}
        />
      </Block>

      <Block title="한계">
        <Bullets
          items={[
            '결과 0건만 실패로 본다. 결과는 있지만 엉뚱한 결과는 이 기준으로 잡히지 않는다. 그래서 사람이 결과의 관련성을 평가하는 단계(단계 2)가 필요했다.',
            '20건 · 30% 기준은 검색량에 맞춰 정한 값이다. 기준을 바꾸면 실패 검색어 수가 달라진다.',
          ]}
        />
      </Block>

      <Block title="데이터셋 구성">
        <Dataset
          path={['raw.search_log', 'staging.int_search', 'marts.daily_query']}
          grain={
            <>
              <span className="font-mono text-[12.5px]">daily_query</span> 일 × 검색어 × 세그먼트 3축
            </>
          }
          measures={[
            ['결과 0건 비율', 'zero_result_searches', 'searches'],
            ['실패 검색어', '검색어별 Σ zero_result_searches ≥ 0.3 × Σ searches', 'Σ searches ≥ 20'],
            ['평가 편입일', 'eval_dates 중 기간 시작 ~ 끝 + 7일의 첫 날', '—'],
          ]}
          rule={`${FROM} ~ ${TO} 합계로 검색어별 판정. 주별 실패 검색어는 월요일 시작 7일마다 같은 기준`}
          rows={win.length}
          sql="bigquery/reports/search_failures.sql"
          table={{
            title: '기간 내 집계 · 검색 20건 이상 검색어',
            head: ['검색어', '의도', 'searches', 'zero_result_searches', '결과 0건 비율', '실패', '평가 편입일'],
            rows: table,
          }}
          csv="placewave_search_failures.csv"
        />
      </Block>

      <Block title="대시보드에서 보기">
        <DashLinks
          items={[
            { label: '검색 탭 · 평가 착수 전 28일', q: `tab=search&p=custom&from=${FROM}&to=${TO}` },
            { label: '검색 탭 · 1년', q: 'tab=search&p=365' },
          ]}
        />
      </Block>
    </>
  )
}
