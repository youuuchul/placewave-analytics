-- 표: marts.funnel_daily — 일 방문 퍼널 마트
-- 1행: 일(KST) × 단계 × channel1 × device_platform × member_seg
-- 키: 이 다섯 열
-- 파티션·클러스터: kst_date / step_order, channel1, device_platform, member_seg
-- 원천: staging.int_person_day
-- 소비: 퍼널 탭 방문 퍼널 5단계(사람 단위 person_day 가 없을 때 폴백). 막대 = 첫 단계 대비
--
-- 단계는 누적 조건이다(각 단계가 앞 단계 조건을 모두 포함). 같은 날 안에서 판정한다.
--   landing     방문 (자동 로드 아닌 세션)
--   detail      + 행사 상세 조회
--   signup      + 로그인 상태 (회원 ID 가 실린 방문 세션, 그날 가입 포함)
--   apply_view  + 신청 화면 조회
--   payment     + 결제

CREATE OR REPLACE TABLE marts.funnel_daily (
  kst_date DATE OPTIONS(description='날짜 (KST). 일 파티션'),
  step STRING OPTIONS(description='단계 landing / detail / signup / apply_view / payment'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  persons INT64 OPTIONS(description='그날 그 단계까지 도달한 사람 수'),
  step_order INT64 OPTIONS(description='단계 순서 1~5')
)
PARTITION BY kst_date
CLUSTER BY step_order, channel1, device_platform, member_seg
OPTIONS(description='일 방문 퍼널 마트. 1행 = 일 × 단계 × 세그먼트. 원천 staging.int_person_day. 단계 누적 조건, 같은 날 기준')
AS
WITH pd AS (
  SELECT
    kst_date, channel1, device_platform, member_seg,
    is_visit AS s1,
    is_visit AND did_view_event_detail AS s2,
    is_visit AND did_view_event_detail AND is_logged_in AS s3,
    is_visit AND did_view_event_detail AND is_logged_in AND did_view_apply AS s4,
    is_visit AND did_view_event_detail AND is_logged_in AND did_view_apply AND did_pay AS s5
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
steps AS (
  SELECT * FROM UNNEST([
    STRUCT(1 AS step_order, 'landing' AS step),
    (2, 'detail'), (3, 'signup'), (4, 'apply_view'), (5, 'payment')
  ])
)
SELECT
  pd.kst_date,
  st.step,
  pd.channel1,
  pd.device_platform,
  pd.member_seg,
  COUNTIF(CASE st.step_order
    WHEN 1 THEN pd.s1
    WHEN 2 THEN pd.s2
    WHEN 3 THEN pd.s3
    WHEN 4 THEN pd.s4
    WHEN 5 THEN pd.s5
  END) AS persons,
  st.step_order
FROM pd
CROSS JOIN steps AS st
GROUP BY pd.kst_date, st.step, pd.channel1, pd.device_platform, pd.member_seg, st.step_order;
