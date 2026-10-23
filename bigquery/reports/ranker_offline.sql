-- 보고서 순위 모델 설계·오프라인 평가 재현 쿼리 (SELECT 만, 개인 프로젝트에서 scripts/bq.sh query 로 실행)
-- 보고서 화면은 marts.ranker_eval · ranker_query_eval · ranker_feature 를 받아 같은 계산(dashboard/src/reports/M1.tsx)을 한다.
-- 모델 학습·채점은 ranker/train.py (입력 staging.ml_ranker_pairs, 산출 raw.ml_*).
-- ① 검색어 해석: 기준선 2주(2026-06-22 ~ 07-05) 기존 랭킹 0건과 새 해석. 마트와 정제층(int_search + 해석 표) 두 길로 센다
-- ② 순위 모델: 검색어별 NDCG@10(이득 2^등급 − 1, 할인 log2(순위 + 1)), 관련 후보가 있는 검색어 평균, 의도 유형별
-- ③ 피처 중요도

-- ① 검색어 해석
SELECT
  'mart' AS source,
  SUM(requests) AS requests,
  SUM(zero_results) AS zero_results,
  SUM(IF(query_intent = 'other', requests, 0)) AS zero_after_parse,
  SUM(IF(query_intent != 'other', zero_results, 0)) AS zero_linked
FROM marts.ranker_query_eval
UNION ALL
SELECT
  'staging',
  COUNT(*),
  COUNTIF(s.is_zero_result),
  COUNTIF(q.query_intent = 'other'),
  COUNTIF(s.is_zero_result AND q.query_intent != 'other')
FROM staging.int_search AS s
JOIN raw.ml_query_parse AS q USING (query_norm)
WHERE s.kst_date BETWEEN DATE '2026-06-22' AND DATE '2026-07-05';

-- ② 순위 모델 NDCG@10 (방식별 · 의도 유형별)
WITH g AS (
  SELECT
    query_norm,
    query_intent,
    label,
    rank_popularity,
    rank_model,
    ROW_NUMBER() OVER (PARTITION BY query_norm ORDER BY label DESC) AS ideal_rank
  FROM marts.ranker_eval
),
q AS (
  SELECT
    query_norm,
    ANY_VALUE(query_intent) AS query_intent,
    SUM(IF(ideal_rank <= 10, (POW(2, label) - 1) / LOG(ideal_rank + 1, 2), 0)) AS idcg,
    SUM(IF(rank_popularity <= 10, (POW(2, label) - 1) / LOG(rank_popularity + 1, 2), 0)) AS dcg_popularity,
    SUM(IF(rank_model <= 10, (POW(2, label) - 1) / LOG(rank_model + 1, 2), 0)) AS dcg_model
  FROM g
  GROUP BY 1
)
SELECT
  IFNULL(query_intent, 'all') AS query_intent,
  COUNT(*) AS queries,
  ROUND(AVG(dcg_popularity / idcg), 4) AS ndcg_popularity,
  ROUND(AVG(dcg_model / idcg), 4) AS ndcg_model
FROM q
WHERE idcg > 0
GROUP BY ROLLUP (query_intent)
ORDER BY queries DESC;

-- ③ 피처 중요도
SELECT feature, feature_group, ROUND(gain_share, 4) AS gain_share, splits
FROM marts.ranker_feature
ORDER BY gain_share DESC;
