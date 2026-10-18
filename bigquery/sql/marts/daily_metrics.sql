-- 표: marts.daily_metrics — 일 지표 마트
-- 1행: 일(KST) × channel1 × device_platform × member_seg
-- 키: 이 네 열
-- 파티션·클러스터: kst_date / channel1, device_platform, member_seg
-- 원천: staging.int_person_day
-- 소비: 개요·퍼널·행사·결제(흐름 보기)·회원(회원·구독 보기) 탭 스코어보드와 추이. 세그먼트 조합의 합 = 전체. ops.reconciliation
-- 검사: C3·R4
--
-- 사람 열은 그날 고유 사람 수다. 여러 날을 더하면 '사람·일'이 된다(기간 고유 사람은 weekly_activity·monthly_summary).
-- 세션 열은 자동 로드를 뺀 방문 세션이다. 자동 로드는 auto_load_sessions 로 따로 둔다.
-- 건수·금액(applies·pay_count·pay_amount·cancels)은 로그 이벤트 기준이며 원장과의 일치는 검사 C1·C2 가 확인한다.
-- 비율은 저장하지 않는다. 분자·분모 열을 화면에서 나눈다.
-- subscribers = 그날 활성 구독 회원 중 방문 사람(구독 원장 상태). sub_payers = 구독 결제 완료 이벤트 사람(로그, 신규·재구독 결제).
-- 기간 구독자 수·구독 매출은 이 마트가 아니라 daily_subscription·daily_revenue 에서 센다.

CREATE OR REPLACE TABLE marts.daily_metrics (
  kst_date DATE OPTIONS(description='날짜 (KST). 일 파티션'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  persons INT64 OPTIONS(description='방문 사람 수'),
  new_persons INT64 OPTIONS(description='첫 방문 사람 수'),
  sessions INT64 OPTIONS(description='방문 세션 수 (자동 로드 제외)'),
  engaged_sessions INT64 OPTIONS(description='활성 세션 수 (engaged, 자동 로드 제외)'),
  explorers INT64 OPTIONS(description='탐색 화면(지도·검색) 조회 사람 수'),
  detail_viewers INT64 OPTIONS(description='행사 상세 조회 사람 수'),
  signups INT64 OPTIONS(description='가입 사람 수'),
  apply_viewers INT64 OPTIONS(description='신청 화면 조회 사람 수'),
  applies INT64 OPTIONS(description='신청 건수 (로그)'),
  payers INT64 OPTIONS(description='결제 사람 수'),
  pay_count INT64 OPTIONS(description='결제 건수 (로그)'),
  pay_amount INT64 OPTIONS(description='결제 금액 (원, 로그)'),
  cancels INT64 OPTIONS(description='취소 건수 (로그, 취소일 기준)'),
  appliers INT64 OPTIONS(description='신청 사람 수'),
  any_detail_viewers INT64 OPTIONS(description='공간 또는 행사 상세 조회 사람 수'),
  searchers INT64 OPTIONS(description='검색 사람 수'),
  multi_session_persons INT64 OPTIONS(description='방문 세션 2개 이상인 사람 수'),
  auto_load_sessions INT64 OPTIONS(description='자동 로드 세션 수'),
  engagement_msec INT64 OPTIONS(description='체류 합 (ms, 자동 로드 제외)'),
  subscribers INT64 OPTIONS(description='그날 활성 구독 회원 중 방문 사람 수'),
  sub_payers INT64 OPTIONS(description='구독 결제 완료 이벤트 사람 수 (로그)')
)
PARTITION BY kst_date
CLUSTER BY channel1, device_platform, member_seg
OPTIONS(description='일 지표 마트. 1행 = 일 × channel1 × device_platform × member_seg. 원천 staging.int_person_day')
AS
SELECT
  kst_date,
  channel1,
  device_platform,
  member_seg,
  COUNTIF(is_visit) AS persons,
  COUNTIF(is_visit AND is_first_visit_day) AS new_persons,
  SUM(valid_sessions) AS sessions,
  SUM(active_sessions) AS engaged_sessions,
  COUNTIF(did_explore) AS explorers,
  COUNTIF(did_view_event_detail) AS detail_viewers,
  COUNTIF(did_sign_up) AS signups,
  COUNTIF(did_view_apply) AS apply_viewers,
  SUM(applications) AS applies,
  COUNTIF(did_pay) AS payers,
  SUM(purchases) AS pay_count,
  SUM(purchase_amount) AS pay_amount,
  SUM(cancels) AS cancels,
  COUNTIF(did_apply) AS appliers,
  COUNTIF(did_view_detail) AS any_detail_viewers,
  COUNTIF(did_search) AS searchers,
  COUNTIF(is_multi_session) AS multi_session_persons,
  SUM(auto_load_sessions) AS auto_load_sessions,
  SUM(engagement_msec) AS engagement_msec,
  COUNTIF(is_visit AND subscribed) AS subscribers,
  COUNTIF(sub_paid) AS sub_payers
FROM staging.int_person_day
WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
GROUP BY kst_date, channel1, device_platform, member_seg;
