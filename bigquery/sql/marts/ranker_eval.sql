-- 표: marts.ranker_eval — 순위 모델 오프라인 평가 쌍
-- 1행: 검색어 × 후보 1쌍
-- 키: (query_norm, item_type, item_id)
-- 파티션·클러스터: 없음 / 없음
-- 원천: staging.ml_ranker_pairs (정답 등급·교차 검증 묶음·인기), raw.ml_query_parse (해석·v1 일치), raw.ml_ranker_scores (묶음 밖 모델 점수)
-- 소비: 보고서 랭킹 모델 설계·오프라인 평가(방식별 NDCG@10). ops.reconciliation
-- 검사: C23
--
-- 순위 규칙(ranker/train.py 와 같다). 동점은 item_type, item_id 오름차순
--   rank_popularity  기존 정렬. 정식 이름과 글자가 같은 검색어(v1_match)만 결과가 있고 인기(학습 마감 전 신청 수) 내림차순
--   rank_model       순위 모델. 해석된 검색어(query_intent ≠ other)만 결과가 있고 모델 점수 내림차순
-- 결과가 없는 방식의 순위는 NULL. NDCG@10 은 화면이 이 순위와 label 로 계산한다(이득 2^등급 − 1, 할인 log2(순위 + 1))

CREATE OR REPLACE TABLE marts.ranker_eval (
  query_norm STRING OPTIONS(description='정규화 검색어'),
  query_intent STRING OPTIONS(description='의도 유형 genre / region / event_type / venue_name / other'),
  query_term STRING OPTIONS(description='해석한 정식 이름. 해석 못 하면 NULL'),
  fold INT64 OPTIONS(description='교차 검증 묶음 0~4'),
  item_type STRING OPTIONS(description='후보 종류 venue / event'),
  item_id INT64 OPTIONS(description='공간 ID 또는 행사 ID'),
  label INT64 OPTIONS(description='정답 등급 0~3'),
  n_labels INT64 OPTIONS(description='최종 라벨 수'),
  popularity INT64 OPTIONS(description='학습 마감 전 티켓 신청 수'),
  v1_match BOOL OPTIONS(description='기존 랭킹 기준 정식 이름과 같은 검색어'),
  model_score FLOAT64 OPTIONS(description='묶음 밖 모델 점수. 해석 못 한 검색어는 NULL'),
  rank_popularity INT64 OPTIONS(description='기존 정렬 순위. 결과가 없으면 NULL'),
  rank_model INT64 OPTIONS(description='순위 모델 순위. 결과가 없으면 NULL'),
  model_version STRING OPTIONS(description='모델 버전')
)
OPTIONS(description='순위 모델 오프라인 평가 쌍. 1행 = 검색어 × 후보. 키 (query_norm, item_type, item_id). 원천 staging.ml_ranker_pairs·raw.ml_query_parse·ml_ranker_scores. 방식별 순위(기존 정렬·순위 모델)')
AS
WITH j AS (
  SELECT
    p.query_norm,
    q.query_intent,
    q.query_term,
    p.fold,
    p.item_type,
    p.item_id,
    p.label,
    p.n_labels,
    p.popularity,
    q.v1_match,
    s.model_score,
    s.model_version
  FROM staging.ml_ranker_pairs AS p
  JOIN raw.ml_query_parse AS q USING (query_norm)
  LEFT JOIN raw.ml_ranker_scores AS s USING (query_norm, item_type, item_id)
)
SELECT
  * EXCEPT (model_version),
  IF(v1_match, ROW_NUMBER() OVER (PARTITION BY query_norm ORDER BY popularity DESC, item_type, item_id), NULL) AS rank_popularity,
  IF(query_intent != 'other', ROW_NUMBER() OVER (PARTITION BY query_norm ORDER BY model_score DESC, item_type, item_id), NULL)
    AS rank_model,
  MAX(model_version) OVER () AS model_version
FROM j;
