-- raw 층 표 머리 주석. 실행하지 않는다 — 적재는 load_all.sh 1단계, 열 정의는 같은 폴더 <표>.json.
-- 표 설명(description)은 load_all.sh 가 적재 직후 붙이는 문구와 같다.

-- 표: raw.ga4_events — 행동 로그 원천 (GA4 export 단순화, 합성)
-- 1행: 이벤트 1건
-- 키: (user_pseudo_id, ga_session_id, event_timestamp, event_name)
-- 파티션·클러스터: event_date / event_name
-- 원천: data/raw/ga4_events.ndjson.gz (생성기 출력). event_date 는 KST, 파티션 필터 필수
-- 소비: staging.map_channel·events_clean

-- 표: raw.db_members — 서비스 RDB 회원 스냅샷 (합성)
-- 1행: 회원 1명
-- 키: member_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/db_members.csv (생성기 출력)
-- 소비: staging.int_person_day·dim_member

-- 표: raw.db_venues — 서비스 RDB 공간 스냅샷 (합성)
-- 1행: 공간 1곳
-- 키: venue_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/db_venues.csv (생성기 출력). 상권·구·좌표·등록일·상태 포함
-- 소비: staging.dim_event·dim_venue·int_search, ops.reconciliation

-- 표: raw.db_events — 서비스 RDB 행사 스냅샷 (합성)
-- 1행: 행사 1건
-- 키: event_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/db_events.csv (생성기 출력). 정원·가격대·가격·개최 시점 파트너 여부 포함
-- 소비: staging.dim_event·dim_venue·fct_order·int_search

-- 표: raw.db_applications — 서비스 RDB 신청 원장 스냅샷 (합성)
-- 1행: 신청 1건
-- 키: order_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/db_applications.csv (생성기 출력)
-- 소비: staging.fct_order, ops.reconciliation

-- 표: raw.db_payments — 서비스 RDB 결제 원장 스냅샷 (합성)
-- 1행: 결제 1건
-- 키: order_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/db_payments.csv (생성기 출력). kind = ticket / subscription, 할인액·구독 ID 포함
-- 소비: staging.fct_order·dim_subscription, ops.reconciliation

-- 표: raw.db_venue_contracts — 서비스 RDB 파트너 계약 스냅샷 (합성)
-- 1행: 계약 1건
-- 키: contract_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/db_venue_contracts.csv (생성기 출력). ended_at NULL = 진행 중
-- 소비: staging.dim_contract

-- 표: raw.db_venue_contract_changes — 서비스 RDB 파트너 계약 요금제 변경 스냅샷 (합성)
-- 1행: 요금제 변경 1건
-- 키: change_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/db_venue_contract_changes.csv (생성기 출력). changed_at(UTC, KST 자정)부터 to_plan·to_fee 적용
-- 소비: staging.dim_contract_change

-- 표: raw.db_subscriptions — 서비스 RDB 소비자 구독 스냅샷 (합성)
-- 1행: 구독 1건
-- 키: subscription_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/db_subscriptions.csv (생성기 출력). ended_at NULL = 진행 중
-- 소비: staging.dim_subscription, ops.reconciliation

-- 표: raw.ads_spend — 광고 플랫폼 일별 집행 리포트 (합성)
-- 1행: 캠페인 × 일
-- 키: (campaign_id, date)
-- 파티션·클러스터: date / 없음
-- 원천: data/raw/ads_spend.csv (생성기 출력). date 는 KST
-- 소비: staging.ad_spend

-- 표: raw.search_log — 검색 서버 요청 로그 (합성)
-- 1행: 검색 요청 1건
-- 키: request_id
-- 파티션·클러스터: requested_at / 없음
-- 원천: data/raw/search_log.ndjson.gz (generator/generate.py 세션 시뮬레이션 출력). GA search 이벤트의 search_id 파라미터와 같은 키, ga_session_id 로 세션 연결
-- 소비: staging.int_search, ops.reconciliation

-- 표: raw.search_click_log — 검색 서버 클릭 로그 (합성)
-- 1행: 검색 결과 클릭 1건
-- 키: (request_id, clicked_at)
-- 파티션·클러스터: clicked_at / 없음
-- 원천: data/raw/search_click_log.csv (generator/generate.py 세션 시뮬레이션 출력). 클릭 추적 엔드포인트 기록
-- 소비: staging.int_search, ops.reconciliation

-- 표: raw.eval_raters — 평가 도구 평가자 스냅샷 (합성)
-- 1행: 평가자 1명
-- 키: rater_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/eval_raters.csv (generator/search_eval.py 출력)
-- 소비: staging.int_label

-- 표: raw.eval_batches — 평가 도구 배치 스냅샷 (합성)
-- 1행: 배치 1건
-- 키: batch_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/eval_batches.csv (generator/search_eval.py 출력). 요청 부서·목적·지침 버전·목표·마감·우선순위
-- 소비: staging.int_label, marts.weekly_batch, ops.reconciliation

-- 표: raw.eval_queries — 평가 배치에 편입된 검색어 (합성)
-- 1행: 배치 × 검색어
-- 키: (batch_id, query_norm)
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/eval_queries.csv (generator/search_eval.py 출력). 출처 failed / head / random / promoted
-- 소비: marts.daily_query, ops.reconciliation

-- 표: raw.eval_tasks — 평가 도구 과제 스냅샷 (합성)
-- 1행: 검색어 × 후보 과제 1건
-- 키: task_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/eval_tasks.csv (generator/search_eval.py 출력). 정답셋 과제는 정답 등급 포함
-- 소비: staging.int_label, ops.reconciliation

-- 표: raw.eval_labels — 평가 도구 라벨 스냅샷 (합성)
-- 1행: 라벨 1건
-- 키: label_id
-- 파티션·클러스터: 없음 / 없음
-- 원천: data/raw/eval_labels.csv (generator/search_eval.py 출력). 재작업 라벨 포함
-- 소비: staging.int_label, ops.reconciliation
