export type Channel1 = 'paid' | 'non_paid'
export type Platform = 'ios' | 'android' | 'web'
export type MemberSeg = 'member' | 'guest'

export interface Seg {
  channel1: Channel1
  device_platform: Platform
  member_seg: MemberSeg
}

export interface DailyMetric extends Seg {
  kst_date: string
  persons: number
  new_persons: number
  sessions: number
  engaged_sessions: number
  explorers: number
  detail_viewers: number
  signups: number
  apply_viewers: number
  applies: number
  payers: number
  pay_count: number
  pay_amount: number
  cancels: number
  subscribers?: number
  sub_payers?: number
}

export interface HourlyMetric extends Seg {
  kst_date: string
  kst_hour: number
  persons: number
  sessions: number
  applies: number
  pay_count: number
}

export interface DailyChannel extends Seg {
  kst_date: string
  channel2: string
  channel3: string
  sessions: number
  persons: number
  new_persons: number
  signups: number
  applies: number
  payers: number
  pay_amount: number
}

export interface DailyAd {
  kst_date: string
  campaign_id: string
  campaign_name: string
  spend: number
  impressions: number
  clicks: number
  sessions: number
  persons: number
  active_persons: number
  signups: number
  applies: number
  payers: number
  pay_amount: number
  new_persons?: number
}

export interface DailyEvent {
  kst_date: string
  event_id: number
  event_name: string
  venue_name: string
  event_type: string
  price_tier: string
  detail_viewers: number
  applies: number
  pay_count: number
  pay_amount: number
  cancels: number
}

export interface DailyVenue {
  kst_date: string
  venue_id: number
  venue_name: string
  region: string
  genre: string
  detail_viewers: number
  applies: number
  pay_count: number
}

export type FunnelStep = 'landing' | 'detail' | 'signup' | 'apply_view' | 'payment'

export interface FunnelDaily extends Seg {
  kst_date: string
  step: FunnelStep
  persons: number
}

export interface WeeklyCohort extends Seg {
  cohort_week: string
  week_offset: number
  cohort_size: number
  retained: number
}

export interface MonthlyCohort {
  cohort_month: string
  month_offset: number
  member_seg: MemberSeg
  cohort_size: number
  retained: number
}

export interface WeeklyActivity extends Seg {
  week_start: string
  wau: number
  new_persons: number
  returning_persons: number
  two_plus_days: number
}

export interface MonthlySummary {
  month: string
  persons: number
  new_persons: number
  signups: number
  applies: number
  pay_count: number
  pay_amount: number
  cancels: number
  w1_retention: number | null
  top_channel: string | null
  gmv_amount?: number
  fee_amount?: number
  membership_amount?: number
  partner_plan_amount?: number
  platform_revenue?: number
  ad_spend?: number
  active_subscribers_eom?: number
  partner_total_eom?: number
  registered_total_eom?: number
}

export type RevenueKind = 'ticket' | 'membership' | 'partner_plan'
export type FeeTier = 'none' | 'basic' | 'pro'

/**
 * 티켓 행: gmv − discount = paid(환불 주문 제외), net = 수수료, pay_count 는 환불 포함(실결제 = pay_count − refund_count).
 * 멤버십·파트너 플랜 행: gmv 없음(null), net = 매출.
 */
export interface DailyRevenue {
  kst_date: string
  kind: RevenueKind
  fee_tier: FeeTier | null
  pay_count: number
  gmv_amount: number | null
  paid_amount: number
  discount_amount: number
  refund_count: number
  refund_amount: number
  net_amount: number
  payers: number
}

export type ContractPlan = 'basic' | 'pro' | 'all'

export interface MonthlyContract {
  month: string
  plan: ContractPlan
  contracts_bom: number
  new_contracts: number
  churned_contracts: number
  upgrades: number
  downgrades: number
  contracts_eom: number
  mrr_bom: number
  mrr_new: number
  mrr_expansion: number
  mrr_contraction: number
  mrr_churn: number
  mrr_eom: number
  arpa: number | null
}

export interface ContractCohort {
  cohort_month: string
  month_offset: number
  cohort_size: number
  retained: number
  mrr_retained: number
}

export interface SubscriptionCohort {
  cohort_month: string
  month_offset: number
  cohort_size: number
  retained: number
}

export interface DailySubscription {
  kst_date: string
  active_subscribers: number
  new_subscribers: number
  churned_subscribers: number
  mrr: number
  subscriber_ticket_payers: number
  subscriber_ticket_amount: number
  discount_amount?: number
}

export interface DailyVenueRegistry {
  kst_date: string
  region: string
  registered_total: number
  partner_total: number
  new_registered: number
  new_contracts: number
  churned_contracts: number
  mrr_basic: number
  mrr_pro: number
}

