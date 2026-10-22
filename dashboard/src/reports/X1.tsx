import { useMemo } from 'react'
import { groupSum } from '../lib/agg'
import { md } from '../lib/date'
import { dec, num, pct } from '../lib/format'
import { S } from '../lib/labels'
import type { Data } from '../lib/types'
import { TimeChart } from '../components/charts'
import { Card, Legend } from '../components/ui'
import { acc, agree, evalWeeks, GUIDELINE_V2, kappa, type Ops, OPS_KEYS, perLabel, rework } from '../tabs/EvalOps'
import { Block, Bullets, DashLinks, Dataset, Para, SideTable, Spec, type Cell } from './Frame'

const V1 = '개정 전 (v1)'
const V2 = '개정 후 (v2)'
const signed = (v: number | null, f: (x: number) => string) => (v == null ? '—' : `${v > 0 ? '+' : ''}${f(v)}`)

export default function X1({ data }: { data: Data }) {
  const weeks = evalWeeks(data)
  const last = weeks[weeks.length - 1]
  const ops = useMemo(() => (data.weekly_eval_ops ?? []).filter((r) => r.week_start <= last), [data, last])
  const zero = Object.fromEntries(OPS_KEYS.map((k) => [k, 0])) as Ops
  const byGuide = groupSum(ops, (r) => r.guideline_version, [...OPS_KEYS])
  const a = byGuide.get('v1') ?? zero
  const b = byGuide.get('v2') ?? zero
  const byWeek = groupSum(ops, (r) => r.week_start, [...OPS_KEYS])
  const trend = weeks.map((w) => {
    const t = byWeek.get(w) ?? zero
    return { date: w, acc: acc(t), agree: agree(t), kappa: kappa(t), sec: perLabel(t) }
  })
  const marks = [{ x: GUIDELINE_V2, label: '평가 지침 개정' }]
  const firstV2 = weeks.find((w) => w >= GUIDELINE_V2) ?? GUIDELINE_V2
  const around = weeks.filter((w) => w >= weeks[Math.max(0, weeks.indexOf(firstV2) - 1)] && w <= weeks[Math.min(weeks.length - 1, weeks.indexOf(firstV2) + 3)])

  const band = (k: number | null) => (k == null ? '—' : k > 0.8 ? '거의 완전' : k > 0.6 ? '상당' : k > 0.4 ? '보통' : k > 0.2 ? '약간' : '낮음')
  const at = (i: number) => trend[weeks.indexOf(firstV2) + i]
  const prevWk = at(-1)
  const after3 = [at(0), at(1), at(2)].filter(Boolean)
  const wk4 = at(3)
  const secTxt = (t: { sec: number | null } | undefined) => (t?.sec == null ? '—' : t.sec.toFixed(1))
  const gt = (x: number | null, y: number | null) => x != null && y != null && x > y
  const better = [gt(acc(b), acc(a)), gt(agree(b), agree(a)), gt(kappa(b), kappa(a)), gt(rework(a), rework(b))].filter(Boolean).length
  const preAcc = weeks
    .filter((w) => w < firstV2)
    .slice(-3)
    .map((w) => trend[weeks.indexOf(w)].acc ?? 0)
  const rising = preAcc.length === 3 && preAcc[2] > preAcc[0]
  const leftover = ops.filter((r) => r.week_start === firstV2 && r.guideline_version === 'v1').reduce((x, r) => x + r.labels, 0)
  const pp = (x: number) => `${(x * 100).toFixed(1)}%p`
  const rows: [string, string, string, string][] = [
    ['라벨 수', num(a.labels), num(b.labels), '—'],
    ['정답셋 정확도', pct(acc(a)), pct(acc(b)), signed(dd(acc(b), acc(a)), pp)],
    ['평가자 간 일치율', pct(agree(a)), pct(agree(b)), signed(dd(agree(b), agree(a)), pp)],
    ['일치도 카파', dec(kappa(a), 2), dec(kappa(b), 2), signed(dd(kappa(b), kappa(a)), (x) => x.toFixed(2))],
    ['재작업률', pct(rework(a)), pct(rework(b)), signed(dd(rework(b), rework(a)), pp)],
    ['건당 처리 시간 (누적 평균)', `${dec(perLabel(a), 1)}초`, `${dec(perLabel(b), 1)}초`, signed(dd(perLabel(b), perLabel(a)), (x) => `${x.toFixed(1)}초`)],
  ]

  const table: Cell[][] = useMemo(() => {
    const g = groupSum(ops, (r) => `${r.week_start}|${r.guideline_version}`, [...OPS_KEYS])
    return [...g.entries()]
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([k, t]) => {
        const [w, v] = k.split('|')
        return [w, v === 'v1' ? V1 : V2, ...OPS_KEYS.map((c) => t[c])]
      })
  }, [ops])

  return (
    <>
      <Block title="배경·질문">
        <Para>
          4월 관련성 평가를 시작한 뒤 두 달 동안 상권 경계, 장르 겹침처럼 등급 경계(약관련·관련)에 있는 사례에서 평가자 판단이 갈렸다. 6월 1일
          지침에 그런 경계 사례 예시를 더했다. 질문은 라벨 품질(정확도·일치도)이 좋아졌는지, 그 대가로 처리 시간이 얼마나 늘었고 언제 돌아왔는지 두 가지다.
        </Para>
      </Block>

      <Block title="무엇을 바꿨나">
        <SideTable
          heads={['항목', V1, V2]}
          rows={[
            ['지침 내용', '등급 정의(0 무관 · 1 약관련 · 2 관련 · 3 정확)', '같은 등급 정의 + 상권 경계 · 장르 겹침 경계 사례 예시'],
            ['적용 범위', '6/1 이전에 만든 배치', '6/1 이후에 만든 배치(라벨은 속한 배치의 지침을 따른다)'],
            ['그대로인 것', '4점 척도, 과제당 라벨 3개, 정답셋 약 10% 혼입', '같음'],
          ]}
        />
      </Block>

      <Block title="설계">
        <Spec
          items={[
            ['비교 단위', '라벨이 속한 배치의 지침 버전'],
            ['기간', <span className="tnum">개정 전 = 평가 시작 주 ~ 5/25 주 · 개정 후 = 6/1 주 ~ {md(last)} 주(마지막 완료 주) 누적</span>],
            ['대상', '요청 부서 전체(검색 · 추천 슬롯), 평가자 전체'],
            ['지표', '품질 = 정답셋 정확도, 평가자 간 일치율, 일치도 카파, 재작업률 · 비용 = 건당 처리 시간(누적 평균과 주별)'],
            ['판정', '대조군이 없어 통계 판정을 하지 않는다. 표의 차이는 전후 차이일 뿐 개정 효과로 단정하지 않는다'],
          ]}
        />
      </Block>

      <Block title="결과">
        <Card title="개정 전 · 후 비교" meta={`${md(last)} 주까지 누적 · 요청 부서 전체`}>
          <SideTable heads={['지표', V1, V2, '차이']} rows={rows} />
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="품질 추이"
            meta="주별"
            right={
              <Legend
                items={[
                  { label: '정확도', color: S(1), kind: 'line' },
                  { label: '일치율', color: S(2), kind: 'line' },
                  { label: '카파', color: S(3), kind: 'line' },
                ]}
              />
            }
          >
            <TimeChart
              data={trend}
              kind="line"
              series={[
                { key: 'acc', label: '정확도', color: S(1) },
                { key: 'agree', label: '일치율', color: S(2) },
                { key: 'kappa', label: '카파', color: S(3) },
              ]}
              yFormat={(v) => dec(v, 1)}
              valueFormat={(v) => dec(v, 3)}
              tipTitle={(d) => `${d} 주`}
              marks={marks}
              yDomain={[0.4, 1]}
              decimals
            />
          </Card>
          <Card title="건당 처리 시간" meta="주별 · 초" right={<Legend items={[{ label: '건당 처리 시간', color: S(4), kind: 'line' }]} />}>
            <TimeChart
              data={trend}
              kind="line"
              series={[{ key: 'sec', label: '건당 처리 시간', color: S(4) }]}
              yFormat={(v) => dec(v, 0)}
              valueFormat={(v) => `${dec(v, 1)}초`}
              tipTitle={(d) => `${d} 주`}
              marks={marks}
              decimals
            />
          </Card>
        </div>
        <Card title="개정 직후 처리 시간" meta="주별 · 요청 부서 전체">
          <SideTable
            heads={['주', ...around.map((w) => md(w))]}
            rows={[['건당 처리 시간', ...around.map((w) => `${dec(perLabel(byWeek.get(w) ?? zero), 1)}초`)]]}
          />
        </Card>
      </Block>

      <Block title="해석">
        <Bullets
          items={[
            `품질 지표 넷 중 ${better}개가 개정 후 쪽이 좋다. 정답셋 정확도 ${pct(acc(a))} → ${pct(acc(b))}, 일치율 ${pct(agree(a))} → ${pct(agree(b))}, 카파 ${dec(kappa(a), 2)} → ${dec(kappa(b), 2)}(우연 일치를 뺀 일치도가 ${band(kappa(a))} → ${band(kappa(b))} 수준), 재작업률 ${pct(rework(a))} → ${pct(rework(b))}.`,
            `비용은 개정 직후 3주에 몰렸다. 건당 처리 시간이 개정 전 주 ${secTxt(prevWk)}초에서 ${after3.map(secTxt).join(' · ')}초로 늘었다가 4주째 ${secTxt(wk4)}초로 돌아왔고, 누적 평균은 ${dec(perLabel(a), 1)}초 → ${dec(perLabel(b), 1)}초다.`,
            rising
              ? '주별 품질 추이를 보면 개정 전 마지막 주들에도 정확도가 오르는 중이었다. 그래서 표의 차이 전부를 지침 덕으로 볼 수 없다.'
              : '개정 전 마지막 3주의 정확도는 오르는 추세가 아니었다. 다만 대조군이 없어 차이 전부를 지침 덕으로 볼 수는 없다(한계).',
          ]}
        />
      </Block>

      <Block title="한계">
        <Bullets
          items={[
            '대조군이 없다. 같은 기간 평가자 숙련(입사 후 적응)과 구성 변화(5월 확대, 7~8월 외부 평가자 교체)가 함께 움직여 개정 효과만 떼어 낼 수 없다.',
            `개정 주에 옛 지침 배치의 잔여 라벨이 ${num(leftover)}건뿐이라 같은 주 안의 두 지침 비교도 할 수 없다.`,
            '정답셋 정확도는 정답셋 과제(과제의 약 10%)에서만 잰다. 일치율·카파는 같은 과제를 함께 본 평가자 쌍에서 잰다.',
          ]}
        />
      </Block>

      <Block title="데이터셋 구성">
        <Dataset
          path={['raw.eval_labels', 'staging.int_label', 'marts.weekly_eval_ops']}
          grain={
            <>
              <span className="font-mono text-[12.5px]">weekly_eval_ops</span> 1행 = 주 × 요청 부서 × 평가자 그룹 × 지침 버전. 카파는 성분(쌍 수·일치 쌍 수·등급별
              최종 라벨 수)으로 저장하고 화면에서 계산한다
            </>
          }
          measures={[
            ['정답셋 정확도', 'gold_correct', 'gold_labels'],
            ['평가자 간 일치율', 'agree_pairs', 'label_pairs'],
            ['일치도 카파', '(Po − Pe), Pe = Σ(labels_g0~g3 ÷ final_labels)²', '(1 − Pe)'],
            ['재작업률', 'rework_labels', 'labels'],
            ['건당 처리 시간', 'handle_seconds', 'labels'],
          ]}
          rule="지침 버전은 라벨이 속한 배치 기준. 마지막 완료 주(주 끝이 기준일 이하)까지 누적"
          rows={ops.length}
          sql="bigquery/reports/guide_v2.sql"
          table={{ title: '기간 내 집계 · 주 × 지침', head: ['주', '지침', ...OPS_KEYS], rows: table }}
          csv="placewave_guide_v2.csv"
        />
      </Block>

      <Block title="라벨링 운영 대시보드에서 보기">
        <DashLinks
          items={[
            { label: '라벨링 운영 · 개정 주', q: 'page=reports&r=labeling-ops&wk=2026-06-01' },
            { label: '라벨링 운영 · 개정 3주째', q: 'page=reports&r=labeling-ops&wk=2026-06-15' },
            { label: '라벨링 운영 · 최근 주', q: `page=reports&r=labeling-ops&wk=${last}` },
          ]}
        />
      </Block>
    </>
  )
}

function dd(x: number | null, y: number | null): number | null {
  return x == null || y == null ? null : x - y
}
