-- 표: staging.int_session — 세션 판정 단일 원본
-- 1행: 세션 1건
-- 키: (client_id, session_id)
-- 파티션·클러스터: session_date / person_id
-- 원천: staging.events_clean, staging.map_channel
-- 소비: staging.int_person_day·dim_member·int_search,
--       marts.hourly_metrics·daily_channel·daily_ad·daily_event·daily_venue·monthly_summary·weekly_audience_funnel·weekly_path·venue_registry,
--       ops.reconciliation
-- 검사: I1·I2·R7·R8
--
-- 규칙
--   세션 날짜·시   첫 이벤트 시각(KST). 자정을 넘긴 세션도 시작일에 속한다
--   신원          person_id = COALESCE(기기에 붙은 member_id, client_id). 신원 규칙은 여기서 한 번만 적용한다
--                 기기당 회원은 1명이어야 한다(checks I1). 가입 전 세션도 그 기기의 회원으로 묶인다
--   자동 로드     체류 0ms, 화면 1개 이하, 시간 폭 2초 이내 — 방문으로 세지 않는다
--   활성          자동 로드가 아니고 engaged 인 세션
--   기기 플랫폼   원천 사용자 속성 desktop 을 화면 계약 값 web 으로 바꾼다 (ios · android · web)
--   채널          세션 라스트클릭 (source, medium) → map_channel. 매핑 없으면 'unmapped'(checks I2)

