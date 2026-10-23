-- 표: marts.ranker_query_eval — 검색어 해석 오프라인 평가 (랭킹 A/B 설계서 기준선 2주)
-- 1행: 검색어 1개 (2026-06-22 ~ 07-05 요청에 나온 검색어)
-- 키: query_norm
-- 파티션·클러스터: 없음 / 없음
-- 원천: staging.int_search (기준선 2주 요청, 전부 기존 랭킹), raw.ml_query_parse (새 해석)
-- 소비: 보고서 랭킹 모델 설계·오프라인 평가(기존 0건 중 새 해석이 정식 이름에 연결하는 비율, 해석 뒤 예상 0건). ops.reconciliation
-- 검사: I11
--
-- 기준선 기간은 실험 설계서와 같다(세션 시작일 2026-06-22 ~ 07-05). 그때는 모든 요청이 기존 랭킹(v1)이다.
-- 새 해석으로 정식 이름이 나오면 결과가 있다고 본다(정식 이름에 보이는 후보가 없는 경우는 드물어 셈하지 않는다).

CREATE OR REPLACE TABLE marts.ranker_query_eval (
  query_norm STRING OPTIONS(description='정규화 검색어'),
  query_intent STRING OPTIONS(description='새 해석 의도 유형. other = 해석 못 함'),
  query_term STRING OPTIONS(description='새 해석 정식 이름. 해석 못 하면 NULL'),
  v1_match BOOL OPTIONS(description='기존 랭킹 기준 정식 이름과 같은 검색어'),
  requests INT64 OPTIONS(description='기준선 2주 서버 검색 요청 수'),
  zero_results INT64 OPTIONS(description='그중 기존 랭킹이 결과 0건을 준 요청 수')
)
OPTIONS(description='검색어 해석 오프라인 평가. 1행 = 검색어. 키 query_norm. 원천 staging.int_search(2026-06-22~07-05)·raw.ml_query_parse. 기존 랭킹 0건과 새 해석 결과')
AS
SELECT
  s.query_norm,
  q.query_intent,
  q.query_term,
  q.v1_match,
  COUNT(*) AS requests,
  COUNTIF(s.is_zero_result) AS zero_results
FROM staging.int_search AS s
JOIN raw.ml_query_parse AS q USING (query_norm)
WHERE s.kst_date BETWEEN DATE '2026-06-22' AND DATE '2026-07-05'
GROUP BY 1, 2, 3, 4;
