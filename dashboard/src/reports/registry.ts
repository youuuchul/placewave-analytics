/**
 * 보고서 묶음과 단계. 한 줄 결론의 숫자는 수치 근거(facts) 값이고, 본문 표·차트는 화면이 마트에서 계산한다.
 * 묶음 안의 단계는 시간 순서다. 주소 `r` 는 단계 id(그 단계를 연다) 또는 묶음 id(첫 단계를 연다).
 * stage 는 묶음 안의 큰 단계(목록의 단계별 보기), kind 는 문서 종류, date 는 문서 시점(시간순 보기).
 * written 은 문서 시점(date) 뒤에 다시 쓴 문서의 최종 수정일. badge 는 인과 판정이 아닌 문서의 표기.
 * major 는 묶음의 줄기(문제 → 해결 → 검증 → 운영)를 이루는 주요 보고서. 목록에서 이름을 강조한다.
 */
export type Stage = '발견' | '데이터 구축' | '모델' | '실험' | '운영 이슈'
export type Kind = '발견' | '운영' | '개선' | '모델' | '설계서' | '진행 점검' | '결과 보고' | '이슈'

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
  major?: boolean
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
    conclusion: '결과 0건의 원인이 줄임말·한 동네 이름 같은 입력임을 찾고, 검색어 해석과 4~6월 라벨로 학습한 LightGBM 순위 모델(오프라인 NDCG@10 0.570 → 0.873)을 기기 50:50 A/B 로 검증해 검색 성공률 +20.7%p 를 확인한 뒤 7/27 전체 적용했다. 적용 뒤 검색 세션 신청 전환은 3.13% → 4.61%(6/1~7/12 → 7/27~8/31, 전후 비교)였고, 9/1 재색인 회귀는 일별 추이로 잡아 4일 만에 되돌렸다.',
    stages: ['발견', '데이터 구축', '모델', '실험', '운영 이슈'],
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
        major: true,
        conclusion: '평가 착수 전 28일 검색 5,596건 중 26.7%가 결과 0건이었고, 검색 20건 이상 검색어 48개 중 21개가 실패 검색어로 결과 0건의 58.9%를 차지했다. 모두 줄임말·영문 표기·한 동네 이름처럼 정식 이름이 아닌 입력이었다.',
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
        conclusion: '4/1~9/20 평가자 13명이 배치 52개·라벨 116,664건을 처리했다. 매주 진척·생산성·품질을 한 화면에서 보고 마감 위험 배치와 정확도 80% 미만 평가자를 그 주에 찾았다.',
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
        conclusion: '지침 개정 뒤 정답셋 정확도 78.2% → 86.1%, 카파 0.58 → 0.71로 올랐다. 비용은 직후 3주에 몰려 건당 처리 시간이 30.0초에서 35~38초로 늘었다가 4주째 27.2초로 돌아왔다.',
      },
      {
        id: 'ranker-model',
        code: 'M1',
        stage: '모델',
        kind: '모델',
        title: '순위 모델 설계·오프라인 평가: 검색어 해석과 LightGBM 순위 학습',
        date: '2026-07-03',
        period: '라벨 2026-04-01 ~ 07-05 · 검색 로그 06-22 ~ 07-05',
        sources: ['marts.ranker_eval', 'marts.ranker_query_eval', 'marts.ranker_feature'],
        written: '2026-10-23',
        major: true,
        conclusion: '기존 랭킹이 결과 0건을 준 요청의 87.0%를 새 검색어 해석이 정식 이름에 연결해 0건 비율이 26.4% → 3.4%로 줄 것으로 보고, 4~6월 라벨로 학습한 LightGBM 순위 모델이 5묶음 교차 검증 NDCG@10 을 0.570 → 0.873으로 올려 A/B 로 넘겼다.',
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
        conclusion: '주 지표는 검색 성공률(기준선 23.1%)이고, 2주·기기 50:50 이면 ±3.5%p 이상을 잡는다. 신청 전환처럼 2주로 작은 변화를 못 가리는 가드레일은 유의한 하락이 없을 때, 응답 시간은 p95 +50ms 안일 때 출시한다.',
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
        conclusion: '첫 주 배정은 621 : 640대(카이제곱 p 0.593)로 이상 없고 가드레일 3개도 기준 안이라 계속 진행했다. 실험 전 2주 검색 성공률 차이(−2.4%p, p 0.037)는 결과 보고에서 함께 보기로 했다.',
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
        major: true,
        conclusion: '새 랭킹이 검색 성공률을 22.7% → 43.4%(+20.7%p, 구간 +18.2 ~ +23.3)로 올렸고 가드레일 3개를 통과해 7/27 전체 적용했다. 검색 세션 신청 전환도 +1.57%p(구간 +0.13 ~ +3.00) 올랐다.',
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
        major: true,
        conclusion: '9/1 재색인에서 구분자 정규화가 빠져 상권 검색어의 결과 0건 비율이 0.0% → 58.1%로 뛰었다. 9/5 핫픽스로 0.0%로 되돌렸고, 회귀 검증 배치가 대기열 앞에 서며 같은 주 마감 위험 배치 2개가 생겼다.',
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
