-- 표: staging.int_person_day — 사람 × 일 중간 표
-- 1행: 사람 × 일(KST, 세션 시작일)
-- 키: (person_id, kst_date)
-- 파티션·클러스터: kst_date / channel1, device_platform, member_seg
-- 원천: staging.int_session·dim_subscription (그날 활성 구독), raw.db_members (가입일)
-- 소비: staging.int_search, marts.daily_metrics·funnel_daily·weekly_cohort·monthly_cohort·weekly_activity·monthly_summary,
--       marts.daily_channel·hourly_metrics·weekly_audience_funnel·weekly_path·person_day, ops.reconciliation
-- 검사: R3
--
-- 행동 플래그의 정의 원본(architecture 12종 + 행사 상세·로그인 상태 2종 + 구독 2종, '찜'은 원천 이벤트가 없어 홈 배너 선택으로 대체). 행동 플래그는 자동 로드 세션을 뺀 세션에서만 켠다.
-- subscribed 는 행동이 아니라 상태 플래그다: 그날 활성 구독이 있는 회원(구독 원장, 활성 규칙은 dim_subscription). 그날 행이 있는 사람에게만 붙는다.
-- 세그먼트 축 (사람당 1개로 고정해 조합 합 = 전체)
--   channel1         사람의 첫 방문 세션의 첫 유입 속성 paid / non_paid
--   device_platform  사람의 첫 방문 세션의 기기 플랫폼
--   member_seg       그날 0시 기준 회원 여부 member / guest. 가입 당일은 guest (가입이 guest 쪽 전환으로 잡힌다)
-- 사람 수 비율의 분모는 이 표의 person_id 고유 수다. 기기 행을 세지 않는다.

