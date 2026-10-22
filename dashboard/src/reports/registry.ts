/**
 * 보고서 묶음과 단계. 한 줄 결론의 숫자는 수치 근거(facts) 값이고, 본문 표·차트는 화면이 마트에서 계산한다.
 * 묶음 안의 단계는 시간 순서다. 주소 `r` 는 단계 id(그 단계를 연다) 또는 묶음 id(첫 단계를 연다).
 * badge 는 인과 판정이 아닌 단계(대조군 없는 전후 비교·관찰)의 표기다.
 */
export type ReportGroup = '발견' | '개선' | '실험' | '이슈'

export interface ReportMeta {
  id: string
  code: string
  group: ReportGroup
  title: string
  period: string
  sources: string[]
  badge?: string
  conclusion: string
}

export interface Bundle {
  id: string
  title: string
  period: string
  conclusion: string
  steps: ReportMeta[]
}

export const BUNDLES: Bundle[] = [
  {
    id: 'search-quality',
    title: '검색 품질 개선',
    period: '2026-03 ~ 09',
    conclusion:
      '실패 검색어를 정의해 평가 라벨을 모으고, 그 라벨로 만든 새 랭킹이 A/B 테스트에서 결과 0건 비율을 21.1% → 4.7%로 줄였다. 9/1 재색인 회귀는 일별 지표로 잡아 9/5에 되돌렸다',
    steps: [
      {
        id: 'search-failures',
        code: 'D1',
        group: '발견',
        title: '실패 검색어 발견: 자주 찾는 검색어의 결과 0건',
        period: '2026-03-04 ~ 03-31',
        sources: ['marts.daily_query'],
        badge: '관찰',
        conclusion: '평가 착수 전 28일 동안 검색 20건 이상 검색어 35개 중 20개가 실패 검색어였고, 20개 모두 4/1 첫 평가 배치에 넣었다',
      },
      {
        id: 'guide-v2',
        code: 'X1',
        group: '개선',
        title: '평가 지침 개정: 라벨 품질과 처리 시간 비용',
        period: '2026-06-01 전후',
        sources: ['marts.weekly_eval_ops', 'marts.weekly_rater'],
        badge: '전후 비교(인과 아님)',
        conclusion: '개정 후 정답셋 정확도 79.6% → 86.2%, 일치도 카파 0.59 → 0.71. 개정 직후 3주는 건당 처리 시간이 늘었다가 회복했다',
      },
      {
        id: 'ab-ranker-v2',
        code: 'E1',
        group: '실험',
        title: '랭킹 A/B 테스트: 기존 랭킹 vs 새 랭킹',
        period: '2026-07-13 ~ 07-26',
        sources: ['marts.daily_search'],
        conclusion: '새 랭킹(실험군)이 결과 0건 비율을 21.1% → 4.7%로 줄였고, 검색당 클릭은 줄지 않았다',
      },
      {
        id: 'issue-reindex-0901',
        code: 'I1',
        group: '이슈',
        title: '9/1 재색인 회귀: 상권 검색 0건 급증 → 9/5 핫픽스 → 9/8 회귀 검증 배치',
        period: '2026-08-29 ~ 09-14',
        sources: ['marts.daily_search', 'marts.daily_query', 'marts.weekly_batch'],
        badge: '전후 비교(인과 아님)',
        conclusion: '9/1~9/4 일 결과 0건 비율이 14.5~19.1%로 뛰었다가 9/5 핫픽스 뒤 돌아왔고, 회귀 검증 배치를 앞세운 대가로 9/7 주 마감 위험 배치가 3개 나왔다',
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