export interface VenueRegistry {
  venue_id: number
  name: string
  region: string
  district: string
  lat: number
  lng: number
  genre: string
  venue_type: string
  capacity_band: string
  registered_at: string
  is_partner: boolean
  plan: string | null
  contract_started_at: string | null
  contract_ended_at: string | null
  events_365d: number
  ticket_amount_365d: number
  detail_viewers_28d: number
  status?: string
  as_of_date?: string
}

export type AudienceId = 'new' | 'returning' | 'paid_inflow' | 'past_payer' | 'apply_no_pay' | 'explorer_only'

export interface WeeklyAudienceFunnel extends Seg {
  week_start: string
  audience_id: AudienceId
  step: FunnelStep
  persons: number
}

export interface WeeklyPath extends Seg {
  week_start: string
  step: number
  from_screen: string
  to_screen: string
  sessions: number
}

export interface DailySearch extends Seg {
  kst_date: string
  query_intent: string
  ranker_version: string
  searches: number
  zero_result_searches: number
  ga_matched_searches: number
  matched_result_searches: number
  clicked_searches: number
  first_click_position_sum: number
  first_click_position_sq_sum: number
  top3_clicks: number
  reformulated_searches: number
  search_sessions: number
  search_sessions_applied: number
}

export interface DailyQuery extends Seg {
  kst_date: string
  query_norm: string
  query_intent: string
  searches: number
  zero_result_searches: number
  ga_matched_searches: number
  clicked_searches: number
  reformulated_searches: number
  /** 검색팀 배치(실패·상위·무작위 출처)에 편입된 날 전부, 쉼표 구분 오름차순 */
  eval_dates: string | null
}

export interface WeeklyEvalOps {
  week_start: string
  requester: string
  rater_group: string
  guideline_version: string
  labels: number
  rework_labels: number
  handle_seconds: number
  gold_labels: number
  gold_correct: number
  final_labels: number
  label_pairs: number
  agree_pairs: number
  labels_g0: number
  labels_g1: number
  labels_g2: number
  labels_g3: number
  tasks_completed: number
}

export interface WeeklyRater {
  week_start: string
  rater_id: string
  requester: string
  rater_group: string
  labels: number
  rework_labels: number
  handle_seconds: number
  gold_labels: number
  gold_correct: number
  label_pairs: number
  agree_pairs: number
}

export interface WeeklyBatch {
  week_start: string
  batch_id: string
  requester: string
  purpose: string
  guideline_version: string
  priority: number
  created_date: string
  due_date: string
  as_of_date: string
  target_tasks: number
  done_tasks: number
  done_in_week: number
  remaining_tasks: number
  recent_done_14d: number
  days_to_due: number
}

export interface Meta {
  to_date: string
  from_date: string
  built_at: string
  source?: string
  tables: Record<string, number>
}

export interface Data {
  meta: Meta
  files: Partial<Record<LazyKey | 'person_day_meta' | 'person_day_gz', string>>
  daily_metrics: DailyMetric[]
  daily_ad: DailyAd[]
  funnel_daily: FunnelDaily[]
  weekly_cohort: WeeklyCohort[]
  monthly_cohort: MonthlyCohort[]
  weekly_activity: WeeklyActivity[]
  monthly_summary: MonthlySummary[]
  weekly_audience_funnel?: WeeklyAudienceFunnel[]
  daily_revenue?: DailyRevenue[]
  daily_subscription?: DailySubscription[]
  daily_venue_registry?: DailyVenueRegistry[]
  venue_registry?: VenueRegistry[]
  monthly_contract?: MonthlyContract[]
  contract_cohort?: ContractCohort[]
  subscription_cohort?: SubscriptionCohort[]
  weekly_eval_ops?: WeeklyEvalOps[]
  weekly_rater?: WeeklyRater[]
  weekly_batch?: WeeklyBatch[]
}

export interface LazyTables {
  hourly_metrics: HourlyMetric[]
  daily_channel: DailyChannel[]
  daily_venue: DailyVenue[]
  daily_event: DailyEvent[]
  weekly_path: WeeklyPath[]
  daily_search: DailySearch[]
  daily_query: DailyQuery[]
  person_day: PersonDay
}

export type LazyKey = keyof LazyTables

/** person_day.bin 을 읽은 그대로. 행 i = w[2i], w[2i+1] (비트 배치는 persons.ts). 날짜 순 정렬. */
export interface PersonDay {
  base_date: string
  codes: { c: string[]; p: string[]; m: string[] }
  n: number
  w: Uint32Array
}
