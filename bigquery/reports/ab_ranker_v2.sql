-- 보고서 E1 랭킹 A/B 테스트 — 재현 쿼리 (SELECT 만, 개인 프로젝트에서 scripts/bq.sh query 로 실행)
-- 보고서 화면은 marts.daily_search 를 받아 같은 계산(dashboard/src/lib/experiments.ts)을 한다. 아래 두 쿼리는
-- ① 마트에서 화면의 '기간 내 집계(일 × 군)' 표를, ② 마트를 거치지 않고 정제층에서 군별 합계를 다시 센다(대조용).
-- A/B 기간 = 두 버전(v1 대조군 · v2 실험군)이 각각 그날 검색의 10% 이상인 날.

-- ① 마트: 기간 내 일 × 군 집계
WITH by_day AS (
  SELECT
    kst_date,
    SUM(IF(ranker_version = 'v1', searches, 0)) AS v1,
    SUM(IF(ranker_version = 'v2', searches, 0)) AS v2
  FROM marts.daily_search
  GROUP BY 1
),
span AS (
  SELECT MIN(kst_date) AS from_date, MAX(kst_date) AS to_date
  FROM by_day
  WHERE LEAST(v1, v2) >= 0.1 * (v1 + v2)
)
SELECT
  d.kst_date,
  d.ranker_version,
  SUM(d.searches) AS searches,
  SUM(d.zero_result_searches) AS zero_result_searches,
  SUM(d.ga_matched_searches) AS ga_matched_searches,
  SUM(d.matched_result_searches) AS matched_result_searches,
  SUM(d.clicked_searches) AS clicked_searches,
  SUM(d.first_click_position_sum) AS first_click_position_sum,
  SUM(d.first_click_position_sq_sum) AS first_click_position_sq_sum,
  SUM(d.top3_clicks) AS top3_clicks,
  SUM(d.reformulated_searches) AS reformulated_searches,
  SUM(d.search_sessions) AS search_sessions,
  SUM(d.search_sessions_applied) AS search_sessions_applied
FROM marts.daily_search AS d, span
WHERE d.kst_date BETWEEN span.from_date AND span.to_date
GROUP BY 1, 2
ORDER BY 1, 2;

-- ② 정제층: 군별 합계 (기간은 ①의 결과 2026-07-13 ~ 07-26)
SELECT
  ranker_version,
  COUNT(*) AS searches,
  COUNTIF(is_zero_result) AS zero_result_searches,
  COUNTIF(ga_matched) AS ga_matched_searches,
  COUNTIF(ga_matched AND NOT is_zero_result) AS matched_result_searches,
  COUNTIF(is_clicked) AS clicked_searches,
  SUM(IF(is_clicked, first_click_position, 0)) AS first_click_position_sum,
  SUM(IF(is_clicked, first_click_position * first_click_position, 0)) AS first_click_position_sq_sum,
  COUNTIF(is_clicked AND first_click_position <= 3) AS top3_clicks,
  COUNTIF(is_reformulated) AS reformulated_searches,
  COUNTIF(is_session_first) AS search_sessions,
  COUNTIF(session_applied) AS search_sessions_applied
FROM staging.int_search
WHERE kst_date BETWEEN DATE '2026-07-13' AND DATE '2026-07-26'
GROUP BY 1
ORDER BY 1;
