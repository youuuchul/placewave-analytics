-- 표: staging.int_label — 평가 라벨 단일 원본
-- 1행: 라벨 1건
-- 키: label_id
-- 파티션·클러스터: kst_date / batch_id, rater_id
-- 원천: raw.eval_labels·eval_tasks·eval_batches·eval_raters
-- 소비: marts.weekly_eval_ops·weekly_rater·weekly_batch, staging.ml_ranker_pairs, ops.reconciliation
-- 검사: C18·C19·I7
--
-- 규칙
--   날짜·주       제출 시각의 KST 날짜, 주는 월요일 시작
--   첫 제출       is_rework = FALSE. 정답셋 정확도는 첫 제출만 본다(검수 반려 전 품질)
--   최종 라벨     (과제, 평가자)별 마지막 제출. 일치도·등급 분포는 최종 라벨만 본다
--   라벨 쌍       최종 라벨마다 같은 과제의 '먼저 제출된' 최종 라벨과 이루는 쌍을 센다. 쌍은 늦게 낸 라벨의 주·평가자·그룹에 속한다
--                 → 어느 축으로 나눠 더해도 쌍이 두 번 세지지 않는다
--   과제 완료     첫 제출 평가자 수가 labels_per_task 에 도달한 시각(completes_task = 그 라벨)

CREATE OR REPLACE TABLE staging.int_label (
  kst_date DATE OPTIONS(description='제출 날짜 (KST). 일 파티션'),
  week_start DATE OPTIONS(description='제출 주 월요일 (KST)'),
  label_id STRING OPTIONS(description='라벨 ID'),
  task_id STRING OPTIONS(description='과제 ID'),
  batch_id STRING OPTIONS(description='배치 ID'),
  requester STRING OPTIONS(description='요청 부서 search / promotion'),
  purpose STRING OPTIONS(description='배치 목적 train / eval / adhoc'),
  guideline_version STRING OPTIONS(description='지침 버전 v1 / v2 (배치 기준)'),
  rater_id STRING OPTIONS(description='평가자 ID'),
  rater_group STRING OPTIONS(description='internal / vendor'),
  query_norm STRING OPTIONS(description='정규화 검색어'),
  item_type STRING OPTIONS(description='venue / event'),
  item_id INT64 OPTIONS(description='공간·행사 ID'),
  grade INT64 OPTIONS(description='등급 0~3'),
  submitted_at TIMESTAMP OPTIONS(description='제출 시각 (UTC)'),
  handle_seconds INT64 OPTIONS(description='처리 시간 (초)'),
  is_rework BOOL OPTIONS(description='검수 반려 후 재제출'),
  is_gold BOOL OPTIONS(description='정답셋 과제'),
  gold_correct BOOL OPTIONS(description='첫 제출 정답셋 라벨의 정답 일치. 그 외 NULL'),
  is_final BOOL OPTIONS(description='(과제, 평가자)의 최종 라벨'),
  pairs_with_prior INT64 OPTIONS(description='최종 라벨만: 같은 과제의 먼저 제출된 최종 라벨 수 (= 이 라벨이 만드는 쌍 수)'),
  agree_with_prior INT64 OPTIONS(description='최종 라벨만: 그중 등급이 같은 수'),
  completes_task BOOL OPTIONS(description='이 첫 제출로 과제가 완료됨 (labels_per_task 번째 평가자)')
)
PARTITION BY kst_date
CLUSTER BY batch_id, rater_id
OPTIONS(description='평가 라벨 단일 원본. 1행 = 라벨 1건. 키 label_id. 원천 raw.eval_labels·eval_tasks·eval_batches·eval_raters. 첫 제출·최종 라벨·라벨 쌍·과제 완료 판정')
AS
WITH l AS (
  SELECT
    l.label_id, l.task_id, l.rater_id, l.grade, l.submitted_at, l.handle_seconds, l.is_rework,
    t.batch_id, t.query_norm, t.item_type, t.item_id, t.is_gold, t.gold_grade,
    b.requester, b.purpose, b.guideline_version, b.labels_per_task,
    r.rater_group,
    ROW_NUMBER() OVER (PARTITION BY l.task_id, l.rater_id ORDER BY l.submitted_at DESC, l.label_id DESC) = 1 AS is_final
  FROM raw.eval_labels AS l
  JOIN raw.eval_tasks AS t USING (task_id)
  JOIN raw.eval_batches AS b USING (batch_id)
  JOIN raw.eval_raters AS r USING (rater_id)
),
final AS (
  SELECT
    label_id,
    ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY submitted_at, label_id) - 1 AS pairs_with_prior,
    grade, task_id, submitted_at
  FROM l
  WHERE is_final
),
agree AS (
  SELECT a.label_id, COUNTIF(b.grade = a.grade) AS agree_with_prior
  FROM final AS a
  LEFT JOIN final AS b
    ON b.task_id = a.task_id AND (b.submitted_at < a.submitted_at OR (b.submitted_at = a.submitted_at AND b.label_id < a.label_id))
  GROUP BY a.label_id
),
first_sub AS (
  SELECT
    label_id,
    ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY submitted_at, label_id) AS nth
  FROM l
  WHERE NOT is_rework
)
SELECT
  DATE(l.submitted_at, 'Asia/Seoul') AS kst_date,
  DATE_TRUNC(DATE(l.submitted_at, 'Asia/Seoul'), WEEK(MONDAY)) AS week_start,
  l.label_id, l.task_id, l.batch_id, l.requester, l.purpose, l.guideline_version,
  l.rater_id, l.rater_group, l.query_norm, l.item_type, l.item_id, l.grade, l.submitted_at, l.handle_seconds,
  l.is_rework, l.is_gold,
  IF(l.is_gold AND NOT l.is_rework, l.grade = l.gold_grade, NULL) AS gold_correct,
  l.is_final,
  COALESCE(f.pairs_with_prior, 0) AS pairs_with_prior,
  COALESCE(a.agree_with_prior, 0) AS agree_with_prior,
  COALESCE(s.nth = l.labels_per_task, FALSE) AS completes_task
FROM l
LEFT JOIN final AS f USING (label_id)
LEFT JOIN agree AS a USING (label_id)
LEFT JOIN first_sub AS s USING (label_id);
