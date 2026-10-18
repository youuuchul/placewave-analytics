-- 표: marts.daily_query — 검색어별 일 집계
-- 1행: 일(KST) × query_norm × channel1 × device_platform × member_seg
-- 키: 이 다섯 열
-- 파티션·클러스터: kst_date / query_norm
-- 원천: staging.int_search, raw.eval_queries
-- 소비: 검색 탭 실패 검색어 표
--
-- 실패 검색어(화면 판정) = 기간 안 검색 20건 이상이고 결과 0건 비율 30% 이상. 기간이 화면에서 정해지므로 판정은 저장하지 않는다.
-- first_eval_date·first_failed_eval_date·failed_eval_dates 는 검색어 속성(모든 행에 같은 값). 평가 배치에 처음 편입된 날 /
-- 실패 검색어 출처로 처음 편입된 날 / 실패 출처로 편입된 날 전부(화면은 기간 시작 ~ 기간 끝 + 7일 안의 첫 날을 평가 편입일로 쓴다 —
-- 실패가 반복되면 그때의 편입을 본다).

CREATE OR REPLACE TABLE marts.daily_query (
  kst_date DATE OPTIONS(description='날짜 (KST, 세션 시작일). 일 파티션'),
  query_norm STRING OPTIONS(description='정규화 검색어'),
  channel1 STRING OPTIONS(description='세그먼트: 첫 유입 paid / non_paid'),
  device_platform STRING OPTIONS(description='세그먼트: 첫 방문 기기 플랫폼 ios / android / web'),
  member_seg STRING OPTIONS(description='세그먼트: 그날 0시 기준 member / guest'),
  query_intent STRING OPTIONS(description='의도 유형'),
  searches INT64 OPTIONS(description='검색 요청 수'),
  zero_result_searches INT64 OPTIONS(description='결과 0건 요청 수'),
  ga_matched_searches INT64 OPTIONS(description='GA 매칭 요청 수'),
  clicked_searches INT64 OPTIONS(description='결과 클릭 요청 수'),
  reformulated_searches INT64 OPTIONS(description='재검색 요청 수'),
  first_eval_date DATE OPTIONS(description='검색어 속성: 평가 배치에 처음 편입된 날. 없으면 NULL'),
  first_failed_eval_date DATE OPTIONS(description='검색어 속성: 실패 검색어 출처(failed)로 처음 편입된 날. 없으면 NULL'),
  failed_eval_dates STRING OPTIONS(description='검색어 속성: 실패 검색어 출처(failed)로 편입된 날 전부(YYYY-MM-DD 오름차순, 쉼표 구분). 없으면 NULL')
)
PARTITION BY kst_date
CLUSTER BY query_norm
OPTIONS(description='검색어별 일 집계. 1행 = 일 × 정규화 검색어 × channel1 × device_platform × member_seg. 원천 staging.int_search, raw.eval_queries')
AS
WITH ev AS (
  SELECT
    query_norm,
    MIN(sampled_at) AS first_eval_date,
    MIN(IF(source = 'failed', sampled_at, NULL)) AS first_failed_eval_date,
    STRING_AGG(DISTINCT IF(source = 'failed', FORMAT_DATE('%F', sampled_at), NULL), ',' ORDER BY IF(source = 'failed', FORMAT_DATE('%F', sampled_at), NULL)) AS failed_eval_dates
  FROM raw.eval_queries
  GROUP BY 1
)
SELECT
  s.kst_date,
  s.query_norm,
  s.channel1,
  s.device_platform,
  s.member_seg,
  ANY_VALUE(s.query_intent) AS query_intent,
  COUNT(*) AS searches,
  COUNTIF(s.is_zero_result) AS zero_result_searches,
  COUNTIF(s.ga_matched) AS ga_matched_searches,
  COUNTIF(s.is_clicked) AS clicked_searches,
  COUNTIF(s.is_reformulated) AS reformulated_searches,
  ANY_VALUE(ev.first_eval_date) AS first_eval_date,
  ANY_VALUE(ev.first_failed_eval_date) AS first_failed_eval_date,
  ANY_VALUE(ev.failed_eval_dates) AS failed_eval_dates
FROM staging.int_search AS s
LEFT JOIN ev USING (query_norm)
WHERE s.kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
GROUP BY 1, 2, 3, 4, 5;
