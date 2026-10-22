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
    conclusion: '__BUNDLE__',
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
        conclusion: '__D1__',
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
        conclusion: '__O1__',
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
        conclusion: '__X1__',
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
        conclusion: '__E1D__',
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
        conclusion: '__E1C__',
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
        conclusion: '__E1R__',
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
        conclusion: '__I1__',
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
