-- 표: staging.ml_ranker_pairs — 순위 모델 학습·평가 쌍
-- 1행: 검색어 × 후보(공간·행사) 1쌍
-- 키: (query_norm, item_type, item_id)
-- 파티션·클러스터: 없음 / 없음
-- 원천: staging.int_label (최종 라벨), staging.dim_event (행사의 개최 공간), staging.fct_order (인기 = 학습 마감 전 티켓 신청)
-- 소비: raw.ml_query_parse·ml_ranker_scores·ml_ranker_features (ranker/train.py 가 읽어 해석·학습·채점), marts.ranker_eval, ops.reconciliation
-- 검사: C22·C23
--
-- 규칙
--   학습 마감     2026-07-06(랭킹 A/B 설계서 작성일) 전에 제출된 최종 라벨만 쓴다
--   정답 등급     (검색어, 후보)별 최종 라벨 등급 평균을 반올림한 0~3. 같은 쌍이 여러 배치에 나오면 합친다
--   교차 검증 묶음 검색어 단위 5묶음. fold = FARM_FINGERPRINT(query_norm) 를 5로 나눈 나머지(0~4). 한 묶음을 빼고 학습한 모델이 그 묶음을 채점한다
--   인기          학습 마감 전 티켓 신청 수. 행사는 그 행사, 공간은 그 공간에서 열린 모든 행사

CREATE OR REPLACE TABLE staging.ml_ranker_pairs (
  query_norm STRING OPTIONS(description='정규화 검색어'),
  item_type STRING OPTIONS(description='후보 종류 venue / event'),
  item_id INT64 OPTIONS(description='공간 ID 또는 행사 ID'),
  venue_id INT64 OPTIONS(description='공간 ID (행사는 개최 공간)'),
  label INT64 OPTIONS(description='정답 등급 0~3 (최종 라벨 등급 평균 반올림)'),
  label_mean FLOAT64 OPTIONS(description='최종 라벨 등급 평균'),
  n_labels INT64 OPTIONS(description='최종 라벨 수 (서로 다른 평가자·배치 합)'),
  first_labeled DATE OPTIONS(description='첫 라벨 제출일 (KST)'),
  last_labeled DATE OPTIONS(description='마지막 라벨 제출일 (KST)'),
  fold INT64 OPTIONS(description='교차 검증 묶음 0~4 (검색어 단위 해시)'),
  popularity INT64 OPTIONS(description='학습 마감 전 티켓 신청 수')
)
OPTIONS(description='순위 모델 학습·평가 쌍. 1행 = 검색어 × 후보. 키 (query_norm, item_type, item_id). 원천 staging.int_label·dim_event·fct_order. 2026-07-06 전 최종 라벨, 검색어 단위 5묶음 교차 검증')
AS
WITH lab AS (
  SELECT query_norm, item_type, item_id, grade, kst_date
  FROM staging.int_label
  WHERE is_final AND kst_date < DATE '2026-07-06'
),
pairs AS (
  SELECT
    query_norm,
    item_type,
    item_id,
    CAST(ROUND(AVG(grade)) AS INT64) AS label,
    AVG(grade) AS label_mean,
    COUNT(*) AS n_labels,
    MIN(kst_date) AS first_labeled,
    MAX(kst_date) AS last_labeled
  FROM lab
  GROUP BY 1, 2, 3
),
apps AS (
  SELECT event_id, venue_id, COUNT(*) AS n
  FROM staging.fct_order
  WHERE kind = 'ticket' AND applied_date < DATE '2026-07-06'
  GROUP BY 1, 2
),
by_event AS (SELECT event_id, SUM(n) AS n FROM apps GROUP BY 1),
by_venue AS (SELECT venue_id, SUM(n) AS n FROM apps GROUP BY 1)
SELECT
  p.query_norm,
  p.item_type,
  p.item_id,
  IF(p.item_type = 'event', e.venue_id, p.item_id) AS venue_id,
  p.label,
  p.label_mean,
  p.n_labels,
  p.first_labeled,
  p.last_labeled,
  MOD(ABS(FARM_FINGERPRINT(p.query_norm)), 5) AS fold,
  COALESCE(IF(p.item_type = 'event', be.n, bv.n), 0) AS popularity
FROM pairs AS p
LEFT JOIN staging.dim_event AS e ON p.item_type = 'event' AND e.event_id = p.item_id
LEFT JOIN by_event AS be ON p.item_type = 'event' AND be.event_id = p.item_id
LEFT JOIN by_venue AS bv ON p.item_type = 'venue' AND bv.venue_id = p.item_id;
