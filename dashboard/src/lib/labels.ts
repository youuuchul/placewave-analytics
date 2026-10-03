export const S = (n: number) => `var(--s${n})`

export const CHANNEL2: { key: string; label: string }[] = [
  { key: 'direct', label: '직접' },
  { key: 'organic_search', label: '자연 검색' },
  { key: 'organic_social', label: '자연 소셜' },
  { key: 'influencer', label: '인플루언서' },
  { key: 'paid_social', label: '유료 소셜' },
  { key: 'referral', label: '추천' },
  { key: 'ai_referral', label: 'AI 추천' },
  { key: 'other', label: '기타' },
]

export function channel2Label(k: string | null): string {
  if (!k) return '—'
  return CHANNEL2.find((c) => c.key === k)?.label ?? k
}

export function channel2Color(k: string): string {
  const i = CHANNEL2.findIndex((c) => c.key === k)
  return S(i < 0 ? 8 : i + 1)
}

export const PRICE_TIER: Record<string, string> = { free: '무료', standard: '일반', premium: '프리미엄', package: '패키지' }

export const FUNNEL_LABEL: Record<string, string> = {
  landing: '랜딩',
  detail: '행사 상세',
  signup: '로그인·가입',
  apply_view: '신청 화면',
  payment: '결제',
}

export const AUDIENCES: { id: string; label: string }[] = [
  { id: 'new', label: '신규' },
  { id: 'returning', label: '재방문' },
  { id: 'paid_inflow', label: '광고 유입' },
  { id: 'past_payer', label: '결제 경험' },
  { id: 'apply_no_pay', label: '신청 후 미결제' },
  { id: 'explorer_only', label: '탐색만' },
]

export const EXIT_NODE = '(이탈)'
export const OTHER_NODE = '(기타)'

const SCREEN_LABEL: Record<string, string> = {
  home: '홈',
  map_main: '지도',
  search_main: '검색',
  search_result: '검색 결과',
  event_detail: '행사 상세',
  venue_detail: '공간 상세',
  venue_review: '공간 리뷰',
  login: '로그인',
  taste_setup: '취향 설정',
  event_apply: '신청 화면',
  payment_confirm: '결제 확인',
  payment_success: '결제 완료',
  '(other_screen)': '기타 화면',
  [OTHER_NODE]: '기타',
  [EXIT_NODE]: '이탈',
}

export function screenLabel(k: string): string {
  return SCREEN_LABEL[k] ?? k
}

export const SCREEN_GROUPS: { key: string; label: string; color: string; screens: string[] }[] = [
  { key: 'browse', label: '탐색', color: S(1), screens: ['home', 'map_main', 'search_main', 'search_result'] },
  { key: 'detail', label: '상세', color: S(3), screens: ['event_detail', 'venue_detail', 'venue_review'] },
  { key: 'auth', label: '로그인·가입', color: S(4), screens: ['login', 'taste_setup'] },
  { key: 'order', label: '신청·결제', color: S(2), screens: ['event_apply', 'payment_confirm', 'payment_success'] },
]

export function screenColor(k: string): string {
  if (k === EXIT_NODE) return 'var(--exit)'
  return SCREEN_GROUPS.find((g) => g.screens.includes(k))?.color ?? 'var(--muted)'
}

export const REVENUE_KINDS: { key: 'fee' | 'membership' | 'plan'; label: string; color: string; metricId: string }[] = [
  { key: 'fee', label: '수수료', color: S(1), metricId: 'M10' },
  { key: 'membership', label: '멤버십', color: S(2), metricId: 'M03' },
  { key: 'plan', label: '파트너 플랜', color: S(3), metricId: 'M04' },
]

export const GMV_COLOR = 'var(--ink-2)'

export const FEE_TIERS: { key: 'none' | 'basic' | 'pro'; label: string; rate: number; color: string }[] = [
  { key: 'none', label: '비파트너', rate: 0.1, color: 'var(--exit)' },
  { key: 'basic', label: '베이직', rate: 0.05, color: S(7) },
  { key: 'pro', label: '프로', rate: 0.03, color: S(5) },
]

export const PLAN_LABEL: Record<string, string> = { basic: '베이직', pro: '프로' }

export const QUERY_INTENT: Record<string, string> = { genre: '장르', region: '상권', event_type: '행사 유형', venue_name: '공간명' }
export const REQUESTER: Record<string, string> = { search: '검색', promotion: '추천 슬롯' }
export const PURPOSE: Record<string, string> = { train: '학습', eval: '정기 평가', adhoc: '긴급' }
export const RATER_GROUP: Record<string, string> = { internal: '내부', vendor: '외부' }
