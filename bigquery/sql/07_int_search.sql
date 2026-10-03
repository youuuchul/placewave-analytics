-- 표: staging.int_search — 검색 요청 단일 원본 (서버 로그 + GA 행동)
-- 1행: 서버 검색 요청 1건
-- 키: request_id
-- 파티션·클러스터: kst_date / query_norm
-- 원천: raw.search_log·db_venues·db_events, staging.events_clean·int_session·int_person_day
-- 소비: marts.daily_search·daily_query, ops.reconciliation
-- 검사: C16·C17·R12·I5·I6
--
-- 규칙
--   GA 매칭      서버 요청 ↔ GA search 이벤트를 같은 기기 + 시각 차 3초 이내로 1:1 매칭(가장 가까운 쌍).
--                공유 키가 없어 근접 조인한다. 매칭률은 검사 R12
--   다음 행동    GA 세션 안 search·screen_view 를 시각 순으로 놓고, 검색 뒤 첫 검색 결과 화면의 바로 다음 이벤트
--                screen_view venue_detail = 클릭 후보, search = 재검색. 매칭 안 된 요청은 행동 열이 FALSE
--   클릭         다음 화면이 공간 상세이고 그 공간이 노출 목록(results)에 있다. 그 순위가 첫 클릭 순위
--   날짜·사람    매칭된 요청은 GA 세션, 매칭 안 된 요청은 같은 기기의 요청 직전 방문 세션(자동 로드 제외)에 붙인다.
--                kst_date = 그 세션 시작일(세션과 그 안의 행동은 세션 시작일에 속한다). 세그먼트는 int_person_day
--   세션 대표    세션의 첫 매칭 검색만 is_session_first = TRUE. 세션 단위 열(신청 도달)은 이 행에만 둔다 — 합산 시 중복 없음
--   의도 유형    정규화 검색어를 장르·상권(공간 원장)·행사 유형(행사 원장) 사전에 대고, 어디에도 없으면 공간명

