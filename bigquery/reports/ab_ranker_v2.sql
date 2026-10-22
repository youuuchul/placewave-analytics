-- 보고서 랭킹 A/B (설계서 · 진행 점검 · 결과 보고) 재현 쿼리 (SELECT 만, 개인 프로젝트에서 scripts/bq.sh query 로 실행)
-- 보고서 화면은 marts.exp_ranker_request 를 받아 같은 계산(dashboard/src/lib/experiments.ts)을 한다.
-- 분석 단위 = 기기(client_id, 무작위 배정 단위). 비율 지표는 기기별 분자·분모 합으로 델타 방법 분산을 쓴다.
-- ① 배정 점검(SRM) ② 지표별 집단 비교(실험 7/13~7/26, 실험 전 A/A 6/29~7/12) ③ 마트 vs 정제층 합계 대조.

-- ① 배정 점검: 실험 기간 검색 기기 수와 실제 받은 랭킹 버전
SELECT
  arm,
  COUNT(DISTINCT client_id) AS devices,
  COUNT(*) AS requests,
  COUNTIF(ranker_version = IF(arm = 'treatment', 'v2', 'v1')) AS requests_on_assigned_ranker
FROM marts.exp_ranker_request
WHERE kst_date BETWEEN DATE '2026-07-13' AND DATE '2026-07-26'
GROUP BY 1
ORDER BY 1;

-- ② 지표별 집단 비교. period 를 바꿔 A/A(실험 전 6/29~7/12)도 같은 식으로 본다.
WITH req AS (
  SELECT
    IF(kst_date >= DATE '2026-07-13', 'experiment', 'pre') AS period,
    arm,
    client_id,
    m.metric,
    m.num,
    m.den
  FROM marts.exp_ranker_request,
    UNNEST([
      STRUCT('success' AS metric, IF(is_clicked, 1, 0) AS num, 1 AS den),
      STRUCT('zero', IF(is_zero_result, 1, 0), 1),
      STRUCT('ctr', IF(is_clicked, 1, 0), IF(is_zero_result, 0, 1)),
      STRUCT('pos', IF(is_clicked, first_click_position, 0), IF(is_clicked, 1, 0)),
      STRUCT('top3', IF(is_clicked AND first_click_position <= 3, 1, 0), IF(is_clicked, 1, 0)),
      STRUCT('reform', IF(is_reformulated, 1, 0), 1),
      STRUCT('apply', IF(session_applied, 1, 0), IF(is_session_first, 1, 0))
    ]) AS m
  WHERE kst_date BETWEEN DATE '2026-06-29' AND DATE '2026-07-26'
),
dev AS (
  SELECT period, arm, metric, client_id, SUM(num) AS y, SUM(den) AS n
  FROM req
  GROUP BY 1, 2, 3, 4
  HAVING n > 0
),
arm_est AS (
  SELECT
    period,
    arm,
    metric,
    COUNT(*) AS k,
    SUM(y) AS sy,
    SUM(n) AS sn,
    SAFE_DIVIDE(SUM(y), SUM(n)) AS r,
    AVG(n) AS mn,
    VAR_SAMP(y) AS vyy,
    VAR_SAMP(n) AS vnn,
    COVAR_SAMP(y, n) AS vyn
  FROM dev
  GROUP BY 1, 2, 3
),
var AS (
  SELECT *, (vyy - 2 * r * vyn + r * r * vnn) / (k * mn * mn) AS v
  FROM arm_est
)
SELECT
  c.period,
  c.metric,
  c.k AS control_devices,
  t.k AS treatment_devices,
  c.r AS control,
  t.r AS treatment,
  t.r - c.r AS diff,
  t.r - c.r - 1.96 * SQRT(c.v + t.v) AS ci_lo,
  t.r - c.r + 1.96 * SQRT(c.v + t.v) AS ci_hi,
  SAFE_DIVIDE(t.r - c.r, SQRT(c.v + t.v)) AS z
FROM var AS c
JOIN var AS t USING (period, metric)
WHERE c.arm = 'control' AND t.arm = 'treatment'
ORDER BY c.period DESC, c.metric;

-- ③ 대조: 실험 마트 vs 정제층 (실험 기간 집단별 요청·0건·클릭·세션 신청 수가 같아야 한다)
SELECT
  'mart' AS source,
  arm,
  COUNT(*) AS requests,
  COUNTIF(is_zero_result) AS zero_result,
  COUNTIF(is_clicked) AS clicked,
  COUNTIF(session_applied) AS sessions_applied
FROM marts.exp_ranker_request
WHERE kst_date BETWEEN DATE '2026-07-13' AND DATE '2026-07-26'
GROUP BY 1, 2
UNION ALL
SELECT
  'staging',
  IF(MOD(CAST(CONCAT('0x', SUBSTR(TO_HEX(MD5(client_id)), 1, 8)) AS INT64), 2) = 1, 'treatment', 'control'),
  COUNT(*),
  COUNTIF(is_zero_result),
  COUNTIF(is_clicked),
  COUNTIF(session_applied)
FROM staging.int_search
WHERE kst_date BETWEEN DATE '2026-07-13' AND DATE '2026-07-26'
GROUP BY 1, 2
ORDER BY 2, 1;
