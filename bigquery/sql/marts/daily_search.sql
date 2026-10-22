-- 표: marts.daily_search — 검색 품질 일 마트
-- 1행: 일(KST) × query_intent × ranker_version × channel1 × device_platform × member_seg
-- 키: 이 여섯 열
-- 파티션·클러스터: kst_date / query_intent, ranker_version
-- 원천: staging.int_search
-- 소비: 검색 탭 스코어보드·추이·의도 유형·랭킹 버전 분해, 주간·월간 탭 주간 브리핑. ops.reconciliation
-- 검사: C16·I8
--
-- 비율은 저장하지 않는다. 검색 지표는 모두 서버 요청이 기준이다: 검색 성공률 = clicked ÷ searches,
-- 결과 0건 비율 = zero ÷ searches, 결과 클릭률 = clicked ÷ result_searches, 재검색률 = reformulated ÷ searches.
-- result_searches = searches − zero_result_searches 라 성공률 = (1 − 0건 비율) × 결과 클릭률 이 정확히 성립한다(검사 I8).
-- 세션 열은 세션의 첫 검색 행에 귀속된 값이라 어느 축으로 더해도 세션이 두 번 세지지 않는다.

CREATE OR REPLACE TABLE marts.daily_search (
  kst_date DATE OPTIONS(description='날짜 (KST, 세션 시작일). 일 파티션'),
  query_intent STRING OPTIONS(description='의도 유형 genre / region / event_type / venue_name / other'),
  ranker_version STRING OPTIONS(description='랭킹 버전 v1 / v2 (세션 시작일 기준)'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  searches INT64 OPTIONS(description='서버 검색 요청 수'),
  zero_result_searches INT64 OPTIONS(description='결과 0건 요청 수'),
  result_searches INT64 OPTIONS(description='결과가 1건 이상인 요청 수 (결과 클릭률 분모)'),
  clicked_searches INT64 OPTIONS(description='결과를 1번 이상 클릭한 요청 수 (검색 성공률 분자)'),
  first_click_position_sum INT64 OPTIONS(description='첫 클릭 순위 합 (평균 순위 분자)'),
  first_click_position_sq_sum INT64 OPTIONS(description='첫 클릭 순위 제곱 합 (랭킹 버전 간 평균 순위 차이의 95% 구간용 분산 성분)'),
  top3_clicks INT64 OPTIONS(description='첫 클릭이 1~3위인 요청 수'),
  reformulated_searches INT64 OPTIONS(description='결과를 누르지 않고 같은 세션에서 다시 검색한 요청 수'),
  promoted_searches INT64 OPTIONS(description='상단 추천 슬롯이 노출된 요청 수'),
  search_sessions INT64 OPTIONS(description='검색이 있었던 방문 세션 수 (세션 첫 검색에 귀속)'),
  search_sessions_applied INT64 OPTIONS(description='그중 같은 세션에서 행사 신청한 세션 수'),
  latency_ms_sum INT64 OPTIONS(description='응답 시간 합 (ms, 평균 응답 시간 분자)'),
  ga_logged_searches INT64 OPTIONS(description='같은 search_id 의 GA search 이벤트가 수집된 요청 수 (수집 품질)')
)
PARTITION BY kst_date
CLUSTER BY query_intent, ranker_version
OPTIONS(description='검색 품질 일 마트. 1행 = 일 × 의도 유형 × 랭킹 버전 × channel1 × device_platform × member_seg. 원천 staging.int_search')
AS
SELECT
  kst_date,
  query_intent,
  ranker_version,
  channel1,
  device_platform,
  member_seg,
  COUNT(*) AS searches,
  COUNTIF(is_zero_result) AS zero_result_searches,
  COUNTIF(NOT is_zero_result) AS result_searches,
  COUNTIF(is_clicked) AS clicked_searches,
  COALESCE(SUM(IF(is_clicked, first_click_position, 0)), 0) AS first_click_position_sum,
  COALESCE(SUM(IF(is_clicked, first_click_position * first_click_position, 0)), 0) AS first_click_position_sq_sum,
  COUNTIF(is_clicked AND first_click_position <= 3) AS top3_clicks,
  COUNTIF(is_reformulated) AS reformulated_searches,
  COUNTIF(has_promoted) AS promoted_searches,
  COUNTIF(is_session_first) AS search_sessions,
  COUNTIF(session_applied) AS search_sessions_applied,
  SUM(latency_ms) AS latency_ms_sum,
  COUNTIF(ga_logged) AS ga_logged_searches
FROM staging.int_search
WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
GROUP BY 1, 2, 3, 4, 5, 6;
