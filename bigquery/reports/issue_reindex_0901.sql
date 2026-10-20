-- 보고서 I1 9/1 재색인 회귀 — 재현 쿼리 (SELECT 만)
-- 보고서 화면은 marts.daily_search · daily_query · weekly_batch 를 받아 검색 탭·평가 운영 탭과 같은 계산을 한다.
-- ① 일별 결과 0건 비율(전체·상권 검색어)을 마트와 정제층에서 각각, ② 회귀 주 실패 검색어와 평가 편입일, ③ 대응 주 배치 진척.

-- ① 일별 결과 0건 비율: 마트 vs 정제층
WITH mart AS (
  SELECT
    kst_date,
    SUM(searches) AS searches,
    SUM(zero_result_searches) AS zero,
    SUM(IF(query_intent = 'region', searches, 0)) AS region_searches,
    SUM(IF(query_intent = 'region', zero_result_searches, 0)) AS region_zero
  FROM marts.daily_search
  WHERE kst_date BETWEEN DATE '2026-08-29' AND DATE '2026-09-14'
  GROUP BY 1
),
stg AS (
  SELECT
    kst_date,
    COUNT(*) AS searches,
    COUNTIF(is_zero_result) AS zero,
    COUNTIF(query_intent = 'region') AS region_searches,
    COUNTIF(query_intent = 'region' AND is_zero_result) AS region_zero
  FROM staging.int_search
  WHERE kst_date BETWEEN DATE '2026-08-29' AND DATE '2026-09-14'
  GROUP BY 1
)
SELECT
  m.kst_date,
  m.searches,
  m.zero,
  m.region_searches,
  m.region_zero,
  ROUND(m.zero / m.searches, 4) AS zero_rate,
  ROUND(m.region_zero / m.region_searches, 4) AS region_zero_rate,
  s.searches = m.searches AND s.zero = m.zero AND s.region_zero = m.region_zero AS same_as_staging
FROM mart AS m
JOIN stg AS s USING (kst_date)
ORDER BY 1;

-- ② 회귀 주(9/1~9/7) 실패 검색어(검색 20건 이상 ∧ 결과 0건 30% 이상)와 평가 편입일(검색팀 배치, 9/1 ~ 9/14)
SELECT
  q.query_norm,
  ANY_VALUE(q.query_intent) AS query_intent,
  SUM(q.searches) AS searches,
  SUM(q.zero_result_searches) AS zero,
  ROUND(SUM(q.zero_result_searches) / SUM(q.searches), 4) AS zero_rate,
  (
    SELECT MIN(e.sampled_at)
    FROM raw.eval_queries AS e
    WHERE e.query_norm = q.query_norm AND e.source != 'promoted' AND e.sampled_at BETWEEN DATE '2026-09-01' AND DATE '2026-09-14'
  ) AS eval_date
FROM marts.daily_query AS q
WHERE q.kst_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-07'
GROUP BY 1
HAVING SUM(q.searches) >= 20 AND SUM(q.zero_result_searches) / SUM(q.searches) >= 0.3
ORDER BY zero_rate DESC;

-- ③ 대응 주(9/7) 배치 진척 — 마감 위험 판정은 화면 규칙(우선순위 → 생성일 순 남은 과제 누적 ÷ 팀 처리량 > 마감까지 일수)
SELECT batch_id, requester, purpose, priority, created_date, due_date, target_tasks, done_tasks, remaining_tasks, days_to_due
FROM marts.weekly_batch
WHERE week_start = DATE '2026-09-07'
ORDER BY priority, created_date, batch_id;
