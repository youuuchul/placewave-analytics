-- 대시보드 화면 값 vs BigQuery 재집계 대조 (docs/reconciliation_dashboard.md). SELECT 만, 개인 프로젝트에서 scripts/bq.sh query 로 실행
-- 마트를 거치지 않고 정제층(staging)·원천(raw)에서 직접 센다. 1행 = (항목, 지표, 값). 기준일 2026-09-20, 28일 = 08-24~09-20, 90일 = 06-23~09-20, 1년 = 2025-09-22~2026-09-20

-- ① 개요·퍼널·회원·구독·공간·행사·매출 구성
WITH
pd28 AS (SELECT * FROM staging.int_person_day WHERE kst_date BETWEEN '2026-08-24' AND '2026-09-20'),
pd1y AS (SELECT * FROM staging.int_person_day WHERE kst_date BETWEEN '2025-09-22' AND '2026-09-20'),
pd90 AS (SELECT * FROM staging.int_person_day WHERE kst_date BETWEEN '2026-06-23' AND '2026-09-20'),
last28 AS (
  SELECT person_id, ARRAY_AGG(member_seg ORDER BY kst_date DESC LIMIT 1)[OFFSET(0)] AS seg
  FROM pd28 WHERE is_visit GROUP BY 1
),
fee AS (
  SELECT
    SUM(IF(paid_date BETWEEN '2026-08-24' AND '2026-09-20', fee_amount, 0)) AS fee28,
    SUM(IF(paid_date BETWEEN '2025-09-22' AND '2026-09-20', fee_amount, 0)) AS fee1y
  FROM staging.fct_order WHERE kind = 'ticket'
),
subr AS (
  SELECT
    SUM(IF(paid_date BETWEEN '2026-08-24' AND '2026-09-20', paid_amount, 0)) AS sub28,
    SUM(IF(paid_date BETWEEN '2025-09-22' AND '2026-09-20', paid_amount, 0)) AS sub1y
  FROM staging.fct_order WHERE kind = 'subscription' AND payment_status = 'paid'
),
plan AS (
  SELECT
    ROUND(SUM(IF(kst_date BETWEEN '2026-08-24' AND '2026-09-20', day_fee, 0))) AS plan28,
    ROUND(SUM(IF(kst_date BETWEEN '2025-09-22' AND '2026-09-20', day_fee, 0))) AS plan1y,
    COUNT(DISTINCT IF(kst_date = '2026-09-20', venue_id, NULL)) AS partners_end,
    SUM(IF(kst_date = '2026-09-20', monthly_fee, 0)) AS plan_mrr_end
  FROM staging.int_contract_day
),
tk AS (
  SELECT
    paid_date, fee_tier, list_amount, fee_amount, discount_amount, paid_amount, payment_status
  FROM staging.fct_order WHERE kind = 'ticket' AND is_paid
),
tk28 AS (SELECT * FROM tk WHERE paid_date BETWEEN '2026-08-24' AND '2026-09-20'),
tk1y AS (SELECT * FROM tk WHERE paid_date BETWEEN '2025-09-22' AND '2026-09-20'),
sub_end AS (
  SELECT COUNT(DISTINCT member_id) AS active, SUM(price) AS mrr
  FROM staging.dim_subscription WHERE start_date <= '2026-09-20' AND (end_date IS NULL OR end_date > '2026-09-20')
),
sub_days AS (
  SELECT SUM(n) AS active_days FROM (
    SELECT d, COUNT(DISTINCT member_id) AS n
    FROM staging.dim_subscription, UNNEST(GENERATE_DATE_ARRAY('2026-08-24', '2026-09-20')) AS d
    WHERE start_date <= d AND (end_date IS NULL OR end_date > d) GROUP BY d)
),
sub_flow AS (
  SELECT COUNTIF(start_date BETWEEN '2026-08-24' AND '2026-09-20') AS new_s, COUNTIF(end_date BETWEEN '2026-08-24' AND '2026-09-20') AS churn_s
  FROM staging.dim_subscription
)
SELECT '01 개요 28' AS item, '결제' AS k, CAST(SUM(purchases) AS FLOAT64) AS v FROM pd28
UNION ALL SELECT '01 개요 28', '방문자', COUNT(DISTINCT IF(is_visit, person_id, NULL)) FROM pd28
UNION ALL SELECT '01 개요 28', '가입', COUNTIF(did_sign_up) FROM pd28
UNION ALL SELECT '01 개요 28', '활성 구독자', active FROM sub_end
UNION ALL SELECT '01 개요 28', '파트너 공간', partners_end FROM plan
UNION ALL SELECT '01 개요 28', '파트너 거래액 비중', SUM(IF(fee_tier IN ('basic', 'pro'), list_amount, 0)) / SUM(list_amount) FROM tk28 WHERE payment_status = 'paid'
UNION ALL SELECT '01 개요 28', '플랫폼 매출', fee28 + sub28 + plan28 FROM fee, subr, plan
UNION ALL SELECT '02 개요 1년', '결제', SUM(purchases) FROM pd1y
UNION ALL SELECT '02 개요 1년', '방문자', COUNT(DISTINCT IF(is_visit, person_id, NULL)) FROM pd1y
UNION ALL SELECT '02 개요 1년', '가입', COUNTIF(did_sign_up) FROM pd1y
UNION ALL SELECT '02 개요 1년', '플랫폼 매출', fee1y + sub1y + plan1y FROM fee, subr, plan
UNION ALL SELECT '02 개요 1년', '거래액', SUM(list_amount) FROM tk1y WHERE payment_status = 'paid'
UNION ALL SELECT '02 개요 1년', '객단가', SUM(list_amount) / COUNT(*) FROM tk1y WHERE payment_status = 'paid'
UNION ALL SELECT '02 개요 1년', '파트너 거래액 비중', SUM(IF(fee_tier IN ('basic', 'pro'), list_amount, 0)) / SUM(list_amount) FROM tk1y WHERE payment_status = 'paid'
UNION ALL SELECT '03 개요 28 회원', '방문자', COUNTIF(seg = 'member') FROM last28
UNION ALL SELECT '03 개요 28 회원', '결제', SUM(IF(member_seg = 'member', purchases, 0)) FROM pd28
UNION ALL SELECT '03 개요 28 회원', '가입', COUNTIF(member_seg = 'member' AND did_sign_up) FROM pd28
UNION ALL SELECT '04 개요 90 iOS', '방문자', COUNT(DISTINCT IF(is_visit AND device_platform = 'ios', person_id, NULL)) FROM pd90
UNION ALL SELECT '04 개요 90 iOS', '결제', SUM(IF(device_platform = 'ios', purchases, 0)) FROM pd90
UNION ALL SELECT '04 개요 90 iOS', '가입', COUNTIF(device_platform = 'ios' AND did_sign_up) FROM pd90
UNION ALL SELECT '05 퍼널 28', '결제 도달', COUNT(DISTINCT IF(is_visit AND did_view_event_detail AND is_logged_in AND did_view_apply AND did_pay, person_id, NULL)) FROM pd28
UNION ALL SELECT '05 퍼널 28', '전체 전환율', COUNT(DISTINCT IF(is_visit AND did_view_event_detail AND is_logged_in AND did_view_apply AND did_pay, person_id, NULL)) / COUNT(DISTINCT IF(is_visit, person_id, NULL)) FROM pd28
UNION ALL SELECT '05 퍼널 28', '탐색 도달률', COUNT(DISTINCT IF(is_visit AND did_explore, person_id, NULL)) / COUNT(DISTINCT IF(is_visit, person_id, NULL)) FROM pd28
UNION ALL SELECT '06 회원 28', '신규 방문자 대비 가입', COUNTIF(did_sign_up) / COUNTIF(is_visit AND is_first_visit_day) FROM pd28
UNION ALL SELECT '06 회원 28', '회원 방문자', COUNTIF(seg = 'member') FROM last28
UNION ALL SELECT '06 회원 28', '방문자 중 회원 비중', COUNTIF(seg = 'member') / COUNT(*) FROM last28
UNION ALL SELECT '07 구독 28', '신규 구독', new_s FROM sub_flow
UNION ALL SELECT '07 구독 28', '구독 해지', churn_s FROM sub_flow
UNION ALL SELECT '07 구독 28', '구독 월 해지율', churn_s / (active_days / 30) FROM sub_flow, sub_days
UNION ALL SELECT '07 구독 28', '구독 MRR', mrr FROM sub_end
UNION ALL SELECT '07 구독 28', '회원 대비 구독 비중', active / (SELECT COUNT(*) FROM raw.db_members WHERE DATE(signed_up_at, 'Asia/Seoul') <= '2026-09-20') FROM sub_end
UNION ALL SELECT '07 구독 28', '멤버 할인 부담률', (SELECT SUM(discount_amount) FROM tk28 WHERE payment_status = 'paid') / sub28 FROM subr
UNION ALL SELECT '08 공간', '등록 공간', COUNTIF(DATE(registered_at, 'Asia/Seoul') <= '2026-09-20') FROM raw.db_venues
UNION ALL SELECT '08 공간', '기간 신규', COUNTIF(DATE(registered_at, 'Asia/Seoul') BETWEEN '2026-08-24' AND '2026-09-20') FROM raw.db_venues
UNION ALL SELECT '08 공간', '신규 계약', COUNTIF(start_date BETWEEN '2026-08-24' AND '2026-09-20') FROM staging.dim_contract
UNION ALL SELECT '08 공간', '계약 해지', COUNTIF(end_date BETWEEN '2026-08-24' AND '2026-09-20') FROM staging.dim_contract
UNION ALL SELECT '08 공간', '파트너 플랜 MRR', plan_mrr_end FROM plan
UNION ALL SELECT '10 흐름 28', '신청', SUM(applications) FROM pd28
UNION ALL SELECT '10 흐름 28', '결제 금액', SUM(purchase_amount) FROM pd28
UNION ALL SELECT '10 흐름 28', '결제자', COUNT(DISTINCT IF(did_pay, person_id, NULL)) FROM pd28
UNION ALL SELECT '10 흐름 28', '결제자당 금액', SUM(purchase_amount) / COUNT(DISTINCT IF(did_pay, person_id, NULL)) FROM pd28
UNION ALL SELECT '10 흐름 28', '취소율', SUM(cancels) / SUM(applications) FROM pd28
UNION ALL SELECT '12 매출 1년', '결제(환불 제외)', COUNTIF(payment_status = 'paid') FROM tk1y
UNION ALL SELECT '12 매출 1년', '실효 수수료율', SUM(fee_amount) / SUM(IF(payment_status = 'paid', list_amount, 0)) FROM tk1y
UNION ALL SELECT '12 매출 1년', '수수료', SUM(fee_amount) FROM tk1y
UNION ALL SELECT '12 매출 1년', '환불률', COUNTIF(payment_status = 'refunded') / COUNT(*) FROM tk1y
UNION ALL SELECT '13 매출 28', '거래액', SUM(IF(payment_status = 'paid', list_amount, 0)) FROM tk28
UNION ALL SELECT '13 매출 28', '결제(환불 제외)', COUNTIF(payment_status = 'paid') FROM tk28
UNION ALL SELECT '13 매출 28', '실효 수수료율', SUM(fee_amount) / SUM(IF(payment_status = 'paid', list_amount, 0)) FROM tk28
UNION ALL SELECT '13 매출 28', '객단가', SUM(IF(payment_status = 'paid', list_amount, 0)) / COUNTIF(payment_status = 'paid') FROM tk28
UNION ALL SELECT '13 매출 28', '환불률', COUNTIF(payment_status = 'refunded') / COUNT(*) FROM tk28
ORDER BY 1, 2
;

