/**
 * 보고서 묶음과 단계. 한 줄 결론의 숫자는 수치 근거(facts) 값이고, 본문 표·차트는 화면이 마트에서 계산한다.
 * 묶음 안의 단계는 시간 순서다. 주소 `r` 는 단계 id(그 단계를 연다) 또는 묶음 id(첫 단계를 연다).
 * stage 는 묶음 안의 큰 단계(목록의 단계별 보기), kind 는 문서 종류, date 는 문서 시점(시간순 보기).
 * written 은 시나리오 시점과 실제 작성일이 다른 문서의 작성일. badge 는 인과 판정이 아닌 문서의 표기.
 */
export type Stage = '발견' | '데이터 구축' | '실험' | '운영 이슈'
export type Kind = '발견' | '운영' | '개선' | '설계서' | '진행 점검' | '결과 보고' | '이슈'

export interface ReportMeta {
  id: string
  code: string
  stage: Stage
  kind: Kind
  title: string
  /** 문서 시점 (YYYY-MM-DD) */
  date: string
  period: string
  sources: string[]
  badge?: string
  written?: string
  conclusion: string
}

export interface Bundle {
  id: string
  title: string
  period: string
  conclusion: string
  stages: Stage[]
  steps: ReportMeta[]
}

export const BUNDLES: Bundle[] = [
  {
    id: 'search-quality',
    title: '검색 품질 개선',
    period: '2026-03 ~ 09',
    conclusion: '결과 0건의 원인이 줄임말·한 동네 이름 같은 입력임을 찾고, 4~6월 라벨 4.9만 건으로 학습한 새 랭킹을 기기 50:50 A/B 로 검증해 검색 성공률 +22.2%p 를 확인한 뒤 7/27 전체 적용했다. 적용 뒤 검색 세션 신청 전환은 2.99% → 4.03%(6/1~7/12 → 7/27~8/31, 전후 비교)였고, 9/1 재색인 회귀는 일별 추이로 잡아 4일 만에 되돌렸다.',
    stages: ['발견', '데이터 구축', '실험', '운영 이슈'],
    steps: [
      {
        id: 'search-failures',
        code: 'D1',
        stage: '발견',
        kind: '발견',
        title: '실패 검색어 발견: 자주 찾는 검색어의 결과 0건',
        date: '2026-03-31',
        period: '2026-03-04 ~ 03-31',
        sources: ['marts.daily_query'],
        badge: '관찰',
        conclusion: '평가 착수 전 28일 검색 5,355건 중 25.7%가 결과 0건이었고, 검색 20건 이상 검색어 47개 중 21개가 실패 검색어로 결과 0건의 60.3%를 차지했다. 모두 줄임말·영문 표기·한 동네 이름처럼 정식 이름이 아닌 입력이었다.',
      },
      {
        id: 'labeling-ops',
        code: 'O1',
        stage: '데이터 구축',
        kind: '운영',
        title: '라벨링 운영: 평가자·배치·품질 주간 운영 대시보드',
        date: '2026-04-01',
        period: '2026-04-01 ~ 09-20',
        sources: ['marts.weekly_eval_ops', 'marts.weekly_rater', 'marts.weekly_batch'],
        conclusion: '4/1~9/20 평가자 13명이 배치 52개·라벨 118,680건을 처리했다. 매주 진척·생산성·품질을 한 화면에서 보고 마감 위험 배치와 정확도 80% 미만 평가자를 그 주에 찾았다.',
      },
      {
        id: 'guide-v2',
        code: 'X1',
        stage: '데이터 구축',
        kind: '개선',
        title: '평가 지침 개정: 라벨 품질과 처리 시간 비용',
        date: '2026-06-01',
        period: '2026-06-01 전후',
        sources: ['marts.weekly_eval_ops', 'marts.weekly_rater'],
        badge: '전후 비교(인과 아님)',
        conclusion: '지침 개정 뒤 정답셋 정확도 78.4% → 86.4%, 카파 0.59 → 0.71로 올랐다. 비용은 직후 3주에 몰려 건당 처리 시간이 29.8초에서 35~38초로 늘었다가 4주째 27.4초로 돌아왔다.',
      },
      {
        id: 'ab-ranker-design',
        code: 'E1',
        stage: '실험',
        kind: '설계서',
        title: '랭킹 A/B 테스트 설계서: 가설·지표·표본·판정 규칙',
        date: '2026-07-06',
        period: '실험 2026-07-13 ~ 07-26 · 기준선 06-22 ~ 07-05',
        sources: ['marts.exp_ranker_request'],
        written: '2026-10-22',
        conclusion: '주 지표는 검색 성공률(기준선 21.6%)이고, 2주·기기 50:50 이면 ±3.3%p 이상을 잡는다. 신청 전환처럼 2주로 작은 변화를 못 가리는 가드레일은 유의한 하락이 없을 때, 응답 시간은 p95 +50ms 안일 때 출시한다.',
      },
      {
        id: 'ab-ranker-check',
        code: 'E1',
        stage: '실험',
        kind: '진행 점검',
        title: '랭킹 A/B 테스트 진행 점검: 배정·실험 전 비교·가드레일',
        date: '2026-07-20',
        period: '2026-07-13 ~ 07-19 · 실험 전 06-29 ~ 07-12',
        sources: ['marts.exp_ranker_request', 'marts.daily_search'],
        conclusion: '첫 주 배정은 619 : 597대(카이제곱 p 0.528), 실험 전 2주 비교에서 두 집단 차이가 없었고 가드레일 3개도 기준 안이라 계속 진행했다.',
      },
      {
        id: 'ab-ranker-v2',
        code: 'E1',
        stage: '실험',
        kind: '결과 보고',
        title: '랭킹 A/B 테스트 결과 보고: 기존 랭킹 vs 새 랭킹',
        date: '2026-07-27',
        period: '2026-07-13 ~ 07-26',
        sources: ['marts.exp_ranker_request'],
        conclusion: '새 랭킹이 검색 성공률을 22.8% → 44.9%(+22.2%p, 구간 +19.6 ~ +24.8)로 올렸고 가드레일 3개를 통과해 7/27 전체 적용했다. 검색 세션 신청 전환 차이(+0.75%p, 구간 −0.79 ~ +2.28)는 2주 표본으로 가려지지 않는 크기였다.',
      },
      {
        id: 'issue-reindex-0901',
        code: 'I1',
        stage: '운영 이슈',
        kind: '이슈',
        title: '9/1 재색인 회귀: 상권 검색 0건 급증 → 9/5 핫픽스 → 9/8 회귀 검증 배치',
        date: '2026-09-08',
        period: '2026-08-29 ~ 09-14',
        sources: ['marts.daily_search', 'marts.daily_query', 'marts.weekly_batch'],
        badge: '전후 비교(인과 아님)',
        conclusion: '9/1 재색인에서 구분자 정규화가 빠져 상권 검색어의 결과 0건 비율이 0.0% → 61.5%로 뛰었다. 9/5 핫픽스로 0.0%로 되돌렸고, 회귀 검증 배치가 대기열 앞에 서며 같은 주 마감 위험 배치 2개가 생겼다.',
      },
    ],
  },
]

export const REPORTS: ReportMeta[] = BUNDLES.flatMap((b) => b.steps)

/** 제목의 앞부분(쌍점 앞). 단계 이동·카드에 쓴다. */
export const shortTitle = (m: ReportMeta) => m.title.split(': ')[0]

/** 주소의 `r` 로 묶음과 단계를 찾는다. 묶음 id 면 첫 단계. */
export function findReport(r: string): { bundle: Bundle; index: number } | null {
  for (const bundle of BUNDLES) {
    if (bundle.id === r) return { bundle, index: 0 }
    const index = bundle.steps.findIndex((m) => m.id === r)
    if (index >= 0) return { bundle, index }
  }
  return null
}

export const REPO = 'https://github.com/youuuchul/placewave-analytics'
