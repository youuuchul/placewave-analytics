import { useMemo } from 'react'
import { inRange, sum } from '../lib/agg'
import { md } from '../lib/date'
import { queryStats, SEARCH_KEYS, zeroRate } from '../lib/experiments'
import { num, pct } from '../lib/format'
import { PURPOSE, QUERY_INTENT, REQUESTER, S } from '../lib/labels'
import type { Data, DailyQuery, DailySearch, WeeklyBatch } from '../lib/types'
import { TimeChart } from '../components/charts'
import { Card, Legend } from '../components/ui'
import { riskIds, status, teamPace } from '../tabs/EvalOps'
import { Block, Bullets, DashLinks, Dataset, Para, QA, SideTable, Spec, type Cell } from './Frame'

const FROM = '2026-08-29'
const TO = '2026-09-14'
const PHASES = [
  { label: '회귀 전 (8/29~8/31)', from: '2026-08-29', to: '2026-08-31' },
  { label: '회귀 중 (9/1~9/4)', from: '2026-09-01', to: '2026-09-04' },
  { label: '핫픽스 후 (9/5~9/8)', from: '2026-09-05', to: '2026-09-08' },
]
const WEEK = '2026-09-01'
const WEEK_END = '2026-09-07'
const BATCH_WEEK = '2026-09-07'
const region = (r: { query_intent: string }) => r.query_intent === 'region'

