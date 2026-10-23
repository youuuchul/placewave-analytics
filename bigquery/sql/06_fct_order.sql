-- 표: staging.fct_order — 주문 원장 정리 (티켓 신청 + 구독 결제)
-- 1행: 주문 1건 = 티켓 신청 1건(kind ticket) 또는 구독 결제 1건(kind subscription)
-- 키: order_id
-- 파티션·클러스터: applied_date / kind, event_id
-- 원천: raw.db_applications, raw.db_payments, raw.db_events,
--       staging.int_contract_day (개최일 공간 요금제 → 수수료 등급), staging.map_fee_rate (등급별 수수료율)
-- 소비: staging.dim_event·ml_ranker_pairs, marts.daily_event·daily_venue·monthly_summary·daily_revenue·daily_subscription·venue_registry,
--       ops.reconciliation
-- 검사: R5·R6·I4·C9·C14·R10·R11
--
-- 결제·신청·취소의 건수와 금액은 이 표(원장)에서 센다. 로그는 흐름을 보는 데만 쓴다.
-- 행사·신청 지표는 kind = 'ticket' 만 쓴다. 구독 결제 행은 신청이 없으므로 applied_date = 결제일, event_id·venue_id NULL.
-- 금액: paid_amount = 실결제액(할인 반영 후, 원장 amount), discount_amount = 할인액(구독자의 파트너 공간 행사 15%),
--       정가 = paid_amount + discount_amount, net_amount = paid_amount - refund_amount.
-- 구독 결제 환불은 결제 상태 refunded 면 결제액 전액으로 본다.
-- 수수료(티켓만): fee_tier = 개최일(관측 후 개최면 스냅샷 기준일)에 공간의 활성 계약 요금제(basic/pro), 없으면 none.
--   list_amount = 정가(결제 행은 실결제액 + 할인액, 미결제는 행사 가격), fee_amount = ROUND(list_amount × 율).
--   미결제·환불(refund_amount > 0) 주문은 fee_amount 0. 수수료는 정가 기준이라 멤버 할인이 수수료를 줄이지 않는다.
--   구독 결제 행은 fee_tier·list_amount·fee_amount 가 NULL.

