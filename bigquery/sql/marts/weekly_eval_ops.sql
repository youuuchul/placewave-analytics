-- 표: marts.weekly_eval_ops — 평가 운영 주간 마트
-- 1행: 주(월요일 시작) × requester × rater_group × guideline_version
-- 키: 이 네 열
-- 파티션·클러스터: week_start / requester
-- 원천: staging.int_label
-- 소비: 보고서 라벨링 운영 단계 스코어보드·추이, 평가 지침 개정 단계 전·후 비교. ops.reconciliation
-- 검사: C18·C19
--
-- 비율·카파는 저장하지 않는다. 정확도 = gold_correct ÷ gold_labels(첫 제출), 일치율 = agree_pairs ÷ label_pairs(최종 라벨),
-- 카파 = (Po − Pe) ÷ (1 − Pe), Pe = Σ (labels_gk ÷ final_labels)². 성분이 합산 가능해 필터 후 다시 계산한다.

CREATE OR REPLACE TABLE marts.weekly_eval_ops (
  week_start DATE OPTIONS(description='주 시작일 (월요일, KST). 파티션'),
  requester STRING OPTIONS(description='요청 부서 search / promotion'),
  rater_group STRING OPTIONS(description='평가자 그룹 internal / vendor'),
  guideline_version STRING OPTIONS(description='지침 버전 v1 / v2'),
  labels INT64 OPTIONS(description='제출 라벨 수 (재작업 포함)'),
  rework_labels INT64 OPTIONS(description='재작업 라벨 수'),
  handle_seconds INT64 OPTIONS(description='처리 시간 합 (초)'),
  gold_labels INT64 OPTIONS(description='정답셋 과제 첫 제출 라벨 수'),
  gold_correct INT64 OPTIONS(description='그중 정답 일치 수'),
  final_labels INT64 OPTIONS(description='최종 라벨 수'),
  label_pairs INT64 OPTIONS(description='라벨 쌍 수 (늦게 낸 라벨에 귀속)'),
  agree_pairs INT64 OPTIONS(description='등급이 같은 라벨 쌍 수'),
  labels_g0 INT64 OPTIONS(description='최종 라벨 중 등급 0'),
  labels_g1 INT64 OPTIONS(description='최종 라벨 중 등급 1'),
  labels_g2 INT64 OPTIONS(description='최종 라벨 중 등급 2'),
  labels_g3 INT64 OPTIONS(description='최종 라벨 중 등급 3'),
  tasks_completed INT64 OPTIONS(description='그 주 완료된 과제 수 (완료시킨 라벨 기준)')
)
PARTITION BY week_start
CLUSTER BY requester
OPTIONS(description='평가 운영 주간 마트. 1행 = 주 × 요청 부서 × 평가자 그룹 × 지침 버전. 원천 staging.int_label')
AS
SELECT
  week_start,
  requester,
  rater_group,
  guideline_version,
  COUNT(*) AS labels,
  COUNTIF(is_rework) AS rework_labels,
  SUM(handle_seconds) AS handle_seconds,
  COUNTIF(gold_correct IS NOT NULL) AS gold_labels,
  COUNTIF(gold_correct) AS gold_correct,
  COUNTIF(is_final) AS final_labels,
  SUM(pairs_with_prior) AS label_pairs,
  SUM(agree_with_prior) AS agree_pairs,
  COUNTIF(is_final AND grade = 0) AS labels_g0,
  COUNTIF(is_final AND grade = 1) AS labels_g1,
  COUNTIF(is_final AND grade = 2) AS labels_g2,
  COUNTIF(is_final AND grade = 3) AS labels_g3,
  COUNTIF(completes_task) AS tasks_completed
FROM staging.int_label
WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
GROUP BY 1, 2, 3, 4;
