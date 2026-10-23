import { useMemo } from 'react'
import { addDays, md } from '../lib/date'
import { AB, EXP_METRICS, armDevices, inSpan, mde, quantileSorted, ratioEstimate, type RatioMetric } from '../lib/experiments'
import { num } from '../lib/format'
import type { ExpRankerRequest } from '../lib/types'
import { Block, Bullets, Para, SideTable, Spec } from './Frame'

/**
 * 가드레일 규칙. 설계서에서 정하고 진행 점검·결과 보고가 같은 규칙을 쓴다.
 * 비율 가드레일은 나빠지는 쪽으로 유의한 차이가 없어야 한다(차이 95% 구간 상한 ≥ 0). 2주 표본의 최소 검출 효과보다 좁은 허용 폭은
 * 효과가 없어도 통과할 수 없어서다. 응답 시간은 검색 응답 목표(p95 250ms) 안에 머무는 예산(차이 구간 상한 ≤ +50ms).
 */
export const GUARD = { p95: { label: '+50ms', limit: 50 }, slo: 250 }
export type GuardKey = 'ctr' | 'apply' | 'p95'
export const guardPass = (key: GuardKey, ci: { lo: number; hi: number }) => (key === 'p95' ? ci.hi <= GUARD.p95.limit : ci.hi >= 0)
export const guardCall = (key: GuardKey, ok: boolean) => (ok ? (key === 'p95' ? '예산 안' : '통과') : key === 'p95' ? '예산 초과' : '유의한 하락')

export const ROLES: { role: '주 지표' | '보조 지표' | '가드레일'; m: RatioMetric | null; key: string; def: string }[] = [
  { role: '주 지표', m: EXP_METRICS.success, key: 'success', def: '결과를 1번 이상 클릭한 검색 ÷ 전체 검색' },
  { role: '보조 지표', m: EXP_METRICS.zero, key: 'zero', def: '결과 0건 검색 ÷ 전체 검색' },
  { role: '보조 지표', m: EXP_METRICS.pos, key: 'pos', def: '클릭한 검색의 첫 클릭 순위 평균' },
  { role: '보조 지표', m: EXP_METRICS.top3, key: 'top3', def: '첫 클릭이 1~3위인 검색 ÷ 클릭한 검색' },
  { role: '보조 지표', m: EXP_METRICS.reform, key: 'reform', def: '결과를 누르지 않고 같은 세션에서 다시 검색 ÷ 전체 검색' },
  { role: '가드레일', m: EXP_METRICS.ctr, key: 'ctr', def: '클릭한 검색 ÷ 결과가 있는 검색' },
  { role: '가드레일', m: EXP_METRICS.apply, key: 'apply', def: '같은 세션에서 행사 신청한 검색 세션 ÷ 검색 세션' },
  { role: '가드레일', m: null, key: 'p95', def: '검색 서버 응답 시간 95번째 백분위수' },
]

export const CRITERIA: Record<string, string> = {
  success: '95% 구간 하한 > 0',
  zero: 'Holm 보정 p < 0.05 일 때 방향 판정',
  pos: 'Holm 보정 p < 0.05 일 때 방향 판정',
  top3: 'Holm 보정 p < 0.05 일 때 방향 판정',
  reform: 'Holm 보정 p < 0.05 일 때 방향 판정',
  ctr: '유의한 하락 없음 (구간 상한 ≥ 0)',
  apply: '유의한 하락 없음 (구간 상한 ≥ 0)',
  p95: `구간 상한 ≤ ${GUARD.p95.label}`,
}

