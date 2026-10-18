-- 표: marts.weekly_activity — 주간 활동 마트
-- 1행: 주(월요일 시작) × channel1 × device_platform × member_seg
-- 키: 이 네 열
-- 파티션·클러스터: week_start / channel1, device_platform, member_seg
-- 원천: staging.int_person_day, staging.dim_member (가입일)
-- 소비: 주간·월간 탭 주간 보기 — WAU·신규·재방문·주 2일+ 방문. 기간 필터 대신 주차 선택기로 본다. ops.reconciliation (C6·C7 기준값)
--
-- member_seg = 주 시작일 0시 기준 회원 여부 member / guest (그 주 가입자는 guest). 주 안에서 사람마다 고정.

CREATE OR REPLACE TABLE marts.weekly_activity (
  week_start DATE OPTIONS(description='주 시작일 (월요일). 파티션'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 주 시작 기준 member / guest'),
  wau INT64 OPTIONS(description='주간 방문 사람 수'),
  new_persons INT64 OPTIONS(description='그 주 첫 방문 사람 수'),
  returning_persons INT64 OPTIONS(description='그 주 이전에 첫 방문한 방문 사람 수'),
  two_plus_days INT64 OPTIONS(description='그 주 2일 이상 방문한 사람 수'),
  signups INT64 OPTIONS(description='그 주 가입 사람 수'),
  appliers INT64 OPTIONS(description='그 주 신청 사람 수'),
  payers INT64 OPTIONS(description='그 주 결제 사람 수'),
  valid_sessions INT64 OPTIONS(description='자동 로드 아닌 세션 수'),
  observed_days INT64 OPTIONS(description='그 주 관측 일수 (7 미만이면 미완성 주)')
)
PARTITION BY week_start
CLUSTER BY channel1, device_platform, member_seg
OPTIONS(description='주간 활동 마트. 1행 = 주 × channel1 × device_platform × member_seg. 원천 staging.int_person_day·dim_member')
AS
WITH pd AS (
  SELECT *, DATE_TRUNC(kst_date, WEEK(MONDAY)) AS week_start
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
obs AS (
  SELECT week_start, COUNT(DISTINCT kst_date) AS observed_days
  FROM pd
  GROUP BY week_start
),
pw AS (
  SELECT
    pd.week_start,
    pd.person_id,
    ANY_VALUE(pd.channel1) AS channel1,
    ANY_VALUE(pd.device_platform) AS device_platform,
    IF(ANY_VALUE(m.signup_date) < pd.week_start, 'member', 'guest') AS member_seg,
    LOGICAL_OR(is_visit) AS visited,
    LOGICAL_OR(is_visit AND is_first_visit_day) AS is_new,
    COUNT(DISTINCT IF(is_visit, kst_date, NULL)) AS visit_days,
    LOGICAL_OR(did_sign_up) AS signed_up,
    LOGICAL_OR(did_apply) AS applied,
    LOGICAL_OR(did_pay) AS paid,
    SUM(valid_sessions) AS valid_sessions
  FROM pd
  LEFT JOIN staging.dim_member AS m ON m.member_id = pd.person_id
  GROUP BY pd.week_start, pd.person_id
)
SELECT
  pw.week_start,
  pw.channel1,
  pw.device_platform,
  pw.member_seg,
  COUNTIF(pw.visited) AS wau,
  COUNTIF(pw.is_new) AS new_persons,
  COUNTIF(pw.visited AND NOT pw.is_new) AS returning_persons,
  COUNTIF(pw.visit_days >= 2) AS two_plus_days,
  COUNTIF(pw.signed_up) AS signups,
  COUNTIF(pw.applied) AS appliers,
  COUNTIF(pw.paid) AS payers,
  SUM(pw.valid_sessions) AS valid_sessions,
  ANY_VALUE(o.observed_days) AS observed_days
FROM pw
JOIN obs AS o USING (week_start)
GROUP BY 1, 2, 3, 4;
