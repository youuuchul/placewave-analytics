-- 표: ops.reconciliation — 대조·범위·무결성 검사 결과 (행 추가)
-- 1행: 실행 1회 × 검사 항목
-- 키: (run_id, check_id)
-- 파티션·클러스터: DATE(checked_at) / 없음
-- 원천: raw.db_payments·db_applications·db_subscriptions·db_venues,
--       staging.events_clean·int_session·int_person_day·fct_order·ad_spend·dim_contract,
--       marts.daily_metrics·weekly_cohort·daily_channel·weekly_activity·weekly_audience_funnel·weekly_path·person_day,
--       marts.daily_revenue·daily_subscription·daily_venue_registry·daily_event·venue_registry·monthly_contract,
--       raw.search_log·search_click_log·eval_queries·eval_labels·eval_tasks·eval_batches, staging.int_search·int_label,
--       marts.daily_search·exp_ranker_request·weekly_eval_ops·weekly_batch,
--       staging.ml_ranker_pairs, raw.ml_query_parse·ml_ranker_scores·ml_ranker_features, marts.ranker_eval·ranker_query_eval·ranker_feature
-- 소비: load_all.sh 8단계(차단 검사가 하나라도 실패하면 exit 1), dashboard/scripts/extract.py(마지막 실행에
--       차단 실패가 있거나 그 뒤 1~7단계가 다시 돌았으면 추출 거부)
--
-- 표 정의는 sql/00_ops_tables.sql.
-- 판정
--   reconcile (C)  observed = |왼쪽 - 오른쪽| + 날짜별 불일치 키 수. 0 이어야 통과. 차단
--   integrity (I)  observed = 위반 건수. 0 이어야 통과. 차단
--   range     (R)  observed = 분자 / 분모. docs/architecture.md §6 범위 안이어야 통과. 경보(기록만 하고 멈추지 않는다)
-- 사업 목표(수수료율·파트너 부담률)는 지표 가이드 북극성 가드레일, 생성 가정(해지 연결)은 generator/validate.py 에서 본다.
-- 매개변수: @run_id STRING

INSERT INTO ops.reconciliation
  (run_id, checked_at, check_id, category, check_name, left_label, left_value, right_label, right_value,
   observed, lower_bound, upper_bound, passed, note)
