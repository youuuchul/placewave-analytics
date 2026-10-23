-- 표: marts.ranker_feature — 순위 모델 피처 중요도
-- 1행: 피처 1개
-- 키: (model_version, feature)
-- 파티션·클러스터: 없음 / 없음
-- 원천: raw.ml_ranker_features (최종 모델 분할 이득)
-- 소비: 보고서 랭킹 모델 설계·오프라인 평가(피처 중요도). ops.reconciliation
-- 검사: I10

CREATE OR REPLACE TABLE marts.ranker_feature (
  model_version STRING OPTIONS(description='모델 버전'),
  feature STRING OPTIONS(description='피처 이름'),
  feature_group STRING OPTIONS(description='피처 묶음 query / item / match / distance / popularity'),
  gain FLOAT64 OPTIONS(description='분할 이득 합'),
  gain_share FLOAT64 OPTIONS(description='분할 이득 비중 (합 1)'),
  splits INT64 OPTIONS(description='분할에 쓰인 횟수')
)
OPTIONS(description='순위 모델 피처 중요도. 1행 = 피처. 키 (model_version, feature). 원천 raw.ml_ranker_features')
AS
SELECT model_version, feature, feature_group, gain, gain_share, splits
FROM raw.ml_ranker_features;
