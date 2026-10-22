-- 표: marts.exp_ranker_request — 랭킹 A/B 실험 요청 단위 마트
-- 1행: 서버 검색 요청 1건 (세션 시작일 2026-06-22 ~ 07-26)
-- 키: request_id
-- 파티션·클러스터: kst_date / arm
-- 원천: staging.int_search
-- 소비: 보고서 실험 설계서(6/22~7/5 기준선)·진행 점검(6/29~7/12 실험 전 비교, 7/13~7/19 배정 점검)·결과 보고(7/13~7/26). ops.reconciliation
-- 검사: I9
--
-- 배정(arm)은 실험과 같은 규칙(기기 ID MD5 앞 8자리 정수 mod 2, 1 = treatment)을 실험 전 기간 요청에도 붙인다.
-- 실험 전 기간은 두 집단 모두 v1 을 받았으므로 집단 차이가 없어야 한다(A/A 비교). 기기 단위 클러스터 분석을 위해
-- 요청마다 client_id 를 둔다. 세션 단위 열(session_applied)은 세션의 첫 검색 행에만 있다.

CREATE OR REPLACE TABLE marts.exp_ranker_request (
  kst_date DATE OPTIONS(description='날짜 (KST, 세션 시작일). 일 파티션'),
  request_id STRING OPTIONS(description='서버 검색 요청 ID'),
  client_id STRING OPTIONS(description='기기 식별자 (무작위 배정 단위)'),
  person_id STRING OPTIONS(description='사람 식별자 (기기 2대 이상인 사람이 두 집단을 함께 보는지 확인용)'),
  arm STRING OPTIONS(description='배정 집단 control / treatment (기기 해시, 실험 전 기간에도 같은 규칙)'),
  ranker_version STRING OPTIONS(description='실제로 받은 랭킹 버전 v1 / v2'),
  query_intent STRING OPTIONS(description='의도 유형 genre / region / event_type / venue_name / other'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  is_zero_result BOOL OPTIONS(description='결과 0건'),
  is_clicked BOOL OPTIONS(description='결과 클릭'),
  first_click_position INT64 OPTIONS(description='첫 클릭 순위 1~10. 클릭 없으면 NULL'),
  is_reformulated BOOL OPTIONS(description='결과를 누르지 않고 같은 세션에서 다시 검색'),
  latency_ms INT64 OPTIONS(description='응답 시간 (ms)'),
  is_session_first BOOL OPTIONS(description='세션의 첫 검색 요청'),
  session_applied BOOL OPTIONS(description='세션 대표 행에서만: 같은 세션에서 행사 신청')
)
PARTITION BY kst_date
CLUSTER BY arm
OPTIONS(description='랭킹 A/B 실험 요청 단위 마트. 1행 = 검색 요청 1건, 세션 시작일 2026-06-22~07-26. 배정 규칙(기기 해시)을 실험 전 기간에도 붙여 A/A 비교와 기기 단위 클러스터 분석에 쓴다. 원천 staging.int_search')
AS
SELECT
  kst_date,
  request_id,
  client_id,
  person_id,
  IF(MOD(CAST(CONCAT('0x', SUBSTR(TO_HEX(MD5(client_id)), 1, 8)) AS INT64), 2) = 1, 'treatment', 'control') AS arm,
  ranker_version,
  query_intent,
  channel1,
  device_platform,
  member_seg,
  is_zero_result,
  is_clicked,
  first_click_position,
  is_reformulated,
  latency_ms,
  is_session_first,
  session_applied
FROM staging.int_search
WHERE kst_date BETWEEN DATE '2026-06-22' AND DATE '2026-07-26';
