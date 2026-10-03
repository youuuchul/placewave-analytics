-- 표: marts.weekly_rater — 평가자별 주간 집계
-- 1행: 주(월요일 시작) × rater_id × requester
-- 키: 이 세 열
-- 파티션·클러스터: week_start / rater_id
-- 원천: staging.int_label
-- 소비: 평가 운영 탭 활동 평가자·평가자 표·처리량 × 정확도 산점도·기준 미달 평가자
--
-- 기준 미달(화면 판정) = 그 주 정답셋 라벨 10건 이상이고 정확도 80% 미만.

CREATE OR REPLACE TABLE marts.weekly_rater (
  week_start DATE OPTIONS(description='주 시작일 (월요일, KST). 파티션'),
  rater_id STRING OPTIONS(description='평가자 ID'),
  requester STRING OPTIONS(description='요청 부서 search / promotion'),
  rater_group STRING OPTIONS(description='평가자 그룹 internal / vendor'),
  labels INT64 OPTIONS(description='제출 라벨 수 (재작업 포함)'),
  rework_labels INT64 OPTIONS(description='재작업 라벨 수'),
  handle_seconds INT64 OPTIONS(description='처리 시간 합 (초)'),
  gold_labels INT64 OPTIONS(description='정답셋 첫 제출 라벨 수'),
  gold_correct INT64 OPTIONS(description='그중 정답 일치 수'),
  label_pairs INT64 OPTIONS(description='라벨 쌍 수 (이 평가자가 늦게 낸 쪽)'),
  agree_pairs INT64 OPTIONS(description='등급이 같은 라벨 쌍 수')
)
PARTITION BY week_start
CLUSTER BY rater_id
OPTIONS(description='평가자별 주간 집계. 1행 = 주 × 평가자 × 요청 부서. 원천 staging.int_label')
AS
SELECT
  week_start,
  rater_id,
  requester,
  ANY_VALUE(rater_group) AS rater_group,
  COUNT(*) AS labels,
  COUNTIF(is_rework) AS rework_labels,
  SUM(handle_seconds) AS handle_seconds,
  COUNTIF(gold_correct IS NOT NULL) AS gold_labels,
  COUNTIF(gold_correct) AS gold_correct,
  SUM(pairs_with_prior) AS label_pairs,
  SUM(agree_with_prior) AS agree_pairs
FROM staging.int_label
WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
GROUP BY 1, 2, 3;
