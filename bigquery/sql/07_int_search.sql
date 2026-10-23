-- 표: staging.int_search — 검색 요청 단일 원본 (서버 요청 로그 + 서버 클릭 로그)
-- 1행: 서버 검색 요청 1건
-- 키: request_id
-- 파티션·클러스터: kst_date / query_norm
-- 원천: raw.search_log·search_click_log, staging.events_clean·int_session·int_person_day
-- 소비: marts.daily_search·daily_query·exp_ranker_request·ranker_query_eval, raw.ml_query_parse, ops.reconciliation
-- 검사: C16·C17·C21·R12·I5·I6·I9
--
-- 규칙
--   클릭         서버 클릭 로그를 요청 ID 로 묶는다. 요청의 첫 클릭(시각순)이 클릭 여부·첫 클릭 순위·클릭 대상
--   세션         요청에 실린 ga_session_id 로 int_session 에 붙인다. kst_date = 세션 시작일(세션과 그 안의 검색은
--                세션 시작일에 속한다. 랭킹 버전도 세션 시작일 기준이라 날짜와 버전이 어긋나지 않는다). 세그먼트는 int_person_day
--   재검색       결과를 누르지 않았고 같은 세션에 다음 검색 요청이 있다
--   세션 대표    세션의 첫 요청만 is_session_first = TRUE. 세션 단위 열(신청 도달)은 이 행에만 둔다 — 합산 시 중복 없음
--   GA 수집      같은 search_id 의 GA search 이벤트가 있는가(수집 품질 확인용, 지표 계산에는 쓰지 않는다)
--   의도 유형    서버 로그의 검색어 분류기 결과(genre / region / event_type / venue_name / other)

CREATE OR REPLACE TABLE staging.int_search (
  kst_date DATE OPTIONS(description='날짜 (KST, 요청이 속한 세션의 시작일). 일 파티션'),
  request_id STRING OPTIONS(description='서버 검색 요청 ID'),
  requested_at TIMESTAMP OPTIONS(description='서버 수신 시각 (UTC)'),
  client_id STRING OPTIONS(description='기기 식별자'),
  session_id INT64 OPTIONS(description='세션 ID (요청에 실린 ga_session_id)'),
  person_id STRING OPTIONS(description='사람 식별자 (int_session 신원 규칙)'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  query_raw STRING OPTIONS(description='입력 검색어'),
  query_norm STRING OPTIONS(description='정규화 검색어 (소문자·앞뒤 공백 제거)'),
  query_intent STRING OPTIONS(description='의도 유형 genre / region / event_type / venue_name / other (검색어 분류기)'),
  ranker_version STRING OPTIONS(description='랭킹 버전 v1 / v2 (세션 시작일 기준)'),
  results_count INT64 OPTIONS(description='결과 수'),
  is_zero_result BOOL OPTIONS(description='결과 0건'),
  has_promoted BOOL OPTIONS(description='상단 추천 슬롯 노출'),
  latency_ms INT64 OPTIONS(description='응답 시간 (ms)'),
  is_clicked BOOL OPTIONS(description='결과 클릭 (서버 클릭 로그에 같은 요청 ID 가 있음)'),
  first_click_position INT64 OPTIONS(description='첫 클릭 순위 1~10. 클릭 없으면 NULL'),
  click_item_type STRING OPTIONS(description='첫 클릭 대상 venue / event. 클릭 없으면 NULL'),
  is_reformulated BOOL OPTIONS(description='결과를 누르지 않고 같은 세션에서 다시 검색'),
  is_session_first BOOL OPTIONS(description='세션의 첫 검색 요청 (세션 단위 열의 대표 행)'),
  session_applied BOOL OPTIONS(description='세션 대표 행에서만: 같은 세션에서 행사 신청. 그 외 FALSE'),
  ga_logged BOOL OPTIONS(description='같은 search_id 의 GA search 이벤트가 수집됨 (품질 확인용)')
)
PARTITION BY kst_date
CLUSTER BY query_norm
OPTIONS(description='검색 요청 단일 원본. 1행 = 서버 검색 요청 1건. 키 request_id. 원천 raw.search_log·search_click_log + staging.events_clean·int_session·int_person_day. 요청 ID 로 클릭, ga_session_id 로 세션을 붙인다')
AS
WITH req AS (
  SELECT
    request_id, requested_at, user_pseudo_id AS client_id, ga_session_id AS session_id, query_raw,
    LOWER(TRIM(query_raw)) AS query_norm, query_intent, ranker_version, results_count,
    promoted_event_id IS NOT NULL AS has_promoted, latency_ms
  FROM raw.search_log
),
clk AS (
  SELECT request_id, ARRAY_AGG(STRUCT(position, item_type) ORDER BY clicked_at, position LIMIT 1)[OFFSET(0)] AS c
  FROM raw.search_click_log
  WHERE clicked_at IS NOT NULL
  GROUP BY request_id
),
ga AS (
  SELECT DISTINCT search_id
  FROM staging.events_clean
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND event_name = 'search' AND search_id IS NOT NULL
),
seq AS (
  SELECT
    r.*,
    k.c.position AS click_pos,
    k.c.item_type AS click_type,
    LEAD(r.request_id) OVER w AS next_request,
    ROW_NUMBER() OVER w AS rn
  FROM req AS r
  LEFT JOIN clk AS k USING (request_id)
  WINDOW w AS (PARTITION BY r.client_id, r.session_id ORDER BY r.requested_at, r.request_id)
)
SELECT
  COALESCE(s.session_date, DATE(q.requested_at, 'Asia/Seoul')) AS kst_date,
  q.request_id,
  q.requested_at,
  q.client_id,
  q.session_id,
  s.person_id,
  p.channel1,
  p.device_platform,
  p.member_seg,
  q.query_raw,
  q.query_norm,
  q.query_intent,
  q.ranker_version,
  q.results_count,
  q.results_count = 0 AS is_zero_result,
  q.has_promoted,
  q.latency_ms,
  q.click_pos IS NOT NULL AS is_clicked,
  q.click_pos AS first_click_position,
  q.click_type AS click_item_type,
  q.click_pos IS NULL AND q.next_request IS NOT NULL AS is_reformulated,
  q.rn = 1 AS is_session_first,
  q.rn = 1 AND COALESCE(s.applications > 0, FALSE) AS session_applied,
  g.search_id IS NOT NULL AS ga_logged
FROM seq AS q
LEFT JOIN staging.int_session AS s
  ON s.client_id = q.client_id AND s.session_id = q.session_id
 AND s.session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
LEFT JOIN staging.int_person_day AS p
  ON p.person_id = s.person_id AND p.kst_date = s.session_date
 AND p.kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
LEFT JOIN ga AS g
  ON g.search_id = q.request_id;