CREATE OR REPLACE TABLE staging.int_session (
  session_date DATE OPTIONS(description='세션 시작 날짜 (KST). 일 파티션'),
  kst_hour INT64 OPTIONS(description='세션 시작 시 (KST)'),
  client_id STRING OPTIONS(description='기기 식별자'),
  session_id INT64 OPTIONS(description='세션 ID'),
  person_id STRING OPTIONS(description='사람 식별자 = COALESCE(기기의 member_id, client_id)'),
  member_id STRING OPTIONS(description='세션 안에서 관측된 회원 ID (가입·로그인 이후)'),
  session_number INT64 OPTIONS(description='기기 기준 세션 순번'),
  started_at TIMESTAMP OPTIONS(description='세션 첫 이벤트 시각 (UTC)'),
  ended_at TIMESTAMP OPTIONS(description='세션 마지막 이벤트 시각 (UTC)'),
  duration_sec INT64 OPTIONS(description='시간 폭 (초)'),
  engagement_msec INT64 OPTIONS(description='체류 합 (ms)'),
  event_count INT64 OPTIONS(description='이벤트 수'),
  screen_views INT64 OPTIONS(description='화면 조회 수'),
  landing_screen STRING OPTIONS(description='첫 화면 이름'),
  landing_path STRING OPTIONS(description='첫 화면 경로'),
  source STRING OPTIONS(description='라스트클릭 소스'),
  medium STRING OPTIONS(description='라스트클릭 매체'),
  campaign STRING OPTIONS(description='라스트클릭 캠페인 ID'),
  session_channel1 STRING OPTIONS(description='세션 채널 1단계 paid / non_paid'),
  session_channel2 STRING OPTIONS(description='세션 채널 2단계 유입 유형'),
  session_channel3 STRING OPTIONS(description='세션 채널 3단계 플랫폼'),
  device_category STRING OPTIONS(description='mobile / desktop'),
  operating_system STRING OPTIONS(description='기기 OS'),
  device_platform STRING OPTIONS(description='기기 플랫폼 ios / android / web (원천 desktop 을 web 으로)'),
  first_channel STRING OPTIONS(description='첫 유입 사용자 속성 paid / non_paid'),
  is_device_first_session BOOL OPTIONS(description='기기의 첫 세션 (first_visit 이벤트 포함)'),
  is_person_first_session BOOL OPTIONS(description='사람의 첫 방문 세션 (자동 로드 제외 기준)'),
  is_auto_load BOOL OPTIONS(description='자동 로드(허수) 세션'),
  is_engaged BOOL OPTIONS(description='engaged 세션'),
  is_active BOOL OPTIONS(description='활성 세션 = 자동 로드 아님 AND engaged'),
  did_explore BOOL OPTIONS(description='탐색 화면(지도·검색·검색 결과) 조회'),
  did_view_detail BOOL OPTIONS(description='공간 또는 행사 상세 조회'),
  did_view_event_detail BOOL OPTIONS(description='행사 상세 조회'),
  did_view_apply BOOL OPTIONS(description='신청 화면 조회'),
  sign_ups INT64 OPTIONS(description='가입 이벤트 수'),
  logins INT64 OPTIONS(description='로그인 이벤트 수'),
  searches INT64 OPTIONS(description='검색 이벤트 수'),
  promo_clicks INT64 OPTIONS(description='배너 선택 수'),
  shares INT64 OPTIONS(description='공유 수'),
  subscribes INT64 OPTIONS(description='구독 결제 완료 이벤트(subscribe) 수'),
  applications INT64 OPTIONS(description='신청 이벤트 수'),
  purchases INT64 OPTIONS(description='결제 이벤트 수'),
  purchase_amount INT64 OPTIONS(description='결제 금액 합 (원)'),
  cancels INT64 OPTIONS(description='취소 이벤트 수'),
  refund_amount INT64 OPTIONS(description='취소 이벤트 환불액 합 (원)')
)
PARTITION BY session_date
CLUSTER BY person_id
OPTIONS(description='세션 판정 단일 원본. 1행 = 세션 1건. 키 (client_id, session_id). 원천 staging.events_clean·map_channel. 신원·자동 로드·활성·채널 판정')
AS
WITH ev AS (
  SELECT
    client_id, session_id, session_number, member_id, event_at, event_name, screen_name, page_path,
    engagement_time_msec, session_engaged, amount, source, medium, campaign,
    device_category, operating_system, device_platform, first_channel
  FROM staging.events_clean
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
device_member AS (
  SELECT client_id, MIN(member_id) AS member_id
  FROM ev
  WHERE member_id IS NOT NULL
  GROUP BY client_id
),
sess AS (
  SELECT
    client_id,
    session_id,
    MIN(session_number) AS session_number,
    MAX(member_id) AS member_id,
    MIN(event_at) AS started_at,
    MAX(event_at) AS ended_at,
    SUM(engagement_time_msec) AS engagement_msec,
    COUNT(*) AS event_count,
    COUNTIF(event_name = 'screen_view') AS screen_views,
    ARRAY_AGG(IF(event_name = 'screen_view', STRUCT(screen_name, page_path), NULL) IGNORE NULLS ORDER BY event_at LIMIT 1)[SAFE_OFFSET(0)] AS landing,
    ARRAY_AGG(STRUCT(source, medium, campaign, device_category, operating_system, device_platform, first_channel) ORDER BY event_at LIMIT 1)[OFFSET(0)] AS head,
    LOGICAL_OR(event_name = 'first_visit') AS is_device_first_session,
    LOGICAL_OR(session_engaged) AS is_engaged,
    LOGICAL_OR(event_name = 'screen_view' AND screen_name IN ('map_main', 'search_main', 'search_result')) AS did_explore,
    LOGICAL_OR(event_name = 'screen_view' AND screen_name IN ('venue_detail', 'event_detail')) AS did_view_detail,
    LOGICAL_OR(event_name = 'screen_view' AND screen_name = 'event_detail') AS did_view_event_detail,
    LOGICAL_OR(event_name = 'screen_view' AND screen_name = 'event_apply') AS did_view_apply,
    COUNTIF(event_name = 'sign_up') AS sign_ups,
    COUNTIF(event_name = 'login') AS logins,
    COUNTIF(event_name = 'search') AS searches,
    COUNTIF(event_name = 'select_promotion') AS promo_clicks,
    COUNTIF(event_name = 'share') AS shares,
    COUNTIF(event_name = 'subscribe') AS subscribes,
    COUNTIF(event_name = 'apply_event') AS applications,
    COUNTIF(event_name = 'purchase') AS purchases,
    SUM(IF(event_name = 'purchase', amount, 0)) AS purchase_amount,
    COUNTIF(event_name = 'cancel_apply') AS cancels,
    SUM(IF(event_name = 'cancel_apply', amount, 0)) AS refund_amount
  FROM ev
  GROUP BY client_id, session_id
),
judged AS (
  SELECT
    s.*,
    COALESCE(dm.member_id, s.client_id) AS person_id,
    TIMESTAMP_DIFF(s.ended_at, s.started_at, SECOND) AS duration_sec,
    (s.engagement_msec = 0 AND s.screen_views <= 1 AND TIMESTAMP_DIFF(s.ended_at, s.started_at, SECOND) <= 2) AS is_auto_load
  FROM sess AS s
  LEFT JOIN device_member AS dm USING (client_id)
)
SELECT
  DATE(j.started_at, 'Asia/Seoul') AS session_date,
  EXTRACT(HOUR FROM j.started_at AT TIME ZONE 'Asia/Seoul') AS kst_hour,
  j.client_id,
  j.session_id,
  j.person_id,
  j.member_id,
  j.session_number,
  j.started_at,
  j.ended_at,
  j.duration_sec,
  j.engagement_msec,
  j.event_count,
  j.screen_views,
  j.landing.screen_name AS landing_screen,
  j.landing.page_path AS landing_path,
  j.head.source,
  j.head.medium,
  j.head.campaign,
  COALESCE(m.channel1, 'unmapped') AS session_channel1,
  COALESCE(m.channel2, 'unmapped') AS session_channel2,
  COALESCE(m.channel3, 'unmapped') AS session_channel3,
  j.head.device_category,
  j.head.operating_system,
  IF(j.head.device_platform = 'desktop', 'web', j.head.device_platform) AS device_platform,
  j.head.first_channel,
  j.is_device_first_session,
  NOT j.is_auto_load
    AND ROW_NUMBER() OVER (PARTITION BY j.person_id ORDER BY j.is_auto_load, j.started_at, j.client_id) = 1
    AS is_person_first_session,
  j.is_auto_load,
  j.is_engaged,
  NOT j.is_auto_load AND j.is_engaged AS is_active,
  j.did_explore,
  j.did_view_detail,
  j.did_view_event_detail,
  j.did_view_apply,
  j.sign_ups,
  j.logins,
  j.searches,
  j.promo_clicks,
  j.shares,
  j.subscribes,
  j.applications,
  j.purchases,
  j.purchase_amount,
  j.cancels,
  j.refund_amount
FROM judged AS j
LEFT JOIN staging.map_channel AS m
  ON m.source = j.head.source AND m.medium = j.head.medium;
