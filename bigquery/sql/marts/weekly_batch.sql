-- 표: marts.weekly_batch — 배치 진척 주간 스냅샷
-- 1행: 주(월요일 시작) × batch_id. 배치 생성 주부터 완료 주(또는 마지막 관측 주)까지
-- 키: (week_start, batch_id)
-- 파티션·클러스터: week_start / requester
-- 원천: staging.int_label, raw.eval_batches
-- 소비: 보고서 라벨링 운영 단계 목표 대비 진척·마감 위험 배치·배치 표, 재색인 회귀 단계 대응 주 배치. ops.reconciliation
-- 검사: I7
--
-- as_of_date = 그 주 마지막 날과 라벨 마지막 관측일 중 이른 날. 누적 값은 as_of_date 까지.
-- 마감 위험(화면 판정) = 진행 배치를 배정 순서(우선순위 → 생성일)로 세운 누적 남은 과제 ÷ 팀 처리량(최근 14일 완료 과제 ÷ 14)
--   > 마감까지 남은 일수, 또는 마감 지남. recent_done_14d 는 배치 자체 처리 속도로 참고용.

CREATE OR REPLACE TABLE marts.weekly_batch (
  week_start DATE OPTIONS(description='주 시작일 (월요일, KST). 파티션'),
  batch_id STRING OPTIONS(description='배치 ID'),
  requester STRING OPTIONS(description='요청 부서 search / promotion'),
  purpose STRING OPTIONS(description='train / eval / adhoc'),
  guideline_version STRING OPTIONS(description='지침 버전 v1 / v2'),
  priority INT64 OPTIONS(description='배정 우선순위 (1 = 긴급)'),
  created_date DATE OPTIONS(description='생성일 (KST)'),
  due_date DATE OPTIONS(description='마감일 (KST)'),
  as_of_date DATE OPTIONS(description='누적 기준일'),
  target_tasks INT64 OPTIONS(description='목표 과제 수'),
  done_tasks INT64 OPTIONS(description='as_of_date 까지 완료된 과제 수 (누적)'),
  done_in_week INT64 OPTIONS(description='그 주 완료된 과제 수'),
  remaining_tasks INT64 OPTIONS(description='남은 과제 수'),
  recent_done_14d INT64 OPTIONS(description='as_of_date 포함 최근 14일 완료 과제 수 (처리 속도)'),
  days_to_due INT64 OPTIONS(description='마감까지 남은 일수 (음수 = 지남)')
)
PARTITION BY week_start
CLUSTER BY requester
OPTIONS(description='배치 진척 주간 스냅샷. 1행 = 주 × 배치. 원천 staging.int_label, raw.eval_batches')
AS
WITH b AS (
  SELECT
    batch_id, requester, purpose, guideline_version, priority, target_tasks,
    DATE(created_at, 'Asia/Seoul') AS created_date,
    DATE(due_at, 'Asia/Seoul') AS due_date
  FROM raw.eval_batches
),
done AS (
  SELECT batch_id, kst_date, COUNT(*) AS n
  FROM staging.int_label
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND completes_task
  GROUP BY 1, 2
),
last_day AS (
  SELECT MAX(kst_date) AS d
  FROM staging.int_label
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
spine AS (
  SELECT b.*, w AS week_start, LEAST(DATE_ADD(w, INTERVAL 6 DAY), ld.d) AS as_of_date
  FROM b
  CROSS JOIN last_day AS ld
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(DATE_TRUNC(b.created_date, WEEK(MONDAY)), ld.d, INTERVAL 1 WEEK)) AS w
),
acc AS (
  SELECT
    s.week_start, s.batch_id, s.requester, s.purpose, s.guideline_version, s.priority, s.created_date, s.due_date,
    s.as_of_date, s.target_tasks,
    COALESCE(SUM(IF(d.kst_date <= s.as_of_date, d.n, 0)), 0) AS done_tasks,
    COALESCE(SUM(IF(d.kst_date BETWEEN s.week_start AND s.as_of_date, d.n, 0)), 0) AS done_in_week,
    COALESCE(SUM(IF(d.kst_date BETWEEN DATE_SUB(s.as_of_date, INTERVAL 13 DAY) AND s.as_of_date, d.n, 0)), 0)
      AS recent_done_14d,
    COALESCE(SUM(IF(d.kst_date < s.week_start, d.n, 0)), 0) AS done_before
  FROM spine AS s
  LEFT JOIN done AS d ON d.batch_id = s.batch_id
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
)
SELECT
  week_start, batch_id, requester, purpose, guideline_version, priority, created_date, due_date, as_of_date,
  target_tasks, done_tasks, done_in_week, target_tasks - done_tasks AS remaining_tasks, recent_done_14d,
  DATE_DIFF(due_date, as_of_date, DAY) AS days_to_due
FROM acc
WHERE done_before < target_tasks;