CREATE OR REPLACE TABLE staging.int_person_day (
  kst_date DATE OPTIONS(description='날짜 (KST, 세션 시작일). 일 파티션'),
  person_id STRING OPTIONS(description='사람 식별자 (회원이면 member_id, 아니면 client_id)'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  first_visit_date DATE OPTIONS(description='사람의 첫 방문일 (자동 로드 제외). 자동 로드만 있는 사람은 NULL'),
  is_first_visit_day BOOL OPTIONS(description='그날이 첫 방문일인가'),
  is_visit BOOL OPTIONS(description='플래그: 방문 (자동 로드 아닌 세션 1개 이상)'),
  did_explore BOOL OPTIONS(description='플래그: 탐색 화면 조회'),
  did_view_detail BOOL OPTIONS(description='플래그: 공간·행사 상세 조회'),
  did_view_event_detail BOOL OPTIONS(description='플래그: 행사 상세 조회'),
  is_logged_in BOOL OPTIONS(description='플래그: 회원 ID 가 실린 방문 세션이 있다 (로그인 상태, 그날 가입 포함)'),
  did_sign_up BOOL OPTIONS(description='플래그: 가입'),
  did_view_apply BOOL OPTIONS(description='플래그: 신청 화면 조회'),
  did_apply BOOL OPTIONS(description='플래그: 신청'),
  did_pay BOOL OPTIONS(description='플래그: 결제'),
  did_cancel BOOL OPTIONS(description='플래그: 신청 취소'),
  did_search BOOL OPTIONS(description='플래그: 검색'),
  did_select_promotion BOOL OPTIONS(description='플래그: 홈 배너 선택'),
  did_share BOOL OPTIONS(description='플래그: 공유'),
  subscribed BOOL OPTIONS(description='플래그: 그날 활성 구독 회원 (구독 원장 기준 상태)'),
  sub_paid BOOL OPTIONS(description='플래그: 구독 결제 완료 이벤트(subscribe, 로그)'),
  is_multi_session BOOL OPTIONS(description='플래그: 자동 로드 아닌 세션 2개 이상'),
  sessions INT64 OPTIONS(description='세션 수 (자동 로드 포함)'),
  valid_sessions INT64 OPTIONS(description='자동 로드 아닌 세션 수'),
  active_sessions INT64 OPTIONS(description='활성 세션 수'),
  auto_load_sessions INT64 OPTIONS(description='자동 로드 세션 수'),
  engagement_msec INT64 OPTIONS(description='체류 합 (ms, 자동 로드 제외)'),
  applications INT64 OPTIONS(description='신청 이벤트 수'),
  purchases INT64 OPTIONS(description='결제 이벤트 수'),
  purchase_amount INT64 OPTIONS(description='결제 금액 (원)'),
  cancels INT64 OPTIONS(description='취소 이벤트 수'),
  refund_amount INT64 OPTIONS(description='환불액 (원)')
)
PARTITION BY kst_date
CLUSTER BY channel1, device_platform, member_seg
OPTIONS(description='사람 × 일 중간 표. 1행 = (person_id, kst_date). 원천 staging.int_session·raw.db_members. 행동 플래그 BOOL 16종과 세그먼트 축 3개')
AS
WITH s AS (
  SELECT *
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
person AS (
  SELECT
    person_id,
    ARRAY_AGG(STRUCT(first_channel, device_platform) ORDER BY is_auto_load, started_at, client_id LIMIT 1)[OFFSET(0)] AS seg,
    MIN(IF(is_auto_load, NULL, session_date)) AS first_visit_date
  FROM s
  GROUP BY person_id
),
member AS (
  SELECT member_id, DATE(signed_up_at, 'Asia/Seoul') AS signup_date
  FROM raw.db_members
),
sub_day AS (
  SELECT DISTINCT member_id, d AS kst_date
  FROM staging.dim_subscription,
    UNNEST(GENERATE_DATE_ARRAY(start_date, LEAST(COALESCE(DATE_SUB(end_date, INTERVAL 1 DAY), snapshot_date), snapshot_date))) AS d
),
day AS (
  SELECT
    person_id,
    session_date AS kst_date,
    LOGICAL_OR(NOT is_auto_load) AS is_visit,
    LOGICAL_OR(NOT is_auto_load AND did_explore) AS did_explore,
    LOGICAL_OR(NOT is_auto_load AND did_view_detail) AS did_view_detail,
    LOGICAL_OR(NOT is_auto_load AND did_view_event_detail) AS did_view_event_detail,
    LOGICAL_OR(NOT is_auto_load AND member_id IS NOT NULL) AS is_logged_in,
    LOGICAL_OR(sign_ups > 0) AS did_sign_up,
    LOGICAL_OR(NOT is_auto_load AND did_view_apply) AS did_view_apply,
    LOGICAL_OR(applications > 0) AS did_apply,
    LOGICAL_OR(purchases > 0) AS did_pay,
    LOGICAL_OR(cancels > 0) AS did_cancel,
    LOGICAL_OR(searches > 0) AS did_search,
    LOGICAL_OR(promo_clicks > 0) AS did_select_promotion,
    LOGICAL_OR(shares > 0) AS did_share,
    LOGICAL_OR(subscribes > 0) AS sub_paid,
    COUNTIF(NOT is_auto_load) >= 2 AS is_multi_session,
    COUNT(*) AS sessions,
    COUNTIF(NOT is_auto_load) AS valid_sessions,
    COUNTIF(is_active) AS active_sessions,
    COUNTIF(is_auto_load) AS auto_load_sessions,
    SUM(IF(is_auto_load, 0, engagement_msec)) AS engagement_msec,
    SUM(applications) AS applications,
    SUM(purchases) AS purchases,
    SUM(purchase_amount) AS purchase_amount,
    SUM(cancels) AS cancels,
    SUM(refund_amount) AS refund_amount
  FROM s
  GROUP BY person_id, session_date
)
SELECT
  d.kst_date,
  d.person_id,
  COALESCE(p.seg.first_channel, 'unknown') AS channel1,
  COALESCE(p.seg.device_platform, 'unknown') AS device_platform,
  IF(m.signup_date < d.kst_date, 'member', 'guest') AS member_seg,
  p.first_visit_date,
  COALESCE(d.kst_date = p.first_visit_date, FALSE) AS is_first_visit_day,
  d.is_visit,
  d.did_explore,
  d.did_view_detail,
  d.did_view_event_detail,
  d.is_logged_in,
  d.did_sign_up,
  d.did_view_apply,
  d.did_apply,
  d.did_pay,
  d.did_cancel,
  d.did_search,
  d.did_select_promotion,
  d.did_share,
  sd.member_id IS NOT NULL AS subscribed,
  d.sub_paid,
  d.is_multi_session,
  d.sessions,
  d.valid_sessions,
  d.active_sessions,
  d.auto_load_sessions,
  d.engagement_msec,
  d.applications,
  d.purchases,
  d.purchase_amount,
  d.cancels,
  d.refund_amount
FROM day AS d
JOIN person AS p USING (person_id)
LEFT JOIN member AS m ON m.member_id = d.person_id
LEFT JOIN sub_day AS sd ON sd.member_id = d.person_id AND sd.kst_date = d.kst_date;