export default function I1({ data, search, queries }: { data: Data; search: DailySearch[]; queries: DailyQuery[] }) {
  const win = useMemo(() => inRange(search, FROM, TO), [search])
  const days = [...new Set(win.map((r) => r.kst_date))].sort()
  const trend = days.map((d) => {
    const day = win.filter((r) => r.kst_date === d)
    return { date: d, all: zeroRate(sum(day, [...SEARCH_KEYS])), region: zeroRate(sum(day.filter(region), [...SEARCH_KEYS])) }
  })
  const marks = [
    { x: '2026-09-01', label: '재색인' },
    { x: '2026-09-05', label: '핫픽스' },
  ]
  const phase = PHASES.map((p) => {
    const rows = inRange(win, p.from, p.to)
    const all = sum(rows, [...SEARCH_KEYS])
    const reg = sum(rows.filter(region), [...SEARCH_KEYS])
    const rest = sum(rows.filter((r) => !region(r)), [...SEARCH_KEYS])
    return { all, reg, rest }
  })
  const failed = useMemo(() => queryStats(queries, WEEK, WEEK_END).filter((q) => q.failed), [queries])
  const batches = ((data.weekly_batch ?? []) as WeeklyBatch[]).filter((b) => b.week_start === BATCH_WEEK)
  const risk = riskIds(batches, teamPace(data, BATCH_WEEK))
  const atRisk = batches.filter((b) => risk.has(b.batch_id))

  const table: Cell[][] = days.flatMap((d) => {
    const day = win.filter((r) => r.kst_date === d)
    return (
      [
        ['전체', day],
        ['상권 검색어', day.filter(region)],
      ] as const
    ).map(([k, rows]) => {
      const t = sum([...rows], [...SEARCH_KEYS])
      return [d, k, t.searches, t.zero_result_searches, pct(zeroRate(t))]
    })
  })

  return (
    <>
      <Block title="배경·질문">
        <Para>
          9월 1일 가을 캠페인을 앞두고 검색 색인을 다시 만들었다. 이때 상권 이름의 구분자(·) 정규화가 빠져 ‘홍대·합정·연남’ 같은 상권 검색어의 결과가
          0건으로 나오기 시작했다. 질문은 셋이다 — 어떻게 알아챘나, 무엇이 얼마나 나빠졌다가 돌아왔나, 대응에 든 비용은 무엇인가.
        </Para>
      </Block>

      <Block title="무엇이 바뀌었나">
        <SideTable
          heads={['지표', ...PHASES.map((p) => p.label)]}
          rows={[
            ['검색 수', ...phase.map((p) => num(p.all.searches))],
            ['결과 0건 비율 · 전체', ...phase.map((p) => pct(zeroRate(p.all)))],
            ['결과 0건 비율 · 상권 검색어', ...phase.map((p) => pct(zeroRate(p.reg)))],
            ['결과 0건 비율 · 상권 외', ...phase.map((p) => pct(zeroRate(p.rest)))],
          ]}
        />
      </Block>

      <Block title="설계">
        <Spec
          items={[
            ['감지 규칙', '검색 탭의 일별 결과 0건 비율 추이와 실패 검색어(기간 안 검색 20건 이상, 결과 0건 비율 30% 이상). 새 랭킹 전체 적용(7/27) 뒤로는 주 단위 실패 검색어가 0개였다'],
            ['원인 좁히기', '의도 유형별로 나눠 0건 증가가 구분자가 든 상권 검색어에 몰렸는지 본다'],
            ['대응', '9/5 핫픽스(구분자 정규화) · 9/7 주간 학습 배치에 실패 검색어 편입 · 9/8 회귀 검증 긴급 배치(480과제, 마감 4일, 우선순위 1)'],
            [
              '비용 측정',
              '마감 위험 규칙 — 진행 중 배치를 우선순위 → 생성일 순으로 줄 세워, 앞 배치까지 남은 과제 누적을 팀 처리량(최근 14일 완료 과제 ÷ 14)으로 나눈 일수가 마감까지 남은 일수보다 길면 위험(평가 운영 탭과 같은 규칙)',
            ],
            ['비교 구간', '회귀 전 8/29~8/31 · 회귀 중 9/1~9/4 · 핫픽스 후 9/5~9/8. 대조군 없는 전후 비교다'],
          ]}
        />
      </Block>

      <Block title="결과">
        <Card
          title="결과 0건 비율"
          meta={`일별 · ${md(FROM)}~${md(TO)}`}
          right={
            <Legend
              items={[
                { label: '전체', color: S(1), kind: 'line' },
                { label: '상권 검색어', color: S(4), kind: 'line' },
              ]}
            />
          }
        >
          <TimeChart
            data={trend}
            kind="line"
            series={[
              { key: 'all', label: '전체', color: S(1) },
              { key: 'region', label: '상권 검색어', color: S(4) },
            ]}
            yFormat={(v) => pct(v, 0)}
            valueFormat={(v) => pct(v)}
            marks={marks}
            decimals
          />
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="회귀 주 실패 검색어" meta={`${md(WEEK)}~${md(WEEK_END)} · ${failed.length}개`}>
            <SideTable
              heads={['검색어', '의도', '검색 수', '결과 0건', '평가 편입일']}
              rows={[...failed]
                .sort((x, y) => y.zero / y.searches - x.zero / x.searches)
                .map((q) => [
                  q.q.query_norm,
                  QUERY_INTENT[q.q.query_intent] ?? q.q.query_intent,
                  num(q.searches),
                  pct(q.zero / q.searches),
                  q.evalDate ? md(q.evalDate) : '—',
                ])}
            />
          </Card>
          <Card title="대응 주 배치" meta={`${md(BATCH_WEEK)} 주 · 마감 위험 ${atRisk.length}개`}>
            <SideTable
              heads={['배치', '요청 · 목적', '마감', '목표', '완료', '상태']}
              rows={[...batches]
                .sort((x, y) => x.priority - y.priority || x.created_date.localeCompare(y.created_date))
                .map((b) => {
                  const st = status(b, risk)
                  return [
                    b.batch_id,
                    `${REQUESTER[b.requester] ?? b.requester} · ${PURPOSE[b.purpose] ?? b.purpose}`,
                    md(b.due_date),
                    num(b.target_tasks),
                    num(b.done_tasks),
                    <span style={{ color: st.color }}>{st.text}</span>,
                  ]
                })}
            />
          </Card>
        </div>
      </Block>

      <Block title="해석">
        <Bullets
          items={[
            '0건 증가는 상권 검색어에 몰렸다. 상권 외 의도의 0건 비율은 회귀 전후와 같은 수준이라 캠페인 유입 변화로 설명되지 않는다.',
            '일 결과 0건 비율이 직전 3.3~5.9%에서 9/1~9/4 14.5~19.1%로 뛰었고, 9/5 핫픽스 뒤 3.1~6.2%로 돌아왔다. 결과 클릭이 있던 검색은 그대로라(행동 로그 고정) 0건 비율에만 나타났다.',
            '그 주 실패 검색어 9개는 모두 상권 검색어이고, 모두 9/7 주간 학습 배치와 9/8 회귀 검증 배치에 편입됐다 — 감지에서 평가까지 흐름이 이어졌다.',
            '비용: 회귀 검증 배치가 우선순위 1로 대기열 앞에 서면서 같은 주 정기 배치가 밀려 마감 위험 배치가 3개 나왔다. 학습 데이터 지연보다 사용자에게 보이는 회귀 확인을 먼저 뒀다.',
          ]}
        />
      </Block>

      <Block title="한계">
        <Bullets
          items={[
            '회귀는 시나리오가 넣은 사건이다. 실제라면 배포 기록과 색인 전후 비교로 원인을 확정해야 한다.',
            '회귀 검증 배치 라벨로 순위 품질이 회귀 전 수준으로 돌아왔는지는 수치로 비교하지 않았다.',
            '4일짜리 회귀라 28일 창에서는 상권 검색어의 0건 비율이 30%에 못 미쳐 실패 검색어가 0개로 보인다. 모니터링은 일·주 단위로 봐야 잡힌다.',
          ]}
        />
      </Block>

      <Block title="예상 질문">
        <QA
          items={[
            ['어떻게 감지했나?', '검색 탭의 일별 결과 0건 비율이 9/1에 평소 범위를 크게 벗어났고, 그 주 실패 검색어 표에 상권 검색어 9개가 한꺼번에 올라왔다. 의도 유형별로 나눠 상권 검색어에 몰린 것을 확인했다.'],
            [
              '실제 서비스라면 무엇을 더 했겠나?',
              '재색인 전후 0건 비율 자동 비교를 배포 게이트로 두고, 구분자·대소문자 정규화 회귀 테스트 세트, 0건 비율 일별 경보(전주 평균 + 3σ), 장애 기록(타임라인·영향 검색 수)을 붙인다.',
            ],
            ['핫픽스로 0건이 돌아왔는데 왜 회귀 검증 배치를 돌렸나?', '0건 비율이 돌아온 것만으로는 순위 품질이 같은지 모른다. 실패했던 검색어와 상위 검색어에 다시 라벨을 붙여 회귀가 남았는지 확인한다.'],
            ['정기 배치를 왜 미뤘나?', '정기 배치의 지연은 다음 학습이 며칠 늦어지는 비용이고, 회귀는 사용자가 지금 보는 결과다. 그래서 긴급 배치를 앞세우고 정기 배치의 마감 위험을 감수했다.'],
            ['28일 화면에서는 왜 안 보이나?', '실패 검색어 판정은 기간 합으로 하므로 4일짜리 급증이 28일에 희석된다. 일별 추이와 주 단위 실패 검색어를 같이 봐야 한다.'],
          ]}
        />
      </Block>

      <Block title="데이터셋 구성">
        <Dataset
          path={['raw.search_log · raw.eval_*', 'staging.int_search · int_label', 'marts.daily_search · daily_query · weekly_batch']}
          grain={
            <>
              <span className="font-mono text-[12.5px]">daily_search</span> 일 × 의도 유형 × 랭킹 버전 × 세그먼트 3축 ·{' '}
              <span className="font-mono text-[12.5px]">daily_query</span> 일 × 검색어 × 세그먼트 3축 ·{' '}
              <span className="font-mono text-[12.5px]">weekly_batch</span> 주 × 배치(주말 시점 누적)
            </>
          }
          measures={[
            ['결과 0건 비율', 'zero_result_searches', 'searches'],
            ['실패 검색어', '검색어별 Σ zero_result_searches ≥ 0.3 × Σ searches', 'Σ searches ≥ 20'],
            ['평가 편입일', 'eval_dates 중 기간 시작 ~ 끝 + 7일의 첫 날', '—'],
            ['배치 진척', 'done_tasks', 'target_tasks'],
            ['마감 위험', '우선순위 순 remaining_tasks 누적', '팀 처리량 × days_to_due'],
          ]}
          rule={`${FROM} ~ ${TO} 일별. 회귀 전·중·후 구간은 위 설계 칸의 날짜로 고정`}
          rows={win.length}
          sql="bigquery/reports/issue_reindex_0901.sql"
          table={{ title: '기간 내 집계 · 일 × 구분', head: ['날짜', '구분', 'searches', 'zero_result_searches', '결과 0건 비율'], rows: table }}
          csv="placewave_issue_reindex_0901.csv"
        />
      </Block>

      <Block title="대시보드에서 보기">
        <DashLinks
          items={[
            { label: '검색 탭 · 회귀 주', q: 'tab=search&p=custom&from=2026-09-01&to=2026-09-07' },
            { label: '검색 탭 · 8/29~9/14', q: `tab=search&p=custom&from=${FROM}&to=${TO}` },
            { label: '평가 운영 탭 · 대응 주', q: `tab=evalops&wk=${BATCH_WEEK}` },
          ]}
        />
      </Block>
    </>
  )
}
