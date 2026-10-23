-- 표: staging.dim_event — 행사 차원
-- 1행: 행사 1건
-- 키: event_id
-- 파티션·클러스터: 없음 / event_id
-- 원천: raw.db_events, raw.db_venues, staging.fct_order
-- 소비: marts.daily_event·venue_registry (행사 속성·365일 개최 행사), 행사 리스트, staging.ml_ranker_pairs, raw.ml_ranker_scores·ml_ranker_features (순위 모델 피처)

CREATE OR REPLACE TABLE staging.dim_event (
  event_id INT64 OPTIONS(description='행사 ID'),
  event_name STRING OPTIONS(description='행사명 (가상)'),
  event_type STRING OPTIONS(description='행사 유형'),
  venue_id INT64 OPTIONS(description='공간 ID'),
  venue_name STRING OPTIONS(description='공간명 (가상)'),
  region STRING OPTIONS(description='지역'),
  genre STRING OPTIONS(description='공간 대표 장르'),
  starts_at TIMESTAMP OPTIONS(description='시작 시각 (UTC)'),
  start_date DATE OPTIONS(description='개최일 (KST)'),
  price_tier STRING OPTIONS(description='가격대 free / standard / premium'),
  price INT64 OPTIONS(description='가격 (원)'),
  applications INT64 OPTIONS(description='신청 수 (원장)'),
  paid_orders INT64 OPTIONS(description='결제 완료 수 (환불 포함)'),
  canceled INT64 OPTIONS(description='취소 수'),
  gross_amount INT64 OPTIONS(description='결제 금액 합 (원)'),
  refund_amount INT64 OPTIONS(description='환불액 합 (원)'),
  net_amount INT64 OPTIONS(description='순매출 (원)')
)
CLUSTER BY event_id
OPTIONS(description='행사 차원. 1행 = 행사 1건. 키 event_id. 원천 raw.db_events·db_venues + staging.fct_order 집계')
AS
WITH o AS (
  SELECT
    event_id,
    COUNT(*) AS applications,
    COUNTIF(is_paid) AS paid_orders,
    COUNTIF(is_canceled) AS canceled,
    SUM(paid_amount) AS gross_amount,
    SUM(refund_amount) AS refund_amount,
    SUM(net_amount) AS net_amount
  FROM staging.fct_order
  WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND kind = 'ticket'
  GROUP BY event_id
)
SELECT
  e.event_id,
  e.name AS event_name,
  e.event_type,
  e.venue_id,
  v.name AS venue_name,
  v.region,
  v.genre,
  e.starts_at,
  DATE(e.starts_at, 'Asia/Seoul') AS start_date,
  e.price_tier,
  e.price,
  COALESCE(o.applications, 0) AS applications,
  COALESCE(o.paid_orders, 0) AS paid_orders,
  COALESCE(o.canceled, 0) AS canceled,
  COALESCE(o.gross_amount, 0) AS gross_amount,
  COALESCE(o.refund_amount, 0) AS refund_amount,
  COALESCE(o.net_amount, 0) AS net_amount
FROM raw.db_events AS e
LEFT JOIN raw.db_venues AS v USING (venue_id)
LEFT JOIN o USING (event_id);
