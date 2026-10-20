-- 보고서 X1 평가 지침 개정 — 재현 쿼리 (SELECT 만)
-- 보고서 화면은 marts.weekly_eval_ops 를 받아 평가 운영 탭과 같은 함수(정확도·일치율·카파·건당 처리 시간·재작업률)로 계산한다.
-- ① 마트에서 화면의 '기간 내 집계(주 × 지침)' 표를, ② 정제층에서 지침 버전별 누적 성분을 다시 센다(대조용).
-- 기간 = 평가 시작 주 ~ 마지막 완료 주(주 끝이 기준일 이하). 기준일 = 일 마트의 마지막 날짜.

-- ① 마트: 주 × 지침 집계
WITH cutoff AS (SELECT MAX(kst_date) AS to_date FROM marts.daily_metrics)
SELECT
  week_start,
  guideline_version,
  SUM(labels) AS labels,
  SUM(rework_labels) AS rework_labels,
  SUM(handle_seconds) AS handle_seconds,
  SUM(gold_labels) AS gold_labels,
  SUM(gold_correct) AS gold_correct,
  SUM(final_labels) AS final_labels,
  SUM(label_pairs) AS label_pairs,
  SUM(agree_pairs) AS agree_pairs,
  SUM(labels_g0) AS labels_g0,
  SUM(labels_g1) AS labels_g1,
  SUM(labels_g2) AS labels_g2,
  SUM(labels_g3) AS labels_g3,
  SUM(tasks_completed) AS tasks_completed
FROM marts.weekly_eval_ops, cutoff
WHERE DATE_ADD(week_start, INTERVAL 6 DAY) <= cutoff.to_date
GROUP BY 1, 2
ORDER BY 1, 2;

-- ② 정제층: 지침 버전별 누적 성분 → 정확도·일치율·카파·건당 처리 시간·재작업률
WITH cutoff AS (SELECT MAX(kst_date) AS to_date FROM marts.daily_metrics),
g AS (
  SELECT
    guideline_version,
    COUNT(*) AS labels,
    COUNTIF(is_rework) AS rework_labels,
    SUM(handle_seconds) AS handle_seconds,
    COUNTIF(gold_correct IS NOT NULL) AS gold_labels,
    COUNTIF(gold_correct) AS gold_correct,
    COUNTIF(is_final) AS final_labels,
    SUM(pairs_with_prior) AS label_pairs,
    SUM(agree_with_prior) AS agree_pairs,
    COUNTIF(is_final AND grade = 0) AS g0,
    COUNTIF(is_final AND grade = 1) AS g1,
    COUNTIF(is_final AND grade = 2) AS g2,
    COUNTIF(is_final AND grade = 3) AS g3
  FROM staging.int_label, cutoff
  WHERE DATE_ADD(week_start, INTERVAL 6 DAY) <= cutoff.to_date
  GROUP BY 1
)
SELECT
  guideline_version,
  labels,
  ROUND(gold_correct / gold_labels, 4) AS gold_accuracy,
  ROUND(agree_pairs / label_pairs, 4) AS agreement,
  ROUND(
    (agree_pairs / label_pairs - (POW(g0 / final_labels, 2) + POW(g1 / final_labels, 2) + POW(g2 / final_labels, 2) + POW(g3 / final_labels, 2)))
    / (1 - (POW(g0 / final_labels, 2) + POW(g1 / final_labels, 2) + POW(g2 / final_labels, 2) + POW(g3 / final_labels, 2))),
    4
  ) AS kappa,
  ROUND(handle_seconds / labels, 2) AS seconds_per_label,
  ROUND(rework_labels / labels, 4) AS rework_rate
FROM g
ORDER BY 1;
