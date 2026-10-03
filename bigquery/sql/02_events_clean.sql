-- 표: staging.events_clean — 정제 이벤트
-- 1행: 이벤트 1건
-- 키: (client_id, session_id, event_at, event_name)
-- 파티션·클러스터: kst_date / event_name, client_id
-- 원천: raw.ga4_events
-- 소비: staging.int_session·int_search, marts.daily_event·daily_venue·weekly_path·venue_registry, ops.reconciliation
-- 검사: C1a·C1b·C2·I3
--
-- 처리: 식별자 이름 정리(user_pseudo_id→client_id, user_id→member_id, ga_session_id→session_id),
--       KST 날짜·시, 파라미터 평탄화, 중복 제거(키 기준 첫 행), 테스트 제외(서비스 도메인 밖 page_location)

CREATE OR REPLACE TABLE staging.events_clean (
  kst_date DATE OPTIONS(description='이벤트 날짜 (KST). 일 파티션'),
  event_at TIMESTAMP OPTIONS(description='이벤트 시각 (UTC, 마이크로초)'),
  kst_hour INT64 OPTIONS(description='이벤트 시 (KST, 0~23)'),
  event_name STRING OPTIONS(description='이벤트명'),
  client_id STRING OPTIONS(description='기기 식별자 (원천 user_pseudo_id)'),
  member_id STRING OPTIONS(description='회원 ID (원천 user_id). 가입·로그인 이후 이벤트에만'),
  session_id INT64 OPTIONS(description='세션 ID (원천 ga_session_id). (client_id, session_id) 가 세션 키'),
  session_number INT64 OPTIONS(description='기기 기준 세션 순번'),
  engagement_time_msec INT64 OPTIONS(description='직전 이벤트 이후 체류 (ms)'),
  page_path STRING OPTIONS(description='화면 경로 (도메인·쿼리 제외)'),
  screen_name STRING OPTIONS(description='화면 이름 (screen_view 만)'),
  venue_id INT64 OPTIONS(description='공간 ID 파라미터'),
  is_partner BOOL OPTIONS(description='공간 상세 조회 시점 파트너 공간 여부 파라미터 (원천 문자열 1/0). 공간 상세 외 NULL'),
  event_id INT64 OPTIONS(description='행사 ID 파라미터'),
  order_id STRING OPTIONS(description='주문 ID 파라미터 (신청·결제·취소)'),
  amount INT64 OPTIONS(description='금액 파라미터 value (원). 결제=결제액, 취소=환불액'),
  price_tier STRING OPTIONS(description='가격대 파라미터 free / standard / premium'),
  search_term STRING OPTIONS(description='검색어 파라미터'),
  promotion_id STRING OPTIONS(description='배너 ID 파라미터'),
  method STRING OPTIONS(description='가입·로그인·공유 방법 파라미터'),
  payment_method STRING OPTIONS(description='결제 수단 파라미터'),
  session_engaged BOOL OPTIONS(description='세션 engaged 여부'),
  device_category STRING OPTIONS(description='mobile / desktop'),
  operating_system STRING OPTIONS(description='기기 OS'),
  device_platform STRING OPTIONS(description='기기 플랫폼 사용자 속성 ios / android / desktop'),
  first_channel STRING OPTIONS(description='첫 유입 사용자 속성 paid / non_paid'),
  subscriber BOOL OPTIONS(description='구독자 사용자 속성 (이벤트 시점 기준, 원천 문자열 1/0). 속성 없으면 NULL'),
  source STRING OPTIONS(description='세션 라스트클릭 소스'),
  medium STRING OPTIONS(description='세션 라스트클릭 매체'),
  campaign STRING OPTIONS(description='세션 라스트클릭 캠페인 ID'),
  ad_content STRING OPTIONS(description='광고 소재')
)
PARTITION BY kst_date
CLUSTER BY event_name, client_id
OPTIONS(
  description='정제 이벤트. 1행 = 이벤트 1건. 키 (client_id, session_id, event_at, event_name). 원천 raw.ga4_events. KST 변환·파라미터 평탄화·중복 제거·테스트 제외',
  require_partition_filter = TRUE
)
AS
WITH src AS (
  SELECT
    event_date,
    event_timestamp,
    event_name,
    user_pseudo_id,
    user_id,
    ga_session_id,
    ga_session_number,
    engagement_time_msec,
    page_location,
    session_engaged,
    device_category,
    operating_system,
    traffic_source,
    user_properties,
    event_params
  FROM raw.ga4_events
  -- 전체 재생성: 파티션 필터를 전 기간으로 명시한다
  WHERE event_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    -- 테스트 제외: 서비스 도메인 밖에서 찍힌 이벤트(로컬·스테이징)
    AND (page_location IS NULL OR STARTS_WITH(page_location, 'https://placewave.app') OR STARTS_WITH(page_location, 'https://nightpulse.app'))
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY user_pseudo_id, ga_session_id, event_timestamp, event_name
    ORDER BY page_location
  ) = 1
)
SELECT
  event_date AS kst_date,
  TIMESTAMP_MICROS(event_timestamp) AS event_at,
  EXTRACT(HOUR FROM TIMESTAMP_MICROS(event_timestamp) AT TIME ZONE 'Asia/Seoul') AS kst_hour,
  event_name,
  user_pseudo_id AS client_id,
  user_id AS member_id,
  ga_session_id AS session_id,
  ga_session_number AS session_number,
  COALESCE(engagement_time_msec, 0) AS engagement_time_msec,
  REGEXP_EXTRACT(page_location, r'^https?://[^/]+(/[^?#]*)') AS page_path,
  (SELECT string_value FROM UNNEST(event_params) WHERE key = 'screen_name') AS screen_name,
  (SELECT int_value FROM UNNEST(event_params) WHERE key = 'venue_id') AS venue_id,
  (SELECT COALESCE(string_value, CAST(int_value AS STRING)) FROM UNNEST(event_params) WHERE key = 'is_partner') = '1' AS is_partner,
  (SELECT int_value FROM UNNEST(event_params) WHERE key = 'event_id') AS event_id,
  (SELECT string_value FROM UNNEST(event_params) WHERE key = 'order_id') AS order_id,
  (SELECT int_value FROM UNNEST(event_params) WHERE key = 'value') AS amount,
  (SELECT string_value FROM UNNEST(event_params) WHERE key = 'price_tier') AS price_tier,
  (SELECT string_value FROM UNNEST(event_params) WHERE key = 'search_term') AS search_term,
  (SELECT string_value FROM UNNEST(event_params) WHERE key = 'promotion_id') AS promotion_id,
  (SELECT string_value FROM UNNEST(event_params) WHERE key = 'method') AS method,
  (SELECT string_value FROM UNNEST(event_params) WHERE key = 'payment_method') AS payment_method,
  session_engaged = '1' AS session_engaged,
  device_category,
  operating_system,
  (SELECT string_value FROM UNNEST(user_properties) WHERE key = 'device_platform') AS device_platform,
  (SELECT string_value FROM UNNEST(user_properties) WHERE key = 'first_channel') AS first_channel,
  (SELECT string_value FROM UNNEST(user_properties) WHERE key = 'subscriber') = '1' AS subscriber,
  traffic_source.source AS source,
  traffic_source.medium AS medium,
  traffic_source.campaign AS campaign,
  traffic_source.content AS ad_content
FROM src;