export default function ExpDesign({ rows }: { rows: ExpRankerRequest[] }) {
  const base = useMemo(() => inSpan(rows, AB.baseline), [rows])
  const dev = armDevices(base)
  const devices = dev.control + dev.treatment
  const sessions = base.filter((r) => r.is_session_first).length
  const lat = base.map((r) => r.latency_ms).sort((a, b) => a - b)
  const p95 = quantileSorted(lat, 0.95)
  const est = Object.fromEntries(ROLES.filter((x) => x.m).map((x) => [x.key, ratioEstimate(base, x.m!)]))
  const mdeOf = (k: string) => (est[k] ? mde(est[k]!, 1) : null)
  const success = est.success
  const mdeS = mdeOf('success')
  const pp = (v: number | null, d = 1) => (v == null ? '—' : `±${(v * 100).toFixed(d)}%p`)

  return (
    <>
      <Block title="배경·가설">
        <Para>
          평가 착수 전 실패 검색어는 장르·행사 유형의 줄임말·영문 표기와 상권의 한 동네 이름처럼 정식 이름과 글자가 다른 입력이었다(단계 1). 기존 랭킹(v1)은 정식
          이름과 글자가 같아야 찾고, 찾은 결과도 키워드 일치·인기 위주로 섞어 보여 준다. 단계 4에서 오프라인으로 확인한 검색어 해석(동의어·부분 일치)과 4~6월 라벨(단계 2·3)로 학습한 순위 모델을 넣은
          새 랭킹(v2)을 만들었다.
        </Para>
        <Bullets
          items={[
            '가설: 새 랭킹은 검색어를 더 많이 해석하고(결과 0건 감소) 관련도 높은 결과를 위에 올려(첫 클릭 순위 개선) 검색 성공률을 높인다.',
            '바꾸는 것: 검색어 해석(정규화·동의어·공간명 앞부분 일치)과 정렬(라벨 학습 관련도). 화면 구성·노출 개수(상위 10)는 그대로다.',
          ]}
        />
      </Block>

      <Block title="실험 설계">
        <Spec
          items={[
            ['무작위 단위', '기기(user_pseudo_id). 기기 ID 해시 앞 8자리 정수의 홀짝으로 대조군(기존 랭킹 v1) · 실험군(새 랭킹 v2) 50:50'],
            ['노출 규칙', '세션 시작 시각에 버전을 정해 세션 도중 바뀌지 않는다. 같은 기기는 기간 내내 같은 집단'],
            ['기간', `${AB.run[0]} ~ ${AB.run[1]} (14일, 요일 주기 2번). ${AB.v2All} 부터는 결과와 무관하게 실험을 닫고 판정에 따라 적용`],
            ['대상', '기간에 시작한 세션의 모든 검색 요청. 채널·플랫폼·회원 구분 없이 전부'],
            ['분석 방법', '비율 지표는 기기 단위 클러스터를 반영한 델타 방법(요청끼리 독립이 아니므로). 응답 시간 p95 는 기기 단위 부트스트랩 2,000회'],
            ['중간 점검', '7/20 에 배정 비율·실험 전 기간 비교·가드레일만 본다. 효과는 기간이 끝난 뒤 한 번만 판정한다'],
          ]}
        />
      </Block>

      <Block title="지표와 판정 기준">
        <SideTable
          heads={['역할', '지표', '정의', `기준선 (${md(AB.baseline[0])}~${md(AB.baseline[1])})`, '판정 기준']}
          rows={ROLES.map((x) => [
            x.role,
            x.m?.label ?? '응답 시간 p95',
            x.def,
            x.m ? (est[x.key] ? x.m.fmt(est[x.key]!.value) : '—') : `${p95.toFixed(0)}ms`,
            CRITERIA[x.key],
          ])}
        />
        <Para>
          가드레일은 새 랭킹이 검색 밖의 흐름을 해치지 않는지 본다. 2주 표본으로 가려낼 수 있는 변화는 결과 클릭률 {pp(mdeOf('ctr'))}, 검색 세션 신청
          전환 {pp(mdeOf('apply'), 2)} 이상이라(아래 표본 크기), 이보다 좁은 허용 폭을 두면 효과가 없어도 통과할 수 없다. 그래서 두 비율 가드레일은
          나빠지는 쪽으로 유의한 차이가 없을 것으로 판정하고, 신청 전환은 전체 적용 뒤에도 주 단위로 이어서 본다. 응답 시간은 동의어 확장·재정렬로 늘
          수 있어, 기준선 p95 {p95.toFixed(0)}ms 에서 검색 응답 목표 {GUARD.slo}ms 를 넘지 않는 {GUARD.p95.label} 를 예산으로 둔다.
        </Para>
      </Block>

      <Block title="표본 크기">
        <SideTable
          heads={['항목', `기준선 ${md(AB.baseline[0])}~${md(AB.baseline[1])} (2주, 전부 v1)`]}
          rows={[
            ['검색한 기기', `${num(devices)}대 (2주 실험이면 집단당 약 ${num(Math.round(devices / 2))}대)`],
            ['검색 요청 · 검색 세션', `${num(base.length)}건 · ${num(sessions)}세션`],
            ['검색 성공률 기준선', success ? EXP_METRICS.success.fmt(success.value) : '—'],
            ['최소 검출 효과 · 검색 성공률', pp(mdeS)],
            ['최소 검출 효과 · 결과 클릭률', pp(mdeOf('ctr'))],
            ['최소 검출 효과 · 검색 세션 신청 전환', pp(mdeOf('apply'), 2)],
          ]}
        />
        <Para>
          최소 검출 효과는 양측 α 0.05, 검정력 0.8 기준이고, 기준선 2주의 기기 단위 분산(델타 방법)을 집단당 기기 수로 나눠 구했다. 검색 성공률은{' '}
          {pp(mdeS)} 이상의 차이를 잡을 수 있다. 신청 전환은 세션당 전환이 드물어 {pp(mdeOf('apply'), 2)}보다 작은 변화는 이 기간으로 검출하지 못한다.
          가드레일을 허용 폭이 아니라 유의한 하락 여부로 둔 이유다.
        </Para>
      </Block>

      <Block title="판정 규칙">
        <SideTable
          heads={['결정', '조건']}
          rows={[
            ['출시', '주 지표 95% 구간 하한 > 0, 그리고 가드레일 3개 모두 통과'],
            ['보류', '주 지표 차이 없음. 원인을 나눠 보고 다시 설계한다'],
            ['중단', '배정 비율 이상(SRM p < 0.001), 비율 가드레일의 유의한 하락, 응답 시간 예산 초과, 또는 응답 장애'],
          ]}
        />
      </Block>

      <Block title="위험과 대응">
        <Bullets
          items={[
            '신규성 효과: 일별 효과 추이를 보고 첫 며칠에만 몰린 효과인지 확인한다.',
            '기기 2대 이상인 사람: 두 집단을 함께 볼 수 있다(효과를 줄이는 방향). 결과 보고에서 그 비중을 잰다.',
            `검색량: 실험군은 재검색이 줄어 요청 수가 적을 수 있다. 배정 비율은 요청이 아니라 기기 수로 점검한다(${md(AB.firstWeek[0])}~${md(addDays(AB.firstWeek[0], 6))} 첫 주).`,
          ]}
        />
      </Block>
    </>
  )
}
