import { useMemo } from 'react'
import { addDays, md } from '../lib/date'
import { AB, EXP_METRICS, armDevices, inSpan, mde, quantileSorted, ratioEstimate, type RatioMetric } from '../lib/experiments'
import { num } from '../lib/format'
import type { ExpRankerRequest } from '../lib/types'
import { Block, Bullets, Para, SideTable, Spec } from './Frame'

/** 가드레일 허용 폭(나빠지는 쪽). 설계서에서 정하고 진행 점검·결과 보고가 같은 값을 쓴다. */
export const GUARD = {
  ctr: { label: '−2.0%p', limit: -0.02 },
  apply: { label: '−0.50%p', limit: -0.005 },
  p95: { label: '+30ms', limit: 30 },
}

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
  ctr: `나빠지는 쪽 구간 끝이 ${GUARD.ctr.label} 안`,
  apply: `나빠지는 쪽 구간 끝이 ${GUARD.apply.label} 안`,
  p95: `나빠지는 쪽 구간 끝이 ${GUARD.p95.label} 안`,
}

export default function ExpDesign({ rows }: { rows: ExpRankerRequest[] }) {
  const base = useMemo(() => inSpan(rows, AB.baseline), [rows])
  const dev = armDevices(base)
  const devices = dev.control + dev.treatment
  const sessions = base.filter((r) => r.is_session_first).length
  const lat = base.map((r) => r.latency_ms).sort((a, b) => a - b)
  const est = Object.fromEntries(ROLES.filter((x) => x.m).map((x) => [x.key, ratioEstimate(base, x.m!)]))
  const mdeOf = (k: string) => (est[k] ? mde(est[k]!, 1) : null)
  const success = est.success
  const mdeS = mdeOf('success')
  const pp = (v: number | null, d = 1) => (v == null ? '—' : `±${(v * 100).toFixed(d)}%p`)

  return (
    <>
      <Block title="배경·가설">
        <Para>
          평가 착수 전 실패 검색어는 대부분 상권·장르의 줄임말, 공간명 일부·소문자처럼 정식 이름과 글자가 다른 입력이었다(단계 1). 기존 랭킹(v1)은 정식
          이름과 글자가 같아야 찾고, 찾은 결과도 키워드 일치·인기 위주로 섞어 보여 준다. 4~6월 라벨(단계 2·3)로 학습한 관련도 정렬과 동의어·부분 일치를 넣은
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
            x.m ? (est[x.key] ? x.m.fmt(est[x.key]!.value) : '—') : `${quantileSorted(lat, 0.95).toFixed(0)}ms`,
            CRITERIA[x.key],
          ])}
        />
        <Para>
          가드레일 허용 폭은 결과 클릭률 {GUARD.ctr.label}, 검색 세션 신청 전환 {GUARD.apply.label}, 응답 시간 p95 {GUARD.p95.label}로 정한다. 신청 전환은
          검색에서 이어지는 매출 흐름이라 작은 하락도 막고, 응답 시간은 동의어 확장·재정렬로 늘어날 수 있어 사용자가 느끼는 수준 전에 멈춘다.
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
          {pp(mdeS)} 이상의 차이를 잡을 수 있다. 신청 전환은 세션당 전환이 드물어 {pp(mdeOf('apply'), 2)}보다 작은 하락은 이 기간으로 검출하지 못하므로,
          가드레일 판정은 구간이 허용 폭을 넘는지로 본다.
        </Para>
      </Block>

      <Block title="판정 규칙">
        <SideTable
          heads={['결정', '조건']}
          rows={[
            ['출시', '주 지표 95% 구간 하한 > 0, 그리고 가드레일 3개 모두 나빠지는 쪽 구간 끝이 허용 폭 안'],
            ['보류', '주 지표 차이 없음, 또는 가드레일 구간이 허용 폭에 걸침. 원인을 나눠 보고 다시 설계한다'],
            ['중단', '배정 비율 이상(SRM p < 0.001), 또는 가드레일 구간 전체가 허용 폭 밖, 또는 응답 장애'],
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