WITH
log_ev AS (
  SELECT
    COUNTIF(event_name = 'purchase') AS purchases,
    SUM(IF(event_name = 'purchase', amount, 0)) AS purchase_amount,
    COUNTIF(event_name = 'apply_event') AS applications
  FROM staging.events_clean
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND event_name IN ('purchase', 'apply_event')
),
ledger AS (
  SELECT
    (SELECT COUNT(*) FROM raw.db_payments WHERE kind = 'ticket') AS payments,
    (SELECT SUM(amount) FROM raw.db_payments WHERE kind = 'ticket') AS payment_amount,
    (SELECT COUNT(*) FROM raw.db_applications) AS applications
),
-- C3 일 방문 사람: 마트 합 vs 중간 표 재집계, 날짜별
c3 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(p.v, 0)) AS stg_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(p.v, -1)) AS bad_days
  FROM (
    SELECT kst_date, SUM(persons) AS v
    FROM marts.daily_metrics
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    GROUP BY 1
  ) AS m
  FULL OUTER JOIN (
    SELECT kst_date, COUNTIF(is_visit) AS v
    FROM staging.int_person_day
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    GROUP BY 1
  ) AS p USING (kst_date)
),
-- C4 주간 코호트 크기: 0주차 합 vs 첫 방문 사람, 코호트 주별
c4 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(p.v, 0)) AS stg_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(p.v, -1)) AS bad_weeks
  FROM (
    SELECT cohort_week, SUM(cohort_size) AS v
    FROM marts.weekly_cohort
    WHERE week_offset = 0
    GROUP BY 1
  ) AS m
  FULL OUTER JOIN (
    SELECT DATE_TRUNC(kst_date, WEEK(MONDAY)) AS cohort_week, COUNT(DISTINCT person_id) AS v
    FROM staging.int_person_day
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
      AND is_visit AND is_first_visit_day
    GROUP BY 1
  ) AS p USING (cohort_week)
),
-- C5 채널 합: 세션 채널 마트 세션 합 vs 세션 표, 날짜별
c5 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(p.v, 0)) AS stg_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(p.v, -1)) AS bad_days
  FROM (
    SELECT kst_date, SUM(sessions + auto_load_sessions) AS v
    FROM marts.daily_channel
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    GROUP BY 1
  ) AS m
  FULL OUTER JOIN (
    SELECT session_date AS kst_date, COUNT(*) AS v
    FROM staging.int_session
    WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    GROUP BY 1
  ) AS p USING (kst_date)
),
-- C6 오디언스 퍼널: new + returning 랜딩 사람 합 vs weekly_activity wau, 주 × 세그먼트별
c6 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(w.v, 0)) AS ref_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(w.v, -1)) AS bad_keys
  FROM (
    SELECT week_start, channel1, device_platform, member_seg, SUM(persons) AS v
    FROM marts.weekly_audience_funnel
    WHERE step = 'landing' AND audience_id IN ('new', 'returning')
    GROUP BY 1, 2, 3, 4
  ) AS m
  FULL OUTER JOIN (
    SELECT week_start, channel1, device_platform, member_seg, SUM(wau) AS v
    FROM marts.weekly_activity
    WHERE wau > 0
    GROUP BY 1, 2, 3, 4
  ) AS w USING (week_start, channel1, device_platform, member_seg)
),
-- C7 경로: step 1 세션 합 vs weekly_activity 방문 세션 합, 주 × 세그먼트별
c7 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(w.v, 0)) AS ref_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(w.v, -1)) AS bad_keys
  FROM (
    SELECT week_start, channel1, device_platform, member_seg, SUM(sessions) AS v
    FROM marts.weekly_path
    WHERE step = 1
    GROUP BY 1, 2, 3, 4
  ) AS m
  FULL OUTER JOIN (
    SELECT week_start, channel1, device_platform, member_seg, SUM(valid_sessions) AS v
    FROM marts.weekly_activity
    WHERE valid_sessions > 0
    GROUP BY 1, 2, 3, 4
  ) AS w USING (week_start, channel1, device_platform, member_seg)
),
-- C8 기간 고유용 사람 마트: visited 고유 사람 vs 일 마트 persons, 일 × 세그먼트별
c8 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(d.v, 0)) AS ref_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(d.v, -1)) AS bad_keys
  FROM (
    SELECT kst_date, channel1, device_platform, member_seg, COUNT(DISTINCT person_key) AS v
    FROM marts.person_day
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
      AND flags & 1 = 1
    GROUP BY 1, 2, 3, 4
  ) AS m
  FULL OUTER JOIN (
    SELECT kst_date, channel1, device_platform, member_seg, SUM(persons) AS v
    FROM marts.daily_metrics
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
      AND persons > 0
    GROUP BY 1, 2, 3, 4
  ) AS d USING (kst_date, channel1, device_platform, member_seg)
),
-- C9 티켓 결제: 매출 마트 ticket 실결제(paid_amount, 환불 주문 제외) + 환불액 vs 결제 원장 kind = ticket 금액, 결제일별(금액·건수).
--    행 단위 단언 gmv_amount - discount_amount = paid_amount 위반 행 수를 더한다
c9 AS (
  SELECT
    SUM(COALESCE(m.amt, 0)) AS mart_v,
    SUM(COALESCE(r.amt, 0)) AS raw_v,
    COUNTIF(COALESCE(m.amt, -1) != COALESCE(r.amt, -1) OR COALESCE(m.n, -1) != COALESCE(r.n, -1)) AS bad_days,
    SUM(COALESCE(m.bad_rows, 0)) AS bad_rows
  FROM (
    SELECT
      kst_date,
      SUM(paid_amount + refund_amount) AS amt,
      SUM(pay_count) AS n,
      COUNTIF(gmv_amount - discount_amount != paid_amount) AS bad_rows
    FROM marts.daily_revenue
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
      AND kind = 'ticket'
    GROUP BY 1
  ) AS m
  FULL OUTER JOIN (
    SELECT DATE(paid_at, 'Asia/Seoul') AS kst_date, SUM(amount) AS amt, COUNT(*) AS n
    FROM raw.db_payments
    WHERE kind = 'ticket'
    GROUP BY 1
  ) AS r USING (kst_date)
),
-- C10 일별 활성 구독자: 구독 마트 vs 구독 원장 재집계(start <= d < end, KST), 날짜별
c10 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(r.v, 0)) AS raw_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(r.v, -1)) AS bad_days
  FROM (
    SELECT kst_date, active_subscribers AS v
    FROM marts.daily_subscription
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
      AND active_subscribers > 0
  ) AS m
  FULL OUTER JOIN (
    SELECT d AS kst_date, COUNT(DISTINCT member_id) AS v
    FROM raw.db_subscriptions,
      UNNEST(GENERATE_DATE_ARRAY(
        DATE(started_at, 'Asia/Seoul'),
        LEAST(COALESCE(DATE_SUB(DATE(ended_at, 'Asia/Seoul'), INTERVAL 1 DAY), snapshot_date), snapshot_date))) AS d
    GROUP BY 1
  ) AS r USING (kst_date)
),
-- C11 등록 공간 누적: 상권 마트 합 vs 공간 원장 등록일 누적, 날짜별
c11 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(r.v, 0)) AS raw_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(r.v, -1)) AS bad_days
  FROM (
    SELECT kst_date, SUM(registered_total) AS v
    FROM marts.daily_venue_registry
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    GROUP BY 1
  ) AS m
  FULL OUTER JOIN (
    SELECT sp.d AS kst_date, SUM(COALESCE(reg.cnt, 0)) OVER (ORDER BY sp.d) AS v
    FROM (
      SELECT d
      FROM (
        SELECT MIN(DATE(registered_at, 'Asia/Seoul')) AS lo, MAX(snapshot_date) AS hi
        FROM raw.db_venues
      ) AS b, UNNEST(GENERATE_DATE_ARRAY(b.lo, b.hi)) AS d
    ) AS sp
    LEFT JOIN (
      SELECT DATE(registered_at, 'Asia/Seoul') AS d, COUNT(*) AS cnt
      FROM raw.db_venues
      GROUP BY 1
    ) AS reg USING (d)
  ) AS r USING (kst_date)
),
-- C14 수수료: 매출 마트 ticket net_amount vs 주문 원장 fee_amount, 결제일 × 수수료 등급별
c14 AS (
  SELECT
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(o.v, 0)) AS stg_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(o.v, -1)) AS bad_keys
  FROM (
    SELECT kst_date, fee_tier, SUM(net_amount) AS v
    FROM marts.daily_revenue
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
      AND kind = 'ticket'
    GROUP BY 1, 2
  ) AS m
  FULL OUTER JOIN (
    SELECT paid_date AS kst_date, fee_tier, SUM(fee_amount) AS v
    FROM staging.fct_order
    WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
      AND kind = 'ticket' AND is_paid
    GROUP BY 1, 2
  ) AS o USING (kst_date, fee_tier)
),
-- C15 계약 월 흐름: monthly_contract all 행 월말 계약 수 vs 계약 차원 활성 재집계, 월말 MRR vs daily_venue_registry 월말,
--     계약 수 다리(all)·MRR 다리(전 행) 위반 수를 더한다
c15_mc AS (
  SELECT month, plan, contracts_bom, new_contracts, churned_contracts, contracts_eom,
         mrr_bom, mrr_new, mrr_expansion, mrr_contraction, mrr_churn, mrr_eom
  FROM marts.monthly_contract
  WHERE month BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
c15_eom AS (
  SELECT DISTINCT
    mc.month,
    LEAST(LAST_DAY(mc.month, MONTH), s.hi) AS eom_day
  FROM c15_mc AS mc
  CROSS JOIN (SELECT MAX(snapshot_date) AS hi FROM staging.dim_contract) AS s
),
c15_ref AS (
  SELECT
    e.month,
    e.eom_day,
    COUNTIF(dc.start_date <= e.eom_day AND (dc.end_date IS NULL OR dc.end_date > e.eom_day)) AS contracts_eom
  FROM c15_eom AS e
  CROSS JOIN staging.dim_contract AS dc
  GROUP BY 1, 2
),
c15 AS (
  SELECT
    SUM(a.contracts_eom) AS mart_v,
    SUM(r.contracts_eom) AS ref_v,
    COUNTIF(
      a.contracts_eom != r.contracts_eom
      OR a.mrr_eom != COALESCE(v.mrr, 0)
      OR a.contracts_bom + a.new_contracts - a.churned_contracts != a.contracts_eom
    ) AS bad_months,
    ANY_VALUE(br.bad_bridges) AS bad_bridges
  FROM c15_mc AS a
  JOIN c15_ref AS r USING (month)
  CROSS JOIN (
    SELECT COUNTIF(mrr_bom + mrr_new + mrr_expansion - mrr_contraction - mrr_churn != mrr_eom) AS bad_bridges
    FROM c15_mc
  ) AS br
  LEFT JOIN (
    SELECT kst_date, SUM(mrr_basic + mrr_pro) AS mrr
    FROM marts.daily_venue_registry
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    GROUP BY 1
  ) AS v ON v.kst_date = r.eom_day
  WHERE a.plan = 'all'
),
cohort_ret AS (
  SELECT
    SUM(IF(week_offset = 1, retained, 0)) AS w1_num,
    SUM(IF(week_offset = 1, cohort_size, 0)) AS w1_den,
    SUM(IF(week_offset = 4, retained, 0)) AS w4_num,
    SUM(IF(week_offset = 4, cohort_size, 0)) AS w4_den
  FROM marts.weekly_cohort
  WHERE week_offset IN (1, 4) AND is_complete_week
),
person_conv AS (
  SELECT
    COUNT(DISTINCT IF(did_sign_up, person_id, NULL)) AS signup_persons,
    COUNT(DISTINCT IF(is_visit, person_id, NULL)) AS visit_persons
  FROM staging.int_person_day
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
day_conv AS (
  SELECT SUM(appliers) AS appliers, SUM(detail_viewers) AS detail_viewers
  FROM marts.daily_metrics
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
orders AS (
  SELECT
    COUNT(*) AS applications,
    COUNTIF(is_canceled) AS canceled,
    COUNTIF(is_paid_tier) AS paid_tier,
    COUNTIF(is_paid_tier AND is_paid) AS paid_tier_paid
  FROM staging.fct_order
  WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
    AND kind = 'ticket'
),
spend_days AS (
  SELECT DISTINCT kst_date
  FROM staging.ad_spend
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' AND spend > 0
),
sess AS (
  SELECT
    COUNT(*) AS sessions,
    COUNTIF(is_auto_load) AS auto_load,
    COUNTIF(NOT is_auto_load AND session_date IN (SELECT kst_date FROM spend_days)) AS valid_in_spend,
    COUNTIF(NOT is_auto_load AND session_date IN (SELECT kst_date FROM spend_days) AND session_channel1 = 'paid') AS paid_in_spend,
    COUNTIF(session_channel1 = 'unmapped') AS unmapped
  FROM staging.int_session
  WHERE session_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
integrity AS (
  SELECT
    (SELECT COUNT(*) FROM (
       SELECT client_id
       FROM staging.events_clean
       WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' AND member_id IS NOT NULL
       GROUP BY client_id
       HAVING COUNT(DISTINCT member_id) > 1)) AS multi_member_devices,
    (SELECT COUNTIF(kst_date != DATE(event_at, 'Asia/Seoul'))
       FROM staging.events_clean
       WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31') AS kst_date_mismatch,
    (SELECT COUNTIF(price_tier IS NULL)
       FROM staging.fct_order
       WHERE applied_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' AND kind = 'ticket') AS orphan_orders
),
-- C12 신청 건수·결제 금액: 일 마트(로그, 세션 시작일) vs 행사 마트(원장, 신청일). 날짜 귀속이 달라 기간 합은
--     자정을 넘긴 세션만큼 어긋날 수 있지만 전 기간 합은 같아야 한다 (대시보드 개요·흐름 vs 행사별 보기)
c12 AS (
  SELECT
    (SELECT SUM(applies) FROM marts.daily_metrics WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31') AS dm_applies,
    (SELECT SUM(applies) FROM marts.daily_event WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31') AS de_applies,
    (SELECT SUM(pay_amount) FROM marts.daily_metrics WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31') AS dm_amount,
    (SELECT SUM(pay_amount) FROM marts.daily_event WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31') AS de_amount
),
-- C13 기준일 파트너 공간: 상권 마트 마지막 날 합 vs 공간 스냅샷 is_partner (대시보드 공간 탭 타일 vs 지도·표)
c13 AS (
  SELECT
    (SELECT SUM(partner_total) FROM marts.daily_venue_registry
      WHERE kst_date = (SELECT MAX(kst_date) FROM marts.daily_venue_registry
                        WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31')) AS mart_v,
    (SELECT COUNTIF(is_partner) FROM marts.venue_registry) AS snap_v
),
-- R9 세션 시작일과 다른 날에 일어난 신청 비중 (C12 기간 차이의 크기)
cross_day AS (
  SELECT COUNTIF(e.kst_date != s.session_date) AS cross_n, COUNT(*) AS all_n
  FROM staging.events_clean AS e
  JOIN staging.int_session AS s USING (client_id, session_id)
  WHERE e.kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' AND e.event_name = 'apply_event'
),
-- C16 검색 요청: 서버 로그 행 = 중간 표 행 = 일 마트 합. 날짜별 마트 vs 중간 표 불일치 일수 포함
c16 AS (
  SELECT
    (SELECT COUNT(*) FROM raw.search_log WHERE requested_at IS NOT NULL) AS raw_n,
    SUM(COALESCE(m.v, 0)) AS mart_v,
    SUM(COALESCE(i.v, 0)) AS stg_v,
    COUNTIF(COALESCE(m.v, -1) != COALESCE(i.v, -1)) AS bad_days
  FROM (
    SELECT kst_date, SUM(searches) AS v FROM marts.daily_search
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' GROUP BY 1
  ) AS m
  FULL OUTER JOIN (
    SELECT kst_date, COUNT(*) AS v FROM staging.int_search
    WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' GROUP BY 1
  ) AS i USING (kst_date)
),
-- C17·R12·I5·I6 검색 판정 (중간 표)
srch AS (
  SELECT
    COUNT(*) AS n,
    COUNTIF(ga_logged) AS ga_logged,
    COUNTIF(is_clicked) AS clicked,
    COUNTIF(is_clicked AND (is_zero_result OR first_click_position NOT BETWEEN 1 AND 10)) AS bad_click,
    COUNTIF(channel1 IS NULL OR device_platform IS NULL OR member_seg IS NULL) AS no_seg,
    COUNTIF(is_session_first) AS first_rows,
    COUNT(DISTINCT FORMAT('%s|%d', client_id, session_id)) AS search_sessions
  FROM staging.int_search
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
-- C21 클릭: 서버 클릭 로그의 클릭 요청 수 = 중간 표 클릭 수, 서버 요청 로그에 없는 클릭 요청 0
clk AS (
  SELECT
    COUNT(DISTINCT c.request_id) AS click_requests,
    COUNT(DISTINCT IF(r.request_id IS NULL, c.request_id, NULL)) AS orphan
  FROM raw.search_click_log AS c
  LEFT JOIN raw.search_log AS r USING (request_id)
),
-- I8 검색 지표 관계식: 행마다 result_searches = searches − zero_result_searches, clicked ≤ result_searches
--    (그러면 성공률 = (1 − 0건 비율) × 결과 클릭률 이 어느 축으로 더해도 정확히 성립)
ident AS (
  SELECT COUNTIF(result_searches != searches - zero_result_searches OR clicked_searches > result_searches) AS bad
  FROM marts.daily_search
  WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
),
-- I9 랭킹 배정·기간 경계 (세션 시작일 기준): 7/13 전 v2, 7/27 부터 v1, A/B 기간 배정과 다른 버전 = 0
assign AS (
  SELECT
    (SELECT COUNTIF((kst_date < DATE '2026-07-13' AND ranker_version = 'v2') OR (kst_date >= DATE '2026-07-27' AND ranker_version = 'v1'))
       FROM staging.int_search WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31')
    + (SELECT COUNTIF(ranker_version != IF(arm = 'treatment', 'v2', 'v1'))
       FROM marts.exp_ranker_request WHERE kst_date BETWEEN DATE '2026-07-13' AND DATE '2026-07-26') AS bad
),
-- C18·C19 라벨 수·정답셋 성분: 주간 마트 합 vs 원천 재집계
lab AS (
  SELECT
    (SELECT COUNT(*) FROM raw.eval_labels) AS raw_labels,
    (SELECT SUM(labels) FROM marts.weekly_eval_ops) AS mart_labels,
    (SELECT COUNTIF(t.is_gold AND NOT l.is_rework) FROM raw.eval_labels AS l JOIN raw.eval_tasks AS t USING (task_id)) AS raw_gold,
    (SELECT COUNTIF(t.is_gold AND NOT l.is_rework AND l.grade = t.gold_grade)
       FROM raw.eval_labels AS l JOIN raw.eval_tasks AS t USING (task_id)) AS raw_gold_ok,
    (SELECT SUM(gold_labels) FROM marts.weekly_eval_ops) AS mart_gold,
    (SELECT SUM(gold_correct) FROM marts.weekly_eval_ops) AS mart_gold_ok
),
-- I7 과제당 첫 제출 평가자 수 > labels_per_task, 배치 완료 > 목표
over_label AS (
  SELECT
    (SELECT COUNT(*) FROM (
       SELECT l.task_id, ANY_VALUE(b.labels_per_task) AS lpt, COUNT(DISTINCT l.rater_id) AS n
       FROM staging.int_label AS l JOIN raw.eval_batches AS b USING (batch_id)
       WHERE l.kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' AND NOT l.is_rework
       GROUP BY 1
     ) WHERE n > lpt)
    + (SELECT COUNTIF(done_tasks > target_tasks) FROM marts.weekly_batch) AS violations
),
-- C20 실패 출처 편입 검색어: 추출일 직전 7일(서버 로그, 요청 KST 날짜) 검색 20건 이상 · 0건 비율 30% 이상이어야 한다
failed_src AS (
  SELECT COUNTIF(COALESCE(w.n, 0) < 20 OR SAFE_DIVIDE(w.z, w.n) < 0.3) AS bad, COUNT(*) AS n
  FROM raw.eval_queries AS q
  LEFT JOIN (
    SELECT
      q2.batch_id, q2.query_norm, COUNT(*) AS n, COUNTIF(s.results_count = 0) AS z
    FROM raw.eval_queries AS q2
    JOIN raw.search_log AS s
      ON LOWER(TRIM(s.query_raw)) = q2.query_norm
     AND DATE(s.requested_at, 'Asia/Seoul') BETWEEN DATE_SUB(q2.sampled_at, INTERVAL 7 DAY) AND DATE_SUB(q2.sampled_at, INTERVAL 1 DAY)
    WHERE q2.source = 'failed'
    GROUP BY 1, 2
  ) AS w USING (batch_id, query_norm)
  WHERE q.source = 'failed'
),
-- C22 순위 모델 채점: 해석된 검색어의 학습 쌍 vs 채점 결과 (+ 양쪽 키 불일치)
ml_score AS (
  SELECT
    (SELECT COUNT(*) FROM staging.ml_ranker_pairs AS p JOIN raw.ml_query_parse AS q USING (query_norm)
     WHERE q.query_intent != 'other') AS pairs_n,
    (SELECT COUNT(*) FROM raw.ml_ranker_scores) AS scores_n,
    (SELECT COUNT(*) FROM staging.ml_ranker_pairs AS p JOIN raw.ml_query_parse AS q USING (query_norm)
     LEFT JOIN raw.ml_ranker_scores AS s USING (query_norm, item_type, item_id)
     WHERE q.query_intent != 'other' AND s.query_norm IS NULL)
    + (SELECT COUNT(*) FROM raw.ml_ranker_scores AS s
       LEFT JOIN staging.ml_ranker_pairs AS p USING (query_norm, item_type, item_id) WHERE p.query_norm IS NULL) AS orphan
),
-- C23 순위 모델 평가 마트: 학습 쌍 vs ranker_eval (행 + 정답 등급 합)
ml_eval AS (
  SELECT
    (SELECT COUNT(*) FROM staging.ml_ranker_pairs) AS pairs_n,
    (SELECT SUM(label) FROM staging.ml_ranker_pairs) AS pairs_label,
    (SELECT COUNT(*) FROM marts.ranker_eval) AS mart_n,
    (SELECT SUM(label) FROM marts.ranker_eval) AS mart_label
),
-- I10 순위 모델 산출 짝: 버전이 하나가 아님 + 중요도 비중 합 ≠ 1 + 검색 로그 검색어 중 해석 표에 없는 것
ml_ver AS (
  SELECT
    (SELECT COUNT(DISTINCT v) FROM (
       SELECT parser_version AS v FROM raw.ml_query_parse
       UNION ALL SELECT model_version FROM raw.ml_ranker_scores
       UNION ALL SELECT model_version FROM raw.ml_ranker_features
       UNION ALL SELECT model_version FROM marts.ranker_feature)) - 1
    + IF(ABS((SELECT SUM(gain_share) FROM marts.ranker_feature) - 1) > 0.001, 1, 0)
    + (SELECT COUNT(DISTINCT s.query_norm) FROM staging.int_search AS s
       LEFT JOIN raw.ml_query_parse AS q USING (query_norm)
       WHERE s.kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' AND q.query_norm IS NULL) AS bad
),
-- I11 검색어 해석: 새 해석의 의도 유형이 검색 로그 의도 분류와 다른 검색어 + 해석 평가 마트 요청 수 ≠ 기준선 요청 수
ml_parse AS (
  SELECT
    (SELECT COUNT(*) FROM (
       SELECT DISTINCT s.query_norm, s.query_intent FROM staging.int_search AS s
       WHERE s.kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31') AS s
     JOIN raw.ml_query_parse AS q USING (query_norm) WHERE q.query_intent != s.query_intent)
    + ABS((SELECT SUM(requests) FROM marts.ranker_query_eval)
          - (SELECT COUNT(*) FROM staging.int_search WHERE kst_date BETWEEN DATE '2026-06-22' AND DATE '2026-07-05')) AS bad
),
checks AS (
  SELECT 'C1a' AS check_id, 'reconcile' AS category, '결제 건수: 로그 vs 원장' AS check_name,
         'events_clean purchase' AS left_label, CAST(l.purchases AS FLOAT64) AS left_value,
         'raw.db_payments 행 (kind = ticket)' AS right_label, CAST(g.payments AS FLOAT64) AS right_value,
         CAST(ABS(l.purchases - g.payments) AS FLOAT64) AS observed, 0.0 AS lower_bound, 0.0 AS upper_bound,
         CAST(NULL AS STRING) AS note
  FROM log_ev AS l, ledger AS g
  UNION ALL
  SELECT 'C1b', 'reconcile', '결제 금액: 로그 vs 원장',
         'events_clean purchase value 합', l.purchase_amount, 'raw.db_payments amount 합 (kind = ticket)', g.payment_amount,
         ABS(l.purchase_amount - g.payment_amount), 0, 0, NULL
  FROM log_ev AS l, ledger AS g
  UNION ALL
  SELECT 'C2', 'reconcile', '신청 건수: 로그 vs 원장',
         'events_clean apply_event', l.applications, 'raw.db_applications 행', g.applications,
         ABS(l.applications - g.applications), 0, 0, NULL
  FROM log_ev AS l, ledger AS g
  UNION ALL
  SELECT 'C3', 'reconcile', '일 방문 사람: 마트 합 vs 중간 표',
         'marts.daily_metrics persons 합', mart_v, 'int_person_day is_visit 재집계', stg_v,
         ABS(mart_v - stg_v) + bad_days, 0, 0, FORMAT('불일치 날짜 %d', bad_days)
  FROM c3
  UNION ALL
  SELECT 'C4', 'reconcile', '주간 코호트 크기: 0주차 vs 첫 방문',
         'marts.weekly_cohort 0주차 cohort_size 합', mart_v, 'int_person_day 첫 방문 사람', stg_v,
         ABS(mart_v - stg_v) + bad_weeks, 0, 0, FORMAT('불일치 코호트 주 %d', bad_weeks)
  FROM c4
  UNION ALL
  SELECT 'C5', 'reconcile', '채널 합: 세션 채널 마트 vs 세션 표',
         'marts.daily_channel sessions + auto_load_sessions 합', mart_v, 'int_session 행', stg_v,
         ABS(mart_v - stg_v) + bad_days, 0, 0, FORMAT('불일치 날짜 %d', bad_days)
  FROM c5
  UNION ALL
  SELECT 'C6', 'reconcile', '오디언스 퍼널: 신규 + 재방문 vs WAU',
         'weekly_audience_funnel landing new+returning 합', mart_v, 'weekly_activity wau 합', ref_v,
         ABS(mart_v - ref_v) + bad_keys, 0, 0, FORMAT('불일치 주 × 세그먼트 %d', bad_keys)
  FROM c6
  UNION ALL
  SELECT 'C7', 'reconcile', '경로 1단계 세션 vs 주간 방문 세션',
         'weekly_path step 1 sessions 합', mart_v, 'weekly_activity valid_sessions 합', ref_v,
         ABS(mart_v - ref_v) + bad_keys, 0, 0, FORMAT('불일치 주 × 세그먼트 %d', bad_keys)
  FROM c7
  UNION ALL
  SELECT 'C8', 'reconcile', '사람 마트 방문 고유 vs 일 마트 방문 사람',
         'person_day visited 고유 사람 합', mart_v, 'daily_metrics persons 합', ref_v,
         ABS(mart_v - ref_v) + bad_keys, 0, 0, FORMAT('불일치 일 × 세그먼트 %d', bad_keys)
  FROM c8
  UNION ALL
  SELECT 'C9', 'reconcile', '티켓 결제 금액: 매출 마트 vs 결제 원장',
         'daily_revenue ticket paid_amount + refund_amount 합', mart_v, 'raw.db_payments amount 합 (kind = ticket)', raw_v,
         ABS(mart_v - raw_v) + bad_days + bad_rows, 0, 0,
         FORMAT('불일치 결제일 %d, gmv - discount != paid 행 %d', bad_days, bad_rows)
  FROM c9
  UNION ALL
  SELECT 'C10', 'reconcile', '일별 활성 구독자: 구독 마트 vs 구독 원장',
         'daily_subscription active_subscribers 합', mart_v, 'db_subscriptions 활성일 재집계 합', raw_v,
         ABS(mart_v - raw_v) + bad_days, 0, 0, FORMAT('불일치 날짜 %d', bad_days)
  FROM c10
  UNION ALL
  SELECT 'C11', 'reconcile', '등록 공간 누적: 상권 마트 vs 공간 원장',
         'daily_venue_registry registered_total 합', mart_v, 'db_venues 등록일 누적 합', raw_v,
         ABS(mart_v - raw_v) + bad_days, 0, 0, FORMAT('불일치 날짜 %d', bad_days)
  FROM c11
  UNION ALL
  SELECT 'C14', 'reconcile', '수수료 매출: 매출 마트 vs 주문 원장',
         'daily_revenue ticket net_amount 합', mart_v, 'fct_order fee_amount 합 (결제)', stg_v,
         ABS(mart_v - stg_v) + bad_keys, 0, 0, FORMAT('불일치 결제일 × 등급 %d', bad_keys)
  FROM c14
  UNION ALL
  SELECT 'C15', 'reconcile', '월말 계약: 계약 월 마트 vs 계약 차원',
         'monthly_contract all contracts_eom 합', mart_v, 'dim_contract 월말 활성 재집계 합', ref_v,
         ABS(mart_v - ref_v) + bad_months + bad_bridges, 0, 0,
         FORMAT('불일치 월(계약 수·월말 MRR·계약 수 다리) %d, MRR 다리 위반 행 %d', bad_months, bad_bridges)
  FROM c15
  UNION ALL
  SELECT 'R1', 'range', '신규 방문자 W1 리텐션',
         'W1 retained', w1_num, 'cohort_size (W1 관측 완료 코호트)', w1_den,
         SAFE_DIVIDE(w1_num, w1_den), 0.15, 0.30, NULL
  FROM cohort_ret
  UNION ALL
  SELECT 'R2', 'range', 'W4 리텐션',
         'W4 retained', w4_num, 'cohort_size (W4 관측 완료 코호트)', w4_den,
         SAFE_DIVIDE(w4_num, w4_den), 0.08, 0.18, NULL
  FROM cohort_ret
  UNION ALL
  SELECT 'R3', 'range', '방문 → 가입 전환 (기간 누적 사람)',
         '가입 사람', signup_persons, '방문 사람', visit_persons,
         SAFE_DIVIDE(signup_persons, visit_persons), 0.06, 0.12, NULL
  FROM person_conv
  UNION ALL
  SELECT 'R4', 'range', '행사 상세 조회 → 신청 (사람 × 일)',
         '신청 사람 × 일', appliers, '행사 상세 조회 사람 × 일', detail_viewers,
         SAFE_DIVIDE(appliers, detail_viewers), 0.03, 0.15, NULL
  FROM day_conv
  UNION ALL
  SELECT 'R5', 'range', '신청 → 결제 완료 (유료 행사)',
         '유료 신청 중 결제', paid_tier_paid, '유료 행사 신청', paid_tier,
         SAFE_DIVIDE(paid_tier_paid, paid_tier), 0.55, 0.75, NULL
  FROM orders
  UNION ALL
  SELECT 'R6', 'range', '취소율 (신청 대비)',
         '취소된 신청', canceled, '신청', applications,
         SAFE_DIVIDE(canceled, applications), 0.05, 0.12, NULL
  FROM orders
  UNION ALL
  SELECT 'R7', 'range', '광고 세션 비중 (집행일, 자동 로드 제외)',
         '광고 세션', paid_in_spend, '집행일 전체 세션', valid_in_spend,
         SAFE_DIVIDE(paid_in_spend, valid_in_spend), 0.10, 0.30, NULL
  FROM sess
  UNION ALL
  SELECT 'R8', 'range', '자동 로드 세션 비중',
         '자동 로드 세션', auto_load, '전체 세션', sessions,
         SAFE_DIVIDE(auto_load, sessions), 0.05, 0.10, NULL
  FROM sess
  UNION ALL
  SELECT 'I1', 'integrity', '기기당 회원 1명', '회원 2명 이상 기기', multi_member_devices, NULL, NULL,
         multi_member_devices, 0, 0, NULL
  FROM integrity
  UNION ALL
  SELECT 'I2', 'integrity', '채널 매핑 누락 세션', 'unmapped 세션', unmapped, NULL, NULL,
         unmapped, 0, 0, NULL
  FROM sess
  UNION ALL
  SELECT 'I3', 'integrity', 'event_date = KST 날짜', '불일치 이벤트', kst_date_mismatch, NULL, NULL,
         kst_date_mismatch, 0, 0, NULL
  FROM integrity
  UNION ALL
  SELECT 'I4', 'integrity', '행사 원장에 없는 신청', '고아 신청', orphan_orders, NULL, NULL,
         orphan_orders, 0, 0, NULL
  FROM integrity
  UNION ALL
  SELECT 'C12a', 'reconcile', '신청 건수 전 기간: 일 마트(로그) vs 행사 마트(원장)',
         'daily_metrics applies 합', dm_applies, 'daily_event applies 합', de_applies,
         ABS(dm_applies - de_applies), 0, 0, NULL
  FROM c12
  UNION ALL
  SELECT 'C12b', 'reconcile', '결제 금액 전 기간: 일 마트(로그) vs 행사 마트(원장)',
         'daily_metrics pay_amount 합', dm_amount, 'daily_event pay_amount 합', de_amount,
         ABS(dm_amount - de_amount), 0, 0, NULL
  FROM c12
  UNION ALL
  SELECT 'C13', 'reconcile', '기준일 파트너 공간: 상권 마트 vs 공간 스냅샷',
         'daily_venue_registry partner_total (마지막 날 합)', mart_v, 'venue_registry is_partner 수', snap_v,
         ABS(mart_v - snap_v), 0, 0, NULL
  FROM c13
  UNION ALL
  SELECT 'R9', 'range', '세션 시작일과 다른 날의 신청 (자정 넘긴 세션)',
         '다른 날 신청', cross_n, '전체 신청', all_n,
         SAFE_DIVIDE(cross_n, all_n), 0, 0.02, NULL
  FROM cross_day
  UNION ALL
  SELECT 'C16', 'reconcile', '검색 요청: 서버 로그 vs 중간 표 vs 일 마트 (+ 날짜별 불일치 일수)',
         'raw.search_log 행', raw_n, 'daily_search searches 합', mart_v,
         ABS(raw_n - mart_v) + ABS(stg_v - mart_v) + bad_days, 0, 0, NULL
  FROM c16
  UNION ALL
  SELECT 'C17', 'reconcile', '세션 대표 행: 대표 검색 행 수 vs 검색이 있었던 세션 수',
         'is_session_first 행', first_rows, '검색 세션 고유 수', search_sessions,
         ABS(first_rows - search_sessions), 0, 0, NULL
  FROM srch
  UNION ALL
  SELECT 'R12', 'range', 'GA search 이벤트 수집률 (서버 요청 중 같은 search_id 의 GA 이벤트가 있는 비중)',
         'GA 수집 요청', ga_logged, '서버 요청', n,
         SAFE_DIVIDE(ga_logged, n), 0.97, 0.995, NULL
  FROM srch
  UNION ALL
  SELECT 'I5', 'integrity', '클릭 판정: 결과 0건이거나 순위 1~10 밖인데 클릭', '위반 요청', bad_click, NULL, NULL,
         bad_click, 0, 0, NULL
  FROM srch
  UNION ALL
  SELECT 'C21', 'reconcile', '검색 클릭: 서버 클릭 로그 클릭 요청 vs 중간 표 클릭 (+ 요청 로그에 없는 클릭)',
         'search_click_log 클릭 요청', click_requests, 'int_search is_clicked', clicked,
         ABS(click_requests - clicked) + orphan, 0, 0, NULL
  FROM clk, srch
  UNION ALL
  SELECT 'I8', 'integrity', '검색 지표 관계식: result = searches − zero, clicked ≤ result (일 마트 행마다)', '위반 행', bad, NULL, NULL,
         bad, 0, 0, NULL
  FROM ident
  UNION ALL
  SELECT 'I9', 'integrity', '랭킹 배정·기간 경계: 7/13 전 v2·7/27 이후 v1·A/B 기간 배정과 다른 버전', '위반 요청', bad, NULL, NULL,
         bad, 0, 0, NULL
  FROM assign
  UNION ALL
  SELECT 'I6', 'integrity', '검색 요청 세그먼트 누락', '세그먼트 NULL 요청', no_seg, NULL, NULL,
         no_seg, 0, 0, NULL
  FROM srch
  UNION ALL
  SELECT 'C18', 'reconcile', '라벨 수: 원천 vs 평가 운영 주간 마트',
         'raw.eval_labels 행', raw_labels, 'weekly_eval_ops labels 합', mart_labels,
         ABS(raw_labels - mart_labels), 0, 0, NULL
  FROM lab
  UNION ALL
  SELECT 'C19', 'reconcile', '정답셋 성분: 원천 재집계 vs 주간 마트 (첫 제출 라벨 수 + 정답 수)',
         '원천 정답셋 첫 제출 / 정답', raw_gold + raw_gold_ok, 'weekly_eval_ops gold_labels + gold_correct', mart_gold + mart_gold_ok,
         ABS(raw_gold - mart_gold) + ABS(raw_gold_ok - mart_gold_ok), 0, 0, NULL
  FROM lab
  UNION ALL
  SELECT 'I7', 'integrity', '과제당 평가자 초과·배치 완료 > 목표', '위반 건', violations, NULL, NULL,
         violations, 0, 0, NULL
  FROM over_label
  UNION ALL
  SELECT 'C20', 'reconcile', '실패 출처 편입 검색어가 직전 7일 실패 조건(20건 이상·0건 30% 이상)을 만족',
         '조건 미달 편입', bad, '실패 출처 편입', n,
         bad, 0, 0, NULL
  FROM failed_src
  UNION ALL
  SELECT 'C22', 'reconcile', '순위 모델 채점: 해석된 검색어의 학습 쌍 vs 채점 결과 (+ 키 불일치)',
         '해석된 학습 쌍', pairs_n, 'ml_ranker_scores 행', scores_n,
         ABS(pairs_n - scores_n) + orphan, 0, 0, NULL
  FROM ml_score
  UNION ALL
  SELECT 'C23', 'reconcile', '순위 모델 평가 마트: 학습 쌍 vs ranker_eval (행 + 정답 등급 합)',
         'ml_ranker_pairs 행', pairs_n, 'ranker_eval 행', mart_n,
         ABS(pairs_n - mart_n) + ABS(pairs_label - mart_label), 0, 0, NULL
  FROM ml_eval
  UNION ALL
  SELECT 'I10', 'integrity', '순위 모델 산출 짝: 버전 둘 이상·중요도 합 ≠ 1·해석 표에 없는 검색 로그 검색어', '위반 건', bad, NULL, NULL,
         bad, 0, 0, NULL
  FROM ml_ver
  UNION ALL
  SELECT 'I11', 'integrity', '검색어 해석: 새 해석 의도 ≠ 검색 로그 의도 분류 + 해석 평가 마트 요청 ≠ 기준선 요청', '위반 건', bad, NULL, NULL,
         bad, 0, 0, NULL
  FROM ml_parse
)
SELECT
  @run_id,
  CURRENT_TIMESTAMP(),
  check_id,
  category,
  check_name,
  left_label,
  left_value,
  right_label,
  right_value,
  observed,
  lower_bound,
  upper_bound,
  COALESCE(observed BETWEEN lower_bound AND upper_bound, FALSE),
  note
FROM checks;