-- ② 공간 계약 월 기준(2026-08)·유입·캠페인·주간(9/14 주)·월간(2026-08)
WITH
cd AS (SELECT * FROM staging.int_contract_day),
bom AS (SELECT COUNT(DISTINCT contract_id) AS n, SUM(monthly_fee) AS mrr FROM cd WHERE kst_date = '2026-07-31'),
eom AS (SELECT COUNT(DISTINCT contract_id) AS n, SUM(monthly_fee) AS mrr FROM cd WHERE kst_date = '2026-08-31'),
ended AS (SELECT contract_id, end_date FROM staging.dim_contract WHERE end_date BETWEEN '2026-08-01' AND '2026-08-31'),
churn_mrr AS (
  SELECT SUM(c.monthly_fee) AS v FROM ended e JOIN cd c ON c.contract_id = e.contract_id AND c.kst_date = DATE_SUB(e.end_date, INTERVAL 1 DAY)
),
chg AS (
  SELECT COUNTIF(direction = 'upgrade') AS up, COUNTIF(direction = 'downgrade') AS down,
    SUM(IF(direction = 'upgrade', to_fee - from_fee, 0)) AS exp, SUM(IF(direction = 'downgrade', from_fee - to_fee, 0)) AS con
  FROM staging.dim_contract_change WHERE change_date BETWEEN '2026-08-01' AND '2026-08-31'
),
aug AS (
  SELECT
    (SELECT ROUND(SUM(day_fee)) FROM cd WHERE kst_date BETWEEN '2026-08-01' AND '2026-08-31') AS plan,
    SUM(IF(fee_tier IN ('basic', 'pro'), fee_amount, 0)) AS pfee,
    SUM(IF(fee_tier IN ('basic', 'pro') AND payment_status = 'paid', list_amount, 0)) AS pgmv
  FROM staging.fct_order WHERE kind = 'ticket' AND is_paid AND paid_date BETWEEN '2026-08-01' AND '2026-08-31'
),
ss28 AS (SELECT * FROM staging.int_session WHERE session_date BETWEEN '2026-08-24' AND '2026-09-20' AND NOT is_auto_load),
camp AS (SELECT SUM(spend) AS spend, SUM(impressions) AS imp, SUM(clicks) AS clk FROM staging.ad_spend),
adss AS (SELECT * FROM staging.int_session WHERE session_date BETWEEN '2025-10-20' AND '2026-09-20' AND NOT is_auto_load AND session_channel1 = 'paid'),
wk AS (SELECT * FROM staging.int_person_day WHERE kst_date BETWEEN '2026-09-14' AND '2026-09-20' AND is_visit),
wkp AS (SELECT person_id, ANY_VALUE(first_visit_date) AS fv, COUNT(DISTINCT kst_date) AS days FROM wk GROUP BY 1),
coh AS (SELECT DISTINCT person_id FROM staging.int_person_day WHERE is_visit AND first_visit_date BETWEEN '2026-09-07' AND '2026-09-13'),
m8 AS (SELECT * FROM staging.int_person_day WHERE kst_date BETWEEN '2026-08-01' AND '2026-08-31' AND is_visit),
o8 AS (SELECT * FROM staging.fct_order WHERE kind = 'ticket' AND applied_date BETWEEN '2026-08-01' AND '2026-08-31'),
c8 AS (
  SELECT DATE_TRUNC(first_visit_date, WEEK(MONDAY)) AS w, person_id FROM staging.int_person_day
  WHERE is_visit AND DATE_TRUNC(first_visit_date, WEEK(MONDAY)) BETWEEN '2026-08-01' AND '2026-08-31' GROUP BY 1, 2
),
c8r AS (
  SELECT COUNT(*) AS n, COUNTIF(EXISTS(
    SELECT 1 FROM staging.int_person_day p WHERE p.person_id = c8.person_id AND p.is_visit AND p.kst_date BETWEEN DATE_ADD(c8.w, INTERVAL 7 DAY) AND DATE_ADD(c8.w, INTERVAL 13 DAY))) AS r
  FROM c8
)
SELECT '09 계약 2026-08' AS item, '계약 월 해지율' AS k, (SELECT COUNT(*) FROM ended) / bom.n AS v FROM bom
UNION ALL SELECT '09 계약 2026-08', '매출 해지율', ((SELECT v FROM churn_mrr) + chg.con) / bom.mrr FROM bom, chg
UNION ALL SELECT '09 계약 2026-08', 'ARPA', eom.mrr / eom.n FROM eom
UNION ALL SELECT '09 계약 2026-08', '월말 계약', eom.n FROM eom
UNION ALL SELECT '09 계약 2026-08', 'GRR', (bom.mrr - (SELECT v FROM churn_mrr) - chg.con) / bom.mrr FROM bom, chg
UNION ALL SELECT '09 계약 2026-08', 'NRR', (bom.mrr - (SELECT v FROM churn_mrr) - chg.con + chg.exp) / bom.mrr FROM bom, chg
UNION ALL SELECT '09 계약 2026-08', '업그레이드', up FROM chg
UNION ALL SELECT '09 계약 2026-08', '다운그레이드', down FROM chg
UNION ALL SELECT '09 계약 2026-08', '파트너 부담률', (plan + pfee) / pgmv FROM aug
UNION ALL SELECT '09 계약 2026-08', '파트너 거래액', pgmv FROM aug
UNION ALL SELECT '14 유입 28', '세션', COUNT(*) FROM ss28
UNION ALL SELECT '14 유입 28', '광고 세션 비중', COUNTIF(session_channel1 = 'paid') / COUNT(*) FROM ss28
UNION ALL SELECT '14 유입 28', '신규 방문자', COUNTIF(is_person_first_session) FROM ss28
UNION ALL SELECT '14 유입 28', '가입', SUM(sign_ups) FROM ss28
UNION ALL SELECT '14 유입 28', '결제 금액', SUM(purchase_amount) FROM ss28
UNION ALL SELECT '15 캠페인 전체', '지출', spend FROM camp
UNION ALL SELECT '15 캠페인 전체', '노출', imp FROM camp
UNION ALL SELECT '15 캠페인 전체', '클릭', clk FROM camp
UNION ALL SELECT '15 캠페인 전체', 'CTR', clk / imp FROM camp
UNION ALL SELECT '15 캠페인 전체', '세션', COUNT(*) FROM adss
UNION ALL SELECT '15 캠페인 전체', '신규 방문자', COUNTIF(is_person_first_session) FROM adss
UNION ALL SELECT '15 캠페인 전체', '가입', SUM(sign_ups) FROM adss
UNION ALL SELECT '15 캠페인 전체', 'CAC', (SELECT spend FROM camp) / SUM(sign_ups) FROM adss
UNION ALL SELECT '15 캠페인 전체', '신청', SUM(applications) FROM adss
UNION ALL SELECT '15 캠페인 전체', '결제 금액', SUM(purchase_amount) FROM adss
UNION ALL SELECT '15 캠페인 전체', 'ROAS', SUM(purchase_amount) / (SELECT spend FROM camp) FROM adss
UNION ALL SELECT '16 주간 9/14', 'WAU', COUNT(*) FROM wkp
UNION ALL SELECT '16 주간 9/14', '신규', COUNTIF(fv >= '2026-09-14') FROM wkp
UNION ALL SELECT '16 주간 9/14', '재방문', COUNTIF(fv < '2026-09-14') FROM wkp
UNION ALL SELECT '16 주간 9/14', '재방문 비중', COUNTIF(fv < '2026-09-14') / COUNT(*) FROM wkp
UNION ALL SELECT '16 주간 9/14', '주 2일+ 방문', COUNTIF(days >= 2) / COUNT(*) FROM wkp
UNION ALL SELECT '16 주간 9/14', '코호트(9/7)', COUNT(*) FROM coh
UNION ALL SELECT '16 주간 9/14', 'W1 리텐션', COUNTIF(person_id IN (SELECT person_id FROM wkp)) / COUNT(*) FROM coh
UNION ALL SELECT '17 월간 2026-08', '방문자', COUNT(DISTINCT person_id) FROM m8
UNION ALL SELECT '17 월간 2026-08', '신규', COUNT(DISTINCT IF(first_visit_date BETWEEN '2026-08-01' AND '2026-08-31', person_id, NULL)) FROM m8
UNION ALL SELECT '17 월간 2026-08', '가입', COUNTIF(DATE(signed_up_at, 'Asia/Seoul') BETWEEN '2026-08-01' AND '2026-08-31') FROM raw.db_members
UNION ALL SELECT '17 월간 2026-08', '결제 금액', SUM(IF(is_paid, paid_amount, 0)) FROM o8
UNION ALL SELECT '17 월간 2026-08', '신청', COUNT(*) FROM o8
UNION ALL SELECT '17 월간 2026-08', '신청분 취소율', COUNTIF(is_canceled) / COUNT(*) FROM o8
UNION ALL SELECT '17 월간 2026-08', 'W1 리텐션', r / n FROM c8r
ORDER BY 1, 2
;

