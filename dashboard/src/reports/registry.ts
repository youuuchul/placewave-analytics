/**
 * 보고서 목록. 한 줄 결론의 숫자는 수치 근거(facts) 값이고, 본문 표·차트는 화면이 마트에서 계산한다.
 * causal = false 면 대조군이 없는 전후 비교라 제목 옆에 표기한다.
 */
export type ReportGroup = '실험' | '개선' | '이슈'

export interface ReportMeta {
  id: string
  code: string
  group: ReportGroup
  title: string
  period: string
  sources: string[]
  causal: boolean
  conclusion: string
}

export const REPORTS: ReportMeta[] = [
  {
    id: 'ab-ranker-v2',
    code: 'E1',
    group: '실험',
    title: '랭킹 A/B 테스트: 기존 랭킹 vs 새 랭킹',
    period: '2026-07-13 ~ 07-26',
    sources: ['marts.daily_search'],
    causal: true,
    conclusion: '새 랭킹(실험군)이 결과 0건 비율을 21.1% → 4.7%로 줄였고, 검색당 클릭은 줄지 않았다',
  },
  {
    id: 'guide-v2',
    code: 'X1',
    group: '개선',
    title: '평가 지침 개정: 라벨 품질과 처리 시간 비용',
    period: '2026-06-01 전후',
    sources: ['marts.weekly_eval_ops', 'marts.weekly_rater'],
    causal: false,
    conclusion: '개정 후 정답셋 정확도 79.6% → 86.2%, 일치도 카파 0.59 → 0.71. 개정 직후 3주는 건당 처리 시간이 늘었다가 회복했다',
  },
  {
    id: 'issue-reindex-0901',
    code: 'I1',
    group: '이슈',
    title: '9/1 재색인 회귀: 상권 검색 0건 급증 → 9/5 핫픽스 → 9/8 회귀 검증 배치',
    period: '2026-08-29 ~ 09-14',
    sources: ['marts.daily_search', 'marts.daily_query', 'marts.weekly_batch'],
    causal: false,
    conclusion: '9/1~9/4 일 결과 0건 비율이 14.5~19.1%로 뛰었다가 9/5 핫픽스 뒤 돌아왔고, 회귀 검증 배치를 앞세운 대가로 9/7 주 마감 위험 배치가 3개 나왔다',
  },
]

export const GROUP_ORDER: ReportGroup[] = ['실험', '개선', '이슈']

export const REPO = 'https://github.com/youuuchul/placewave-analytics'
