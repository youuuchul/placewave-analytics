-- 보고서 D1 실패 검색어 발견: 재현 쿼리 (SELECT 만)
-- 보고서 화면은 marts.daily_query 를 받아 검색 탭과 같은 계산(검색 20건 이상 ∧ 결과 0건 30% 이상)을 한다.
-- ① 평가 착수 전 28일(3/4~3/31) 검색어별 합계를 마트와 정제층에서 각각, 실패 여부와 평가 편입일(검색팀 배치, 3/4 ~ 4/7),
-- ② 같은 기간 전체 검색 수·결과 0건, ③ 주(월요일 시작)별 실패 검색어 수.

-- ① 검색어별 합계: 마트 vs 정제층, 실패 여부, 평가 편입일
WITH mart AS (
  SELECT query_norm, ANY_VALUE(query_intent) AS query_intent, SUM(searches) AS searches, SUM(zero_result_searches) AS zero
  FROM marts.daily_query
  WHERE kst_date BETWEEN DATE '2026-03-04' AND DATE '2026-03-31'
  GROUP BY 1
),
stg AS (
  SELECT query_norm, COUNT(*) AS searches, COUNTIF(is_zero_result) AS zero
  FROM staging.int_search
  WHERE kst_date BETWEEN DATE '2026-03-04' AND DATE '2026-03-31'
  GROUP BY 1
)
SELECT
  m.query_norm,
  m.query_intent,
  m.searches,
  m.zero,
  ROUND(m.zero / m.searches, 4) AS zero_rate,
  m.zero / m.searches >= 0.3 AS failed,
  (
    SELECT MIN(e.sampled_at)
    FROM raw.eval_queries AS e
    WHERE e.query_norm = m.query_norm AND e.source != 'promoted' AND e.sampled_at BETWEEN DATE '2026-03-04' AND DATE '2026-04-07'
  ) AS eval_date,
  s.searches = m.searches AND s.zero = m.zero AS same_as_staging
FROM mart AS m
LEFT JOIN stg AS s USING (query_norm)
WHERE m.searches >= 20
ORDER BY failed DESC, zero_rate DESC, query_norm;

-- ② 같은 기간 전체 검색 수 · 결과 0건: 마트 vs 정제층
SELECT
  (SELECT SUM(searches) FROM marts.daily_query WHERE kst_date BETWEEN DATE '2026-03-04' AND DATE '2026-03-31') AS mart_searches,
  (SELECT SUM(zero_result_searches) FROM marts.daily_query WHERE kst_date BETWEEN DATE '2026-03-04' AND DATE '2026-03-31') AS mart_zero,
  (SELECT COUNT(*) FROM staging.int_search WHERE kst_date BETWEEN DATE '2026-03-04' AND DATE '2026-03-31') AS stg_searches,
  (SELECT COUNTIF(is_zero_result) FROM staging.int_search WHERE kst_date BETWEEN DATE '2026-03-04' AND DATE '2026-03-31') AS stg_zero;

-- ③ 주별 실패 검색어 수 (주 = 월요일 시작 7일, 주 안 검색 20건 이상 ∧ 결과 0건 30% 이상)
SELECT week_start, COUNTIF(searches >= 20) AS queries_20, COUNTIF(searches >= 20 AND zero / searches >= 0.3) AS failed
FROM (
  SELECT DATE_TRUNC(kst_date, WEEK(MONDAY)) AS week_start, query_norm, SUM(searches) AS searches, SUM(zero_result_searches) AS zero
  FROM marts.daily_query
  GROUP BY 1, 2
)
GROUP BY 1
ORDER BY 1;