CREATE OR REPLACE TABLE staging.fct_order (
  applied_date DATE OPTIONS(description='주문일 (KST). 티켓 = 신청일, 구독 = 결제일. 일 파티션'),
  order_id STRING OPTIONS(description='주문 ID'),
  kind STRING OPTIONS(description='주문 종류 ticket / subscription'),
  event_id INT64 OPTIONS(description='행사 ID (티켓만)'),
  venue_id INT64 OPTIONS(description='공간 ID (티켓만)'),
  member_id STRING OPTIONS(description='회원 ID'),
  subscription_id STRING OPTIONS(description='구독 ID (구독 결제는 필수, 티켓은 원장 값 그대로 — NULL 가능)'),
  applied_at TIMESTAMP OPTIONS(description='신청 시각 (UTC). 구독 = 결제 시각'),
  status STRING OPTIONS(description='티켓: 신청 상태 applied / paid / payment_pending / canceled. 구독: 결제 상태 paid / refunded'),
  price_tier STRING OPTIONS(description='가격대 free / standard / premium / package (티켓만)'),
  is_paid_tier BOOL OPTIONS(description='유료 행사 신청인가 (티켓만, 구독 NULL)'),
  is_partner_venue BOOL OPTIONS(description='파트너 공간 개최 행사인가 (개최 시점 기준, 티켓만)'),
  fee_tier STRING OPTIONS(description='수수료 등급 none / basic / pro (개최일 공간 요금제, 티켓만)'),
  is_paid BOOL OPTIONS(description='결제 완료 이력이 있는가 (환불 포함)'),
  paid_at TIMESTAMP OPTIONS(description='결제 시각 (UTC)'),
  paid_date DATE OPTIONS(description='결제일 (KST)'),
  paid_amount INT64 OPTIONS(description='실결제액 (원, 할인 반영 후)'),
  discount_amount INT64 OPTIONS(description='할인액 (원)'),
  payment_status STRING OPTIONS(description='결제 상태 paid / refunded'),
  payment_method STRING OPTIONS(description='결제 수단'),
  is_canceled BOOL OPTIONS(description='취소된 신청인가 (구독 FALSE)'),
  cancel_at TIMESTAMP OPTIONS(description='취소 시각 (UTC)'),
  cancel_date DATE OPTIONS(description='취소일 (KST)'),
  refund_amount INT64 OPTIONS(description='환불액 (원)'),
  net_amount INT64 OPTIONS(description='순매출 = 실결제액 - 환불액 (원)'),
  list_amount INT64 OPTIONS(description='정가 (원, 멤버 할인 전, 티켓만)'),
  fee_amount INT64 OPTIONS(description='수수료 = 정가 × 등급 수수료율 (원, 미결제·환불 0, 티켓만)')
)
PARTITION BY applied_date
CLUSTER BY kind, event_id
OPTIONS(description='주문 원장 정리. 1행 = 주문 1건(티켓 신청 또는 구독 결제). 키 order_id. 원천 raw.db_applications·db_payments·db_events + staging.int_contract_day·map_fee_rate(수수료)')
AS
WITH ticket_pay AS (
  SELECT order_id, amount, discount_amount, subscription_id, paid_at, status, method
  FROM raw.db_payments
  WHERE kind = 'ticket'
),
venue_plan AS (
  SELECT venue_id, kst_date, plan
  FROM staging.int_contract_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
ev AS (
  SELECT
    e.event_id,
    e.venue_id,
    e.price_tier,
    e.price,
    e.is_partner_venue,
    COALESCE(vp.plan, 'none') AS fee_tier
  FROM raw.db_events AS e
  LEFT JOIN venue_plan AS vp
    ON vp.venue_id = e.venue_id
    AND vp.kst_date = LEAST(DATE(e.starts_at, 'Asia/Seoul'), e.snapshot_date)
),
ticket AS (
  SELECT
    DATE(a.applied_at, 'Asia/Seoul') AS applied_date,
    a.order_id,
    'ticket' AS kind,
    a.event_id,
    e.venue_id,
    a.member_id,
    p.subscription_id,
    a.applied_at,
    a.status,
    e.price_tier,
    e.price_tier != 'free' AS is_paid_tier,
    e.is_partner_venue,
    e.fee_tier,
    p.order_id IS NOT NULL AS is_paid,
    p.paid_at,
    DATE(p.paid_at, 'Asia/Seoul') AS paid_date,
    COALESCE(p.amount, 0) AS paid_amount,
    COALESCE(p.discount_amount, 0) AS discount_amount,
    p.status AS payment_status,
    p.method AS payment_method,
    a.status = 'canceled' AS is_canceled,
    a.cancel_at,
    DATE(a.cancel_at, 'Asia/Seoul') AS cancel_date,
    COALESCE(a.cancel_amount, 0) AS refund_amount,
    COALESCE(p.amount, 0) - COALESCE(a.cancel_amount, 0) AS net_amount,
    IF(p.order_id IS NOT NULL, p.amount + COALESCE(p.discount_amount, 0), e.price) AS list_amount
  FROM raw.db_applications AS a
  LEFT JOIN ticket_pay AS p USING (order_id)
  LEFT JOIN ev AS e USING (event_id)
)
SELECT
  t.*,
  IF(t.is_paid AND t.refund_amount = 0, CAST(ROUND(t.list_amount * r.rate) AS INT64), 0) AS fee_amount
FROM ticket AS t
LEFT JOIN staging.map_fee_rate AS r USING (fee_tier)
UNION ALL
SELECT
  DATE(p.paid_at, 'Asia/Seoul') AS applied_date,
  p.order_id,
  'subscription' AS kind,
  CAST(NULL AS INT64) AS event_id,
  CAST(NULL AS INT64) AS venue_id,
  p.member_id,
  p.subscription_id,
  p.paid_at AS applied_at,
  p.status,
  CAST(NULL AS STRING) AS price_tier,
  CAST(NULL AS BOOL) AS is_paid_tier,
  CAST(NULL AS BOOL) AS is_partner_venue,
  CAST(NULL AS STRING) AS fee_tier,
  TRUE AS is_paid,
  p.paid_at,
  DATE(p.paid_at, 'Asia/Seoul') AS paid_date,
  p.amount AS paid_amount,
  COALESCE(p.discount_amount, 0) AS discount_amount,
  p.status AS payment_status,
  p.method AS payment_method,
  FALSE AS is_canceled,
  CAST(NULL AS TIMESTAMP) AS cancel_at,
  CAST(NULL AS DATE) AS cancel_date,
  IF(p.status = 'refunded', p.amount, 0) AS refund_amount,
  p.amount - IF(p.status = 'refunded', p.amount, 0) AS net_amount,
  CAST(NULL AS INT64) AS list_amount,
  CAST(NULL AS INT64) AS fee_amount
FROM raw.db_payments AS p
WHERE p.kind = 'subscription';
