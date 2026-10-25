-- 표: marts.daily_revenue — 플랫폼 매출 종류별 일 마트
-- 1행: 일(KST) × 매출 종류 × 수수료 등급(티켓만)
-- 키: (kst_date, kind, fee_tier)
-- 파티션·클러스터: kst_date / kind
-- 원천: staging.fct_order (티켓·구독 결제, 결제일 기준), staging.int_contract_day (파트너 플랜 활성일·요금)
-- 소비: 개요 플랫폼 매출 타일·매출 구성 추이, 행사·결제 탭 매출 구성, 공간 탭 파트너 부담률. marts.monthly_summary,
--       ops.reconciliation
-- 검사: C9·C14
--
-- kind
--   ticket        행사 티켓 결제. fee_tier = 개최일 공간 요금제(none/basic/pro) 행으로 나뉜다
--   membership    소비자 멤버십(구독) 결제. fee_tier NULL
--   partner_plan  파트너 플랜 월 이용료를 일할: 활성일마다 그날 monthly_fee ÷ 그 달 일수(요금제 변경 반영). fee_tier NULL
--                 한 달 내내 같은 요금으로 활성인 계약은 그 달 합이 monthly_fee 와 같다(일별 합 반올림으로 몇 원 차이 가능)
-- net_amount = 플랫폼 매출. ticket → 수수료(정가 × 율, 환불 주문 0), membership → 실결제액(환불 제외), partner_plan → 일할 요금.
--   Σ net_amount(전 kind) = 플랫폼 매출. 티켓 결제액(paid_amount)과 거래액(gmv_amount)은 규모 지표이고 매출이 아니다.
-- 티켓 금액(결제일 행, 환불 주문 제외): gmv_amount = 정가 합, discount_amount = 멤버 할인 합(플랫폼 부담),
--   paid_amount = 실결제 합 = gmv_amount - discount_amount. 환불 주문은 refund_count·refund_amount 로만 센다.
--   pay_count = 결제 건수(환불 포함). 환불 제외 건수 = pay_count - refund_count
-- membership: pay_count = 결제 건수(환불 포함), paid_amount = 환불 제외 실결제, gmv_amount NULL, discount_amount 0
-- partner_plan: pay_count = 그날 활성 계약 수, paid_amount = net_amount = 일할 요금, 할인·환불 0, payers = 고유 공간 수
-- payers = 고유 결제 회원 수(환불 포함, partner_plan 은 공간 수). 사람 세그먼트 축이 없다. 매출 비교는 기간 합으로 한다.

CREATE OR REPLACE TABLE marts.daily_revenue (
  kst_date DATE OPTIONS(description='날짜 (KST, 결제일·계약 활성일). 일 파티션'),
  kind STRING OPTIONS(description='매출 종류 ticket / membership / partner_plan'),
  fee_tier STRING OPTIONS(description='수수료 등급 none / basic / pro (ticket 만, 나머지 NULL)'),
  pay_count INT64 OPTIONS(description='결제 건수, 환불 포함 (partner_plan = 활성 계약 수)'),
  gmv_amount INT64 OPTIONS(description='거래액 = 티켓 정가 합, 환불 주문 제외 (원, ticket 만)'),
  paid_amount INT64 OPTIONS(description='실결제 합, 환불 주문 제외 (원, partner_plan = 일할 요금)'),
  discount_amount INT64 OPTIONS(description='멤버 할인 합, 환불 주문 제외 (원)'),
  refund_count INT64 OPTIONS(description='환불 건수 (결제일 기준)'),
  refund_amount INT64 OPTIONS(description='환불액 합 (원, 결제일 기준)'),
  net_amount INT64 OPTIONS(description='플랫폼 매출 (원): ticket 수수료, membership 실결제, partner_plan 일할 요금'),
  payers INT64 OPTIONS(description='고유 결제 회원 수 (partner_plan = 고유 공간 수)')
)
PARTITION BY kst_date
CLUSTER BY kind
OPTIONS(description='플랫폼 매출 종류별 일 마트. 1행 = 일 × kind(ticket/membership/partner_plan) × fee_tier. 원천 staging.fct_order·int_contract_day. net_amount 합 = 플랫폼 매출')
AS
WITH paid AS (
  SELECT
    paid_date AS kst_date,
    IF(kind = 'ticket', 'ticket', 'membership') AS kind,
    IF(kind = 'ticket', fee_tier, NULL) AS fee_tier,
    member_id,
    refund_amount > 0 AS is_refunded,
    list_amount,
    paid_amount,
    discount_amount,
    refund_amount,
    fee_amount
  FROM staging.fct_order
  WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND is_paid
)
SELECT
  kst_date,
  kind,
  fee_tier,
  COUNT(*) AS pay_count,
  IF(kind = 'ticket', SUM(IF(is_refunded, 0, list_amount)), NULL) AS gmv_amount,
  SUM(IF(is_refunded, 0, paid_amount)) AS paid_amount,
  SUM(IF(is_refunded, 0, discount_amount)) AS discount_amount,
  COUNTIF(is_refunded) AS refund_count,
  SUM(refund_amount) AS refund_amount,
  IF(kind = 'ticket', SUM(fee_amount), SUM(IF(is_refunded, 0, paid_amount))) AS net_amount,
  COUNT(DISTINCT member_id) AS payers
FROM paid
GROUP BY kst_date, kind, fee_tier
UNION ALL
SELECT
  kst_date,
  'partner_plan' AS kind,
  CAST(NULL AS STRING) AS fee_tier,
  COUNT(*) AS pay_count,
  CAST(NULL AS INT64) AS gmv_amount,
  CAST(ROUND(SUM(day_fee)) AS INT64) AS paid_amount,
  0 AS discount_amount,
  0 AS refund_count,
  0 AS refund_amount,
  CAST(ROUND(SUM(day_fee)) AS INT64) AS net_amount,
  COUNT(DISTINCT venue_id) AS payers
FROM staging.int_contract_day
WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
GROUP BY kst_date;
