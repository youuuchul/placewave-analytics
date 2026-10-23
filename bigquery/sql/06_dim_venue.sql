-- 표: staging.dim_venue — 공간 차원
-- 1행: 공간 1곳
-- 키: venue_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: raw.db_venues, raw.db_events, staging.dim_contract, staging.int_contract_day (그 계약의 마지막 활성일 요금제)
-- 소비: marts.daily_venue·daily_venue_registry·venue_registry (공간 속성), raw.ml_query_parse·ml_ranker_scores·ml_ranker_features (공간명 해석·순위 모델 피처)
--
-- 파트너 여부·요금제·계약일은 스냅샷 기준일에 활성인 계약 기준이다(활성 규칙은 dim_contract).
-- 기준일에 활성 계약이 없으면 is_partner = FALSE 이고 plan·계약일은 가장 최근 계약 값(계약 이력이 없으면 NULL).
-- plan 은 그 계약의 마지막 활성일 요금제(요금제 변경 반영, staging.int_contract_day). 진행 중이면 기준일 요금제다.

CREATE OR REPLACE TABLE staging.dim_venue (
  venue_id INT64 OPTIONS(description='공간 ID'),
  venue_name STRING OPTIONS(description='공간명 (가상)'),
  region STRING OPTIONS(description='상권 (서울 주요 상권)'),
  genre STRING OPTIONS(description='대표 장르'),
  capacity_band STRING OPTIONS(description='수용 규모 S/M/L/XL'),
  events INT64 OPTIONS(description='등록 행사 수'),
  district STRING OPTIONS(description='구'),
  lat FLOAT64 OPTIONS(description='위도'),
  lng FLOAT64 OPTIONS(description='경도'),
  venue_type STRING OPTIONS(description='공간 유형'),
  registered_at TIMESTAMP OPTIONS(description='등록 시각 (UTC)'),
  registered_date DATE OPTIONS(description='등록일 (KST)'),
  status STRING OPTIONS(description='공간 상태 active / closed'),
  is_partner BOOL OPTIONS(description='스냅샷 기준일에 활성 파트너 계약이 있는가'),
  plan STRING OPTIONS(description='요금제 basic / pro (현재 또는 가장 최근 계약)'),
  contract_id STRING OPTIONS(description='현재 또는 가장 최근 계약 ID'),
  contract_start_date DATE OPTIONS(description='그 계약 시작일 (KST)'),
  contract_end_date DATE OPTIONS(description='그 계약 종료일 (KST). NULL = 진행 중'),
  contracts INT64 OPTIONS(description='계약 이력 건수'),
  snapshot_date DATE OPTIONS(description='원장 스냅샷 기준일')
)
OPTIONS(description='공간 차원. 1행 = 공간 1곳. 키 venue_id. 원천 raw.db_venues·db_events + staging.dim_contract·int_contract_day(기준일 파트너 여부·요금제)')
AS
WITH c AS (
  SELECT
    venue_id,
    COUNT(*) AS contracts,
    ARRAY_AGG(
      STRUCT(
        contract_id,
        plan,
        start_date,
        end_date,
        start_date <= snapshot_date AND (end_date IS NULL OR end_date > snapshot_date) AS is_active
      )
      ORDER BY start_date <= snapshot_date AND (end_date IS NULL OR end_date > snapshot_date) DESC, started_at DESC, contract_id
      LIMIT 1
    )[OFFSET(0)] AS cur
  FROM staging.dim_contract
  GROUP BY venue_id
),
last_plan AS (
  SELECT contract_id, ARRAY_AGG(plan ORDER BY kst_date DESC LIMIT 1)[OFFSET(0)] AS plan
  FROM staging.int_contract_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
  GROUP BY contract_id
),
ev AS (
  SELECT venue_id, COUNT(*) AS events
  FROM raw.db_events
  GROUP BY venue_id
)
SELECT
  v.venue_id,
  v.name AS venue_name,
  v.region,
  v.genre,
  v.capacity_band,
  COALESCE(ev.events, 0) AS events,
  v.district,
  v.lat,
  v.lng,
  v.venue_type,
  v.registered_at,
  DATE(v.registered_at, 'Asia/Seoul') AS registered_date,
  v.status,
  COALESCE(c.cur.is_active, FALSE) AS is_partner,
  COALESCE(lp.plan, c.cur.plan) AS plan,
  c.cur.contract_id,
  c.cur.start_date AS contract_start_date,
  c.cur.end_date AS contract_end_date,
  COALESCE(c.contracts, 0) AS contracts,
  v.snapshot_date
FROM raw.db_venues AS v
LEFT JOIN c USING (venue_id)
LEFT JOIN last_plan AS lp ON lp.contract_id = c.cur.contract_id
LEFT JOIN ev USING (venue_id);
