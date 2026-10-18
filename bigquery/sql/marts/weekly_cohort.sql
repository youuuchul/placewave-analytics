-- 표: marts.weekly_cohort — 주간 리텐션 코호트
-- 1행: 코호트 주 × 경과 주 × channel1 × device_platform × member_seg
-- 키: 이 다섯 열
-- 파티션·클러스터: cohort_week / week_offset, channel1, device_platform, member_seg
-- 원천: staging.int_person_day (방문·첫 방문), staging.dim_member (가입일)
-- 소비: 회원 탭 리텐션 곡선, 주간·월간 탭 주간 보기 코호트 히트맵 W1~W12. 리텐션 = retained / cohort_size (화면에서 나눈다).
--       marts.monthly_summary (W1), ops.reconciliation
-- 검사: C4·R1·R2
--
-- 코호트 주 = 첫 방문일이 속한 주(월요일 시작). 경과 주 N 에 방문(자동 로드 제외)이 1일 이상 있으면 retained.
-- cohort_size 는 경과 주와 무관하게 같은 값을 반복한다. week_offset = 0 행은 retained = cohort_size. 경과 주는 0~12.
-- member_seg = 코호트 주 말일(일요일) 기준 회원 여부 member / guest. 코호트 안에서 사람마다 고정.
-- 관측 가능한 모든 (코호트, 경과 주) 칸을 0 포함으로 채운다. 관측 끝 주가 7일 미만이면 is_complete_week = FALSE.

CREATE OR REPLACE TABLE marts.weekly_cohort (
  cohort_week DATE OPTIONS(description='코호트 주 (첫 방문 주의 월요일). 파티션'),
  week_offset INT64 OPTIONS(description='경과 주 0~12 (0 = 첫 방문 주)'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 코호트 주 말일 기준 member / guest'),
  cohort_size INT64 OPTIONS(description='코호트 사람 수 (분모)'),
  retained INT64 OPTIONS(description='그 주에 방문한 코호트 사람 수 (분자). 0주차 = cohort_size'),
  activity_week DATE OPTIONS(description='활동 주의 월요일'),
  is_complete_week BOOL OPTIONS(description='활동 주 7일이 모두 관측됐는가')
)
PARTITION BY cohort_week
CLUSTER BY week_offset, channel1, device_platform, member_seg
OPTIONS(description='주간 리텐션 코호트. 1행 = 코호트 주 × 경과 주 × 세그먼트. 원천 staging.int_person_day·dim_member')
AS
WITH pd AS (
  SELECT person_id, kst_date, is_visit, is_first_visit_day, channel1, device_platform
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
bounds AS (
  SELECT MAX(kst_date) AS last_date, DATE_TRUNC(MAX(kst_date), WEEK(MONDAY)) AS last_week
  FROM pd
),
cohort AS (
  SELECT
    pd.person_id,
    DATE_TRUNC(pd.kst_date, WEEK(MONDAY)) AS cohort_week,
    pd.channel1,
    pd.device_platform,
    IF(m.signup_date <= DATE_ADD(DATE_TRUNC(pd.kst_date, WEEK(MONDAY)), INTERVAL 6 DAY), 'member', 'guest') AS member_seg
  FROM pd
  LEFT JOIN staging.dim_member AS m ON m.member_id = pd.person_id
  WHERE pd.is_visit AND pd.is_first_visit_day
),
activity AS (
  SELECT DISTINCT person_id, DATE_TRUNC(kst_date, WEEK(MONDAY)) AS activity_week
  FROM pd
  WHERE is_visit
),
sizes AS (
  SELECT cohort_week, channel1, device_platform, member_seg, COUNT(*) AS cohort_size
  FROM cohort
  GROUP BY 1, 2, 3, 4
),
grid AS (
  SELECT
    z.cohort_week, z.channel1, z.device_platform, z.member_seg, z.cohort_size,
    w AS activity_week,
    DATE_DIFF(w, z.cohort_week, WEEK(MONDAY)) AS week_offset
  FROM sizes AS z
  CROSS JOIN bounds AS b
  CROSS JOIN UNNEST(GENERATE_DATE_ARRAY(z.cohort_week, LEAST(b.last_week, DATE_ADD(z.cohort_week, INTERVAL 12 WEEK)), INTERVAL 1 WEEK)) AS w
),
ret AS (
  SELECT c.cohort_week, c.channel1, c.device_platform, c.member_seg, a.activity_week, COUNT(*) AS retained
  FROM cohort AS c
  JOIN activity AS a ON a.person_id = c.person_id AND a.activity_week >= c.cohort_week
  GROUP BY 1, 2, 3, 4, 5
)
SELECT
  g.cohort_week,
  g.week_offset,
  g.channel1,
  g.device_platform,
  g.member_seg,
  g.cohort_size,
  COALESCE(r.retained, 0) AS retained,
  g.activity_week,
  DATE_ADD(g.activity_week, INTERVAL 6 DAY) <= b.last_date AS is_complete_week
FROM grid AS g
CROSS JOIN bounds AS b
LEFT JOIN ret AS r
  USING (cohort_week, channel1, device_platform, member_seg, activity_week);