CREATE OR REPLACE TABLE staging.int_search (
  kst_date DATE OPTIONS(description='날짜 (KST, 붙인 세션의 시작일). 일 파티션'),
  request_id STRING OPTIONS(description='서버 검색 요청 ID'),
  requested_at TIMESTAMP OPTIONS(description='서버 수신 시각 (UTC)'),
  client_id STRING OPTIONS(description='기기 식별자'),
  session_id INT64 OPTIONS(description='붙인 세션 ID'),
  person_id STRING OPTIONS(description='사람 식별자 (int_session 신원 규칙)'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  query_raw STRING OPTIONS(description='입력 검색어'),
  query_norm STRING OPTIONS(description='정규화 검색어 (소문자·앞뒤 공백 제거)'),
  query_intent STRING OPTIONS(description='의도 유형 genre / region / event_type / venue_name'),
  ranker_version STRING OPTIONS(description='랭킹 버전 v1 / v2'),
  results_count INT64 OPTIONS(description='결과 수'),
  is_zero_result BOOL OPTIONS(description='결과 0건'),
  has_promoted BOOL OPTIONS(description='상단 추천 슬롯 노출'),
  latency_ms INT64 OPTIONS(description='응답 시간 (ms)'),
  ga_matched BOOL OPTIONS(description='GA search 이벤트와 매칭됨'),
  is_clicked BOOL OPTIONS(description='결과 클릭 (다음 화면이 노출된 공간의 상세)'),
  first_click_position INT64 OPTIONS(description='첫 클릭 순위 1~10. 클릭 없으면 NULL'),
  is_reformulated BOOL OPTIONS(description='결과를 누르지 않고 바로 다시 검색'),
  is_session_first BOOL OPTIONS(description='세션의 첫 매칭 검색 (세션 단위 열의 대표 행)'),
  session_applied BOOL OPTIONS(description='세션 대표 행에서만: 같은 세션에서 행사 신청. 그 외 FALSE')
)
PARTITION BY kst_date
CLUSTER BY query_norm
OPTIONS(description='검색 요청 단일 원본. 1행 = 서버 검색 요청 1건. 키 request_id. 원천 raw.search_log + staging.events_clean·int_session·int_person_day. GA 근접 매칭·다음 행동·의도 유형 판정')
AS
WITH req AS (
  SELECT
    request_id, requested_at, user_pseudo_id AS client_id, query_raw,
    LOWER(TRIM(query_raw)) AS query_norm, ranker_version, results_count, results,
    promoted_event_id IS NOT NULL AS has_promoted, latency_ms
  FROM raw.search_log
),
ev AS (
  SELECT
    client_id, session_id, event_at, event_name, screen_name, venue_id,
    ROW_NUMBER() OVER (PARTITION BY client_id, session_id ORDER BY event_at, event_name) AS idx
  FROM staging.events_clean
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND (event_name = 'search' OR event_name = 'screen_view')
),
ev_next AS (
  SELECT
    *,
    MIN(IF(event_name = 'screen_view' AND screen_name = 'search_result', idx, NULL)) OVER (
      PARTITION BY client_id, session_id ORDER BY idx ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
    ) AS result_idx
  FROM ev
),
ga AS (
  SELECT
    s.client_id, s.session_id, s.event_at,
    n.event_name AS next_event, n.screen_name AS next_screen, n.venue_id AS next_venue
  FROM ev_next AS s
  LEFT JOIN ev AS n
    ON n.client_id = s.client_id AND n.session_id = s.session_id AND n.idx = s.result_idx + 1
  WHERE s.event_name = 'search'
),
pair AS (
  SELECT
    r.request_id, g.client_id, g.session_id, g.event_at, g.next_event, g.next_screen, g.next_venue,
    ABS(TIMESTAMP_DIFF(r.requested_at, g.event_at, MICROSECOND)) AS gap
  FROM req AS r
  JOIN ga AS g
    ON g.client_id = r.client_id
   AND g.event_at BETWEEN TIMESTAMP_SUB(r.requested_at, INTERVAL 3 SECOND) AND TIMESTAMP_ADD(r.requested_at, INTERVAL 3 SECOND)
),
matched AS (
  SELECT * EXCEPT (rn_g)
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY client_id, session_id, event_at ORDER BY gap, request_id) AS rn_g
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY gap, event_at) AS rn_r
      FROM pair
    )
    WHERE rn_r = 1
  )
  WHERE rn_g = 1
),
fallback AS (
  SELECT r.request_id, ARRAY_AGG(s.session_id ORDER BY s.started_at DESC LIMIT 1)[OFFSET(0)] AS session_id
  FROM req AS r
  JOIN staging.int_session AS s
    ON s.client_id = r.client_id AND s.started_at <= r.requested_at AND NOT s.is_auto_load
  WHERE r.request_id NOT IN (SELECT request_id FROM matched)
    AND s.session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
  GROUP BY r.request_id
),
dict AS (
  SELECT DISTINCT LOWER(genre) AS term, 'genre' AS intent FROM raw.db_venues
  UNION DISTINCT SELECT DISTINCT LOWER(region), 'region' FROM raw.db_venues
  UNION DISTINCT SELECT DISTINCT LOWER(event_type), 'event_type' FROM raw.db_events
),
joined AS (
  SELECT
    r.*,
    m.request_id IS NOT NULL AS ga_matched,
    COALESCE(m.session_id, f.session_id) AS session_id,
    m.event_at AS ga_event_at,
    m.next_event, m.next_screen, m.next_venue
  FROM req AS r
  LEFT JOIN matched AS m USING (request_id)
  LEFT JOIN fallback AS f USING (request_id)
),
judged AS (
  SELECT
    j.*,
    s.session_date,
    s.person_id,
    s.applications > 0 AS applied,
    (
      SELECT MIN(x.position) FROM UNNEST(j.results) AS x
      WHERE x.item_type = 'venue' AND x.item_id = j.next_venue
    ) AS click_pos
  FROM joined AS j
  LEFT JOIN staging.int_session AS s
    ON s.client_id = j.client_id AND s.session_id = j.session_id
   AND s.session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
)
SELECT
  COALESCE(j.session_date, DATE(j.requested_at, 'Asia/Seoul')) AS kst_date,
  j.request_id,
  j.requested_at,
  j.client_id,
  j.session_id,
  j.person_id,
  p.channel1,
  p.device_platform,
  p.member_seg,
  j.query_raw,
  j.query_norm,
  COALESCE(d.intent, 'venue_name') AS query_intent,
  j.ranker_version,
  j.results_count,
  j.results_count = 0 AS is_zero_result,
  j.has_promoted,
  j.latency_ms,
  j.ga_matched,
  j.ga_matched AND j.next_screen = 'venue_detail' AND j.click_pos IS NOT NULL AS is_clicked,
  IF(j.ga_matched AND j.next_screen = 'venue_detail', j.click_pos, NULL) AS first_click_position,
  j.ga_matched AND j.next_event = 'search' AS is_reformulated,
  j.ga_matched AND ROW_NUMBER() OVER (
    PARTITION BY j.client_id, j.session_id, j.ga_matched ORDER BY j.ga_event_at
  ) = 1 AS is_session_first,
  j.ga_matched AND COALESCE(j.applied, FALSE) AND ROW_NUMBER() OVER (
    PARTITION BY j.client_id, j.session_id, j.ga_matched ORDER BY j.ga_event_at
  ) = 1 AS session_applied
FROM judged AS j
LEFT JOIN staging.int_person_day AS p
  ON p.person_id = j.person_id AND p.kst_date = j.session_date
 AND p.kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
LEFT JOIN dict AS d
  ON d.term = j.query_norm;
