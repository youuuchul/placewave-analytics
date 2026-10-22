import { useMemo } from 'react'
import { groupSum, inRange } from '../lib/agg'
import { md } from '../lib/date'
import {
  avgPos,
  compareRanker,
  RANKER_GROUPS,
  rankerDaily,
  rankerSpan,
  SEARCH_KEYS,
  zeroRate,
  ZERO_SUMS,
} from '../lib/experiments'
import { dec, pct } from '../lib/format'
import { S } from '../lib/labels'
import type { DailySearch } from '../lib/types'
import { TimeChart } from '../components/charts'
import { Card, Legend } from '../components/ui'
import { Block, Bullets, DashLinks, Dataset, Para, QA, Scroll, SideTable, Spec, TONE, type Cell } from './Frame'

const G1 = `${RANKER_GROUPS.v1.name} (${RANKER_GROUPS.v1.tag})`
const G2 = `${RANKER_GROUPS.v2.name} (${RANKER_GROUPS.v2.tag})`

export default function E1({ rows }: { rows: DailySearch[] }) {
  const span = useMemo(() => rankerSpan(rows), [rows])
  const win = useMemo(() => (span ? inRange(rows, span.from, span.to) : []), [rows, span])
  const { lines } = useMemo(() => compareRanker(win), [win])
  const series = [
    { key: 'v1', label: G1, color: S(3) },
    { key: 'v2', label: G2, color: S(1) },
  ]
  const legend = <Legend items={series.map((x) => ({ label: x.label, color: x.color, kind: 'line' as const }))} />
  const days = span ? Math.round((Date.parse(span.to) - Date.parse(span.from)) / 864e5) + 1 : 0

  const table = useMemo(() => {
    const byDay = new Map<string, DailySearch[]>()
    for (const r of win) byDay.set(r.kst_date, [...(byDay.get(r.kst_date) ?? []), r])
    const out: Cell[][] = []
    for (const d of [...byDay.keys()].sort()) {
      const g = groupSum(byDay.get(d)!, (r) => r.ranker_version, [...SEARCH_KEYS])
      for (const v of ['v1', 'v2'] as const) {
        const t = g.get(v) ?? ZERO_SUMS
        out.push([d, v === 'v1' ? G1 : G2, ...SEARCH_KEYS.map((k) => t[k])])
      }
    }
    return out
  }, [win])

  return (
    <>
      <Block title="배경·질문">
        <Para>
          검색 서버 로그로 본 실패 검색어(기간 안 검색 20건 이상이고 결과 0건 비율 30% 이상)는 관련성 평가를 시작하기 전 28일(3/4~3/31)에
          검색 20건 이상 검색어 35개 중 20개였다. 4월부터 관련성 평가로 모은 라벨을 학습시키고 동의어·부분 일치를 더한 새 랭킹을 만들었다. 질문은
          하나다. 새 랭킹이 결과 0건을 줄이고 상위 결과에서 클릭이 나게 하면서도 검색당 클릭을 깎지 않는가.
        </Para>
      </Block>

      <Block title="무엇을 바꿨나">
        <SideTable
          heads={['항목', `${RANKER_GROUPS.v1.name} · ${RANKER_GROUPS.v1.what} (v1)`, `${RANKER_GROUPS.v2.name} · ${RANKER_GROUPS.v2.what} (v2)`]}
          rows={[
            ['검색어 일치', '키워드 정확 일치', '동의어·부분 일치까지'],
            ['정렬 근거', '키워드 일치 위주', '관련성 평가 라벨로 학습한 관련도'],
            ['노출', '기기 50% · A/B 기간', '기기 50% · A/B 기간, 끝난 다음 날부터 전체'],
          ]}
        />
      </Block>

      <Block title="설계">
        <Spec
          items={[
            ['배정', '기기 단위 무작위 50:50 배정(기기 ID 해시). 같은 기기는 기간 내내 같은 군'],
            [
              '배정 점검',
              '기간 중 검색한 기기는 대조군 1,217 · 실험군 1,160(51.2% : 48.8%). 50:50 기대와의 차이는 p 0.242(카이제곱 적합도)로 배정 비율 이상(SRM)이 없다. 두 군을 모두 본 기기는 1대로, 7/26 밤 세션이 자정을 넘겨 전체 적용(7/27)에 걸린 경우다',
            ],
            [
              '기간',
              span ? (
                <span className="tnum">
                  {span.from} ~ {span.to} ({days}일, 요일 주기 2번). 두 버전이 각각 그날 검색의 10% 이상인 날로 정한다
                </span>
              ) : (
                '—'
              ),
            ],
            ['대상', '기간 중 모든 검색 요청(검색 서버 로그). 클릭·재검색은 행동 로그와 매칭된 요청만 분모로 쓴다'],
            ['제외', '자정을 넘긴 세션이 다음 날에 조금 섞이는 날은 10% 기준으로 기간에서 빠진다. 채널·플랫폼·회원 필터는 걸지 않는다'],
            [
              '지표 구분',
              <>
                주 지표 결과 0건 비율 · 보조 평균 첫 클릭 순위, 상위 3위 클릭 비중 · 가드레일 검색당 클릭, 재검색률 · 참고 결과 클릭률(분모가
                바뀌는 지표) · 판정 제외 검색 세션 신청 전환. <span className="text-muted">이 구분은 2026-10-19 사후 정리다</span>
              </>,
            ],
            [
              '판정',
              '차이 = 실험군 − 대조군. 95% 구간(비율은 정규 근사, 평균 첫 클릭 순위는 웰치)이 0을 넘으면 지표 방향에 따라 개선·악화, 0을 포함하면 차이 없음. p값은 같은 근사의 양측 검정(유의수준 0.05)이라 구간 판정과 결론이 같다. 출시 판정은 주 지표 하나로 하고, 보조·가드레일 4개는 본페로니 기준(0.05 ÷ 4 = 0.0125)으로 봐도 판정이 같다',
            ],
          ]}
        />
      </Block>

      <Block title="결과">
        <Card title="대조군 · 실험군 비교" meta={span ? `${md(span.from)}~${md(span.to)} · 세그먼트 전체` : undefined}>
          <Scroll>
            <table data-report="ab-ranker-v2" className="w-full min-w-[620px] border-collapse text-[13px]">
              <colgroup>
                <col />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[26%]" />
                <col className="w-[10%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-axis text-muted">
                  <th className="py-2 text-left font-medium">지표</th>
                  <th className="py-2 pr-3 text-right font-medium">{G1}</th>
                  <th className="py-2 pr-3 text-right font-medium">{G2}</th>
                  <th className="py-2 pr-3 text-right font-medium">차이 (95% 구간)</th>
                  <th className="py-2 pr-3 text-right font-medium">p값</th>
                  <th className="py-2 text-right font-medium">판정</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} data-metric={l.id} className="border-b border-line">
                    <td className="py-2 text-ink2">{l.label}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink">{l.fmt(l.a)}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink">{l.fmt(l.b)}</td>
                    <td className="tnum py-2 pr-3 text-right text-ink2">
                      {l.ciText ?? '—'}
                    </td>
                    <td className="tnum py-2 pr-3 text-right text-ink2">{l.pText ?? '—'}</td>
                    <td className="py-2 text-right font-medium" style={{ color: TONE[l.tone] }} title={l.tip}>
                      {l.call ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="결과 0건 비율" meta="일별" right={legend}>
            <TimeChart data={rankerDaily(win, zeroRate)} kind="line" series={series} yFormat={(v) => pct(v, 0)} valueFormat={(v) => pct(v)} decimals />
          </Card>
          <Card title="평균 첫 클릭 순위" meta="일별" right={legend}>
            <TimeChart data={rankerDaily(win, avgPos)} kind="line" series={series} yFormat={(v) => dec(v, 1)} valueFormat={(v) => dec(v, 2)} decimals />
          </Card>
        </div>
      </Block>

      <Block title="해석">
        <Bullets
          items={[
            '주 지표(결과 0건 비율)와 보조 지표(평균 첫 클릭 순위, 상위 3위 클릭 비중)가 모두 실험군 쪽으로 개선됐고 95% 구간이 0을 넘는다(p < 0.001).',
            '결과 클릭률이 내려간 것은 분모 효과다. 대조군에서 0건이던 검색에 결과가 생기면서 분모(결과가 있는 매칭 검색)가 늘었는데, 이 데이터의 클릭 행동은 랭킹과 무관하게 고정돼 클릭 수는 그대로였다(한계 3). 분모를 매칭 검색 전체로 둔 검색당 클릭은 구간이 0을 포함해 차이가 없다(p 0.252).',
            '가드레일(검색당 클릭 p 0.252, 재검색률 p 0.242)은 차이가 없다. 다만 이 데이터는 클릭·재검색 행동이 랭킹과 무관하게 만들어져 가드레일이 움직일 수 없다. 실제 서비스라면 두 지표가 출시를 막을 수 있는 지표이고, 여기서는 판정 규칙이 동작하는지 확인하는 용도로 읽는다.',
          ]}
        />
      </Block>

      <Block title="한계">
        <Bullets
          items={[
            '두 변경(평가 라벨 학습, 동의어·부분 일치)을 한 번에 넣어 각각의 효과를 나눌 수 없다.',
            '배정 단위가 기기라 기기 2대 이상을 쓰는 사람(회원의 35%)은 두 군을 모두 볼 수 있다. 오염은 차이를 줄이는 방향이라 결과는 보수적이다.',
            '가상 데이터의 행동 로그(클릭·재검색·신청)는 랭킹과 무관하게 고정돼 있다. 그래서 검색 세션 신청 전환은 값만 보이고 판정에서 뺐고, 결과 클릭률 하락과 가드레일의 차이 없음도 이 고정에서 나온다. 랭킹 효과는 결과 0건 비율과 클릭 순위에서만 볼 수 있다.',
          ]}
        />
      </Block>

      <Block title="예상 질문">
        <QA
          items={[
            [
              '표본은 충분했나?',
              '사후 최소 검출 효과(양측 α 0.05, 검정력 0.8)는 결과 0건 비율 ±2.7%p, 검색당 클릭 ±3.0%p, 검색 세션 신청 전환 ±2.2%p다. 0건 비율의 관측 차이 −16.5%p는 충분히 검출되는 크기이고, 검색당 클릭의 "차이 없음"은 3%p를 넘는 하락은 없었다로 읽는다. 신청 전환은 큰 악화만 잡는 수준이다.',
            ],
            ['왜 사용자가 아니라 기기 단위로 나눴나?', '실험 기간 검색의 63.6%가 비회원 요청이라 회원 ID로는 대부분을 배정할 수 없다. 기기 ID는 행동 로그와 검색 서버 로그가 같은 체계라 매칭도 된다.'],
            ['왜 2주인가?', '요일 주기를 두 번 담는 최소 단위다. 평일·주말 검색 구성이 달라 1주보다 짧으면 요일 효과가 섞인다.'],
            ['왜 50:50인가?', '같은 표본에서 두 군을 반반으로 나눌 때 검정력이 가장 크다. 90:10이면 같은 정밀도에 약 2.78배 트래픽이 필요하다.'],
            [
              '0건 감소와 순위 개선은 각각 어느 변경 덕인가?',
              '이 설계로는 나눌 수 없다. 동의어·부분 일치는 결과가 생기는 쪽(0건 감소)에, 라벨 학습은 정렬(순위)에 더 가깝다고 추정하지만 검증하지 않았다. 다시 한다면 두 변경을 따로 켜는 2×2 배정이나 순차 실험으로 나눈다.',
            ],
          ]}
        />
      </Block>

      <Block title="데이터셋 구성">
        <Dataset
          path={['raw.search_log', 'staging.int_search', 'marts.daily_search']}
          grain={
            <>
              <span className="font-mono text-[12.5px]">daily_search</span> 1행 = 일 × 의도 유형 × 랭킹 버전 × 채널 × 플랫폼 × 회원 여부. 검색 요청은 정제층에서
              행동 로그와 기기·시각 근접(±3초)으로 매칭된다
            </>
          }
          measures={[
            ['결과 0건 비율', 'zero_result_searches', 'searches'],
            ['평균 첫 클릭 순위', 'first_click_position_sum (구간: _sq_sum)', 'clicked_searches'],
            ['상위 3위 클릭 비중', 'top3_clicks', 'clicked_searches'],
            ['결과 클릭률', 'clicked_searches', 'matched_result_searches'],
            ['검색당 클릭', 'clicked_searches', 'ga_matched_searches'],
            ['재검색률', 'reformulated_searches', 'ga_matched_searches'],
            ['검색 세션 신청 전환', 'search_sessions_applied', 'search_sessions'],
          ]}
          rule="두 버전(v1·v2)이 각각 그날 검색의 10% 이상인 날만 A/B 기간으로 본다(마트에서 날짜별 버전 비중으로 계산)"
          rows={win.length}
          sql="bigquery/reports/ab_ranker_v2.sql"
          table={{ title: '기간 내 집계 · 일 × 군', head: ['날짜', '군', ...SEARCH_KEYS], rows: table }}
          csv="placewave_ab_ranker_v2.csv"
        />
      </Block>

      <Block title="대시보드에서 보기">
        <DashLinks
          items={[
            { label: '검색 탭 · A/B 기간', q: 'tab=search&p=custom&from=2026-07-13&to=2026-07-26' },
            { label: '검색 탭 · 전후 6주', q: 'tab=search&p=custom&from=2026-06-29&to=2026-08-09' },
            { label: '평가 운영 탭 · A/B 직전 주', q: 'tab=evalops&wk=2026-07-06' },
          ]}
        />
      </Block>
    </>
  )
}