-- ③ 검색(28일, 90일 iOS 회원)·실패 검색어 창(3/4~3/31, 9/1~9/7)·라벨링 주(9/14·9/7·7/6)·A/B 집단별·재색인 회귀 구간
WITH
s28 AS (SELECT * FROM staging.int_search WHERE kst_date BETWEEN '2026-08-24' AND '2026-09-20'),
s90 AS (SELECT * FROM staging.int_search WHERE kst_date BETWEEN '2026-06-23' AND '2026-09-20' AND device_platform = 'ios' AND member_seg = 'member'),
qwin AS (
  SELECT 'D1 3/4~3/31' AS w, query_norm, COUNT(*) AS n, COUNTIF(is_zero_result) AS z FROM staging.int_search
  WHERE kst_date BETWEEN '2026-03-04' AND '2026-03-31' GROUP BY 1, 2
  UNION ALL
  SELECT 'I1 9/1~9/7', query_norm, COUNT(*), COUNTIF(is_zero_result) FROM staging.int_search
  WHERE kst_date BETWEEN '2026-09-01' AND '2026-09-07' GROUP BY 1, 2
),
lab AS (
  SELECT week_start, COUNT(*) AS labels, COUNT(DISTINCT rater_id) AS raters, SUM(handle_seconds) / COUNT(*) AS sec,
    SUM(IF(is_gold AND NOT is_rework, IF(gold_correct, 1, 0), 0)) AS gold_ok, COUNTIF(is_gold AND NOT is_rework) AS gold,
    SUM(agree_with_prior) AS agree, SUM(pairs_with_prior) AS pairs, COUNTIF(is_rework) AS rework, COUNTIF(completes_task) AS done
  FROM staging.int_label WHERE week_start IN ('2026-09-14', '2026-09-07', '2026-07-06') GROUP BY 1
),
pe AS (
  SELECT week_start, SUM(POW(n / tot, 2)) AS pe FROM (
    SELECT week_start, grade, COUNT(*) AS n, SUM(COUNT(*)) OVER (PARTITION BY week_start) AS tot
    FROM staging.int_label WHERE is_final AND week_start IN ('2026-09-14', '2026-09-07', '2026-07-06') GROUP BY 1, 2) GROUP BY 1
),
ab AS (SELECT * FROM staging.int_search WHERE kst_date BETWEEN '2026-07-13' AND '2026-07-26'),
ph AS (
  SELECT CASE WHEN kst_date <= '2026-08-31' THEN '1 회귀 전' WHEN kst_date <= '2026-09-04' THEN '2 회귀 중' ELSE '3 핫픽스 후' END AS p, *
  FROM staging.int_search WHERE kst_date BETWEEN '2026-08-29' AND '2026-09-08'
)
SELECT 'S1 검색 28' AS item, '검색 이용자' AS k, CAST((SELECT COUNT(DISTINCT IF(did_search, person_id, NULL)) FROM staging.int_person_day WHERE kst_date BETWEEN '2026-08-24' AND '2026-09-20') AS FLOAT64) AS v
UNION ALL SELECT 'S1 검색 28', '검색 성공률', COUNTIF(is_clicked) / COUNT(*) FROM s28
UNION ALL SELECT 'S1 검색 28', '결과 클릭률', COUNTIF(is_clicked) / COUNTIF(NOT is_zero_result) FROM s28
UNION ALL SELECT 'S1 검색 28', '결과 0건 비율', COUNTIF(is_zero_result) / COUNT(*) FROM s28
UNION ALL SELECT 'S1 검색 28', '평균 첫 클릭 순위', AVG(first_click_position) FROM s28
UNION ALL SELECT 'S1 검색 28', '재검색률', COUNTIF(is_reformulated) / COUNT(*) FROM s28
UNION ALL SELECT 'S1 검색 28', '검색 세션 신청 전환', COUNTIF(session_applied) / COUNTIF(is_session_first) FROM s28
UNION ALL SELECT 'S1 검색 28', '검색 수', COUNT(*) FROM s28
UNION ALL SELECT 'S1 검색 28', '검색 세션', COUNTIF(is_session_first) FROM s28
UNION ALL SELECT 'S2 검색 90 iOS 회원', '검색 성공률', COUNTIF(is_clicked) / COUNT(*) FROM s90
UNION ALL SELECT 'S2 검색 90 iOS 회원', '결과 0건 비율', COUNTIF(is_zero_result) / COUNT(*) FROM s90
UNION ALL SELECT 'S2 검색 90 iOS 회원', '평균 첫 클릭 순위', AVG(first_click_position) FROM s90
UNION ALL SELECT 'S2 검색 90 iOS 회원', '재검색률', COUNTIF(is_reformulated) / COUNT(*) FROM s90
UNION ALL SELECT 'S2 검색 90 iOS 회원', '검색 세션 신청 전환', COUNTIF(session_applied) / COUNTIF(is_session_first) FROM s90
UNION ALL SELECT 'S2 검색 90 iOS 회원', '검색 수', COUNT(*) FROM s90
UNION ALL SELECT 'S2 검색 90 iOS 회원', '검색 세션', COUNTIF(is_session_first) FROM s90
UNION ALL SELECT w, '검색 수', SUM(n) FROM qwin GROUP BY w
UNION ALL SELECT w, '결과 0건 비율', SUM(z) / SUM(n) FROM qwin GROUP BY w
UNION ALL SELECT w, '검색 20건 이상', COUNTIF(n >= 20) FROM qwin GROUP BY w
UNION ALL SELECT w, '실패 검색어', COUNTIF(n >= 20 AND z / n >= 0.3) FROM qwin GROUP BY w
UNION ALL SELECT w, '0건 중 실패 몫', SUM(IF(n >= 20 AND z / n >= 0.3, z, 0)) / SUM(z) FROM qwin GROUP BY w
UNION ALL SELECT CONCAT('L 라벨링 ', CAST(l.week_start AS STRING)), '라벨', labels FROM lab l
UNION ALL SELECT CONCAT('L 라벨링 ', CAST(l.week_start AS STRING)), '활동 평가자', raters FROM lab l
UNION ALL SELECT CONCAT('L 라벨링 ', CAST(l.week_start AS STRING)), '건당 처리 시간', sec FROM lab l
UNION ALL SELECT CONCAT('L 라벨링 ', CAST(l.week_start AS STRING)), '정답셋 정확도', gold_ok / gold FROM lab l
UNION ALL SELECT CONCAT('L 라벨링 ', CAST(l.week_start AS STRING)), '정답셋', gold FROM lab l
UNION ALL SELECT CONCAT('L 라벨링 ', CAST(l.week_start AS STRING)), '일치율', agree / pairs FROM lab l
UNION ALL SELECT CONCAT('L 라벨링 ', CAST(l.week_start AS STRING)), '재작업률', rework / labels FROM lab l
UNION ALL SELECT CONCAT('L 라벨링 ', CAST(l.week_start AS STRING)), '완료 과제', done FROM lab l
UNION ALL SELECT CONCAT('L 라벨링 ', CAST(l.week_start AS STRING)), '카파', (l.agree / l.pairs - pe.pe) / (1 - pe.pe) FROM lab l JOIN pe USING (week_start)
UNION ALL SELECT CONCAT('E1 ', ranker_version), '검색 수', COUNT(*) FROM ab GROUP BY ranker_version
UNION ALL SELECT CONCAT('E1 ', ranker_version), '기기', COUNT(DISTINCT client_id) FROM ab GROUP BY ranker_version
UNION ALL SELECT CONCAT('E1 ', ranker_version), '검색 성공률', COUNTIF(is_clicked) / COUNT(*) FROM ab GROUP BY ranker_version
UNION ALL SELECT CONCAT('E1 ', ranker_version), '결과 0건 비율', COUNTIF(is_zero_result) / COUNT(*) FROM ab GROUP BY ranker_version
UNION ALL SELECT CONCAT('E1 ', ranker_version), '평균 첫 클릭 순위', AVG(first_click_position) FROM ab GROUP BY ranker_version
UNION ALL SELECT CONCAT('E1 ', ranker_version), '상위 3위 클릭 비중', COUNTIF(first_click_position <= 3) / COUNTIF(is_clicked) FROM ab GROUP BY ranker_version
UNION ALL SELECT CONCAT('E1 ', ranker_version), '재검색률', COUNTIF(is_reformulated) / COUNT(*) FROM ab GROUP BY ranker_version
UNION ALL SELECT CONCAT('E1 ', ranker_version), '결과 클릭률', COUNTIF(is_clicked) / COUNTIF(NOT is_zero_result) FROM ab GROUP BY ranker_version
UNION ALL SELECT CONCAT('E1 ', ranker_version), '검색 세션 신청 전환', COUNTIF(session_applied) / COUNTIF(is_session_first) FROM ab GROUP BY ranker_version
UNION ALL SELECT CONCAT('I1 ', p), '검색 수', COUNT(*) FROM ph GROUP BY p
UNION ALL SELECT CONCAT('I1 ', p), '결과 0건 · 전체', COUNTIF(is_zero_result) / COUNT(*) FROM ph GROUP BY p
UNION ALL SELECT CONCAT('I1 ', p), '결과 0건 · 상권', COUNTIF(is_zero_result AND query_intent = 'region') / COUNTIF(query_intent = 'region') FROM ph GROUP BY p
UNION ALL SELECT CONCAT('I1 ', p), '검색 성공률 · 상권', COUNTIF(is_clicked AND query_intent = 'region') / COUNTIF(query_intent = 'region') FROM ph GROUP BY p
ORDER BY 1, 2
;
