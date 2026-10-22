#!/usr/bin/env bash
# Placewave BigQuery 파이프라인 1회 실행: raw 적재 → staging → marts → 대조 → 기록
#   bigquery/load_all.sh                 1~9단계 전부
#   bigquery/load_all.sh --skip-raw      1단계(raw 적재) 생략
#   bigquery/load_all.sh --only 7        한 단계만 (1~9)
#   bigquery/load_all.sh --match 'search|eval|label|reconciliation|freshness'
#                                        표 이름이 정규식에 맞는 적재·SQL 만 실행 (다른 단계 표는 그대로 둔다)
# BigQuery 명령은 모두 scripts/bq.sh 래퍼를 거친다(개인 프로젝트·리전 고정).
# 단계마다 ops.build_log 에 1행을 쓰고, 실패하면 그 단계를 failed 로 기록한 뒤 즉시 종료한다.
# 8단계 검사가 하나라도 어긋나면 exit 1.
# 환경 변수: NP_MAX_BYTES (단계당 청구 바이트 상한, 기본 5000000000). 넘으면 BigQuery 가 쿼리를 거부하고 단계가 실패한다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BQ="$ROOT/scripts/bq.sh"
SQL="$ROOT/bigquery/sql"
SCHEMA="$ROOT/bigquery/schema"
RAW="$ROOT/data/raw"
MAX_BYTES="${NP_MAX_BYTES:-5000000000}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"

SKIP_RAW=0
ONLY=""
MATCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-raw) SKIP_RAW=1; shift ;;
    --only) ONLY="${2:?--only 뒤에 단계 번호 1~9}"; shift 2 ;;
    --match) MATCH="${2:?--match 뒤에 표 이름 정규식}"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done

want() {  # 단계 실행 여부
  local step="$1"
  if [ -n "$ONLY" ]; then [ "$ONLY" = "$step" ]; return; fi
  if [ "$step" = 1 ] && [ "$SKIP_RAW" = 1 ]; then return 1; fi
  return 0
}

now() { date -u "+%Y-%m-%d %H:%M:%S"; }

hit() {  # --match 가 없거나 이름이 정규식에 맞으면 참
  [ -z "$MATCH" ] || printf '%s' "$1" | grep -Eq -- "$MATCH"
}

TOTAL_BYTES=0
T_START=$(date +%s)

log_row() {  # step name started ended rows bytes status message
  "$BQ" query --quiet --format=none \
    --parameter="run_id::$RUN_ID" \
    --parameter="step::$1" \
    --parameter="step_name::$2" \
    --parameter="started_at:TIMESTAMP:$3" \
    --parameter="ended_at:TIMESTAMP:$4" \
    --parameter="rows_out:INT64:$5" \
    --parameter="bytes_processed:INT64:$6" \
    --parameter="status::$7" \
    --parameter="message::$8" \
    "INSERT INTO ops.build_log (run_id, step, step_name, started_at, ended_at, rows_out, bytes_processed, status, message)
     VALUES (@run_id, @step, @step_name, @started_at, @ended_at, @rows_out, @bytes_processed, @status, NULLIF(@message, ''))" \
    >/dev/null 2>&1
}

table_rows() {  # dataset.table ... → 행 수 합 (메타데이터, 과금 없음)
  local total=0 n
  for t in "$@"; do
    n="$("$BQ" show --format=json "$t" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("numRows","0"))')"
    total=$((total + n))
  done
  echo "$total"
}

fail() {  # step name started message
  local msg
  msg="$(printf '%s' "$4" | tr '\n' ' ' | cut -c1-900)"
  log_row "$1" "$2" "$3" "$(now)" 0 0 failed "$msg" || true
  echo "[$1] $2 실패: $msg" >&2
  exit 1
}

run_sql() {  # step name file target_table...
  local step="$1" name="$2" file="$3"; shift 3
  local started t0 out job bytes rows secs
  hit "$name" || return 0
  started="$(now)"; t0=$(date +%s)
  job="np_${RUN_ID}_${step}_$(printf '%s' "$name" | tr -c 'a-zA-Z0-9_' '_')"
  if ! out="$("$BQ" query --quiet --format=none --job_id="$job" --maximum_bytes_billed="$MAX_BYTES" \
      --parameter="run_id::$RUN_ID" < "$file" 2>&1)"; then
    fail "$step" "$name" "$started" "$out"
  fi
  bytes="$("$BQ" show --format=json -j "$job" | python3 -c 'import json,sys; print(json.load(sys.stdin)["statistics"].get("totalBytesProcessed","0"))')"
  rows=0
  [ $# -gt 0 ] && rows="$(table_rows "$@")"
  secs=$(( $(date +%s) - t0 ))
  TOTAL_BYTES=$((TOTAL_BYTES + bytes))
  log_row "$step" "$name" "$started" "$(now)" "$rows" "$bytes" ok ""
  printf '[%s] %-28s ok  rows=%-9s bytes=%-11s %ss\n' "$step" "$name" "$rows" "$bytes" "$secs"
}

pick() {  # 새 이름 우선, 없으면 예전 이름
  local f
  for f in "$@"; do [ -f "$RAW/$f" ] && { echo "$RAW/$f"; return; }; done
  echo ""
}

load_raw() {
  local started t0 f out secs rows
  started="$(now)"; t0=$(date +%s)
  local loaded=()
  if hit raw.ga4_events; then
  f="$(pick ga4_events.ndjson.gz events.ndjson.gz)"
  [ -n "$f" ] || fail 1 raw "$started" "data/raw 에 이벤트 파일 없음"
  if ! out="$("$BQ" load --quiet --replace --source_format=NEWLINE_DELIMITED_JSON \
      --time_partitioning_type=DAY --time_partitioning_field=event_date --require_partition_filter=true \
      --clustering_fields=event_name \
      raw.ga4_events "$f" "$SCHEMA/ga4_events.json" 2>&1)"; then
    fail 1 raw.ga4_events "$started" "$out"
  fi
  "$BQ" update --quiet --description "행동 로그 원천 (GA4 export 단순화, 합성). 1행 = 이벤트 1건. 키 (user_pseudo_id, ga_session_id, event_timestamp, event_name). event_date(KST) 일 파티션, 파티션 필터 필수" raw.ga4_events >/dev/null 2>&1
  loaded+=(raw.ga4_events)
  fi

  local spec tbl new old desc
  for spec in \
    "db_members|db_members.csv|members.csv|서비스 RDB 회원 스냅샷. 1행 = 회원 1명. 키 member_id" \
    "db_venues|db_venues.csv|venues.csv|서비스 RDB 공간 스냅샷. 1행 = 공간 1곳. 키 venue_id" \
    "db_events|db_events.csv|events_master.csv|서비스 RDB 행사 스냅샷. 1행 = 행사 1건. 키 event_id" \
    "db_applications|db_applications.csv|applications.csv|서비스 RDB 신청 원장 스냅샷. 1행 = 신청 1건. 키 order_id" \
    "db_payments|db_payments.csv|payments.csv|서비스 RDB 결제 원장 스냅샷(티켓·구독). 1행 = 결제 1건. 키 order_id" \
    "db_venue_contracts|db_venue_contracts.csv|venue_contracts.csv|서비스 RDB 파트너 계약 스냅샷. 1행 = 계약 1건. 키 contract_id" \
    "db_venue_contract_changes|db_venue_contract_changes.csv|venue_contract_changes.csv|서비스 RDB 파트너 계약 요금제 변경 스냅샷. 1행 = 변경 1건. 키 change_id" \
    "db_subscriptions|db_subscriptions.csv|subscriptions.csv|서비스 RDB 소비자 구독 스냅샷. 1행 = 구독 1건. 키 subscription_id" \
    "eval_raters|eval_raters.csv|eval_raters.csv|평가 도구 평가자 스냅샷. 1행 = 평가자 1명. 키 rater_id" \
    "eval_batches|eval_batches.csv|eval_batches.csv|평가 도구 배치 스냅샷. 1행 = 배치 1건. 키 batch_id" \
    "eval_queries|eval_queries.csv|eval_queries.csv|평가 도구 배치 편입 검색어. 1행 = 배치 × 검색어. 키 (batch_id, query_norm)" \
    "eval_tasks|eval_tasks.csv|eval_tasks.csv|평가 도구 과제 스냅샷. 1행 = 검색어 × 후보 과제 1건. 키 task_id" \
    "eval_labels|eval_labels.csv|eval_labels.csv|평가 도구 라벨 스냅샷. 1행 = 라벨 1건. 키 label_id"; do
    IFS='|' read -r tbl new old desc <<<"$spec"
    hit "raw.$tbl" || continue
    f="$(pick "$new" "$old")"
    [ -n "$f" ] || fail 1 "raw.$tbl" "$started" "data/raw 에 $new 없음"
    if ! out="$("$BQ" load --quiet --replace --source_format=CSV --skip_leading_rows=1 \
        "raw.$tbl" "$f" "$SCHEMA/$tbl.json" 2>&1)"; then
      fail 1 "raw.$tbl" "$started" "$out"
    fi
    "$BQ" update --quiet --description "$desc (합성)" "raw.$tbl" >/dev/null 2>&1
    loaded+=("raw.$tbl")
  done

  if hit raw.search_log; then
  f="$(pick search_log.ndjson.gz)"
  [ -n "$f" ] || fail 1 raw.search_log "$started" "data/raw 에 search_log.ndjson.gz 없음"
  if ! out="$("$BQ" load --quiet --replace --source_format=NEWLINE_DELIMITED_JSON \
      --time_partitioning_type=DAY --time_partitioning_field=requested_at \
      raw.search_log "$f" "$SCHEMA/search_log.json" 2>&1)"; then
    fail 1 raw.search_log "$started" "$out"
  fi
  "$BQ" update --quiet --description "검색 서버 요청 로그 (합성). 1행 = 검색 요청 1건. 키 request_id. requested_at(UTC) 일 파티션. GA search 이벤트의 search_id 와 같은 키" raw.search_log >/dev/null 2>&1
  loaded+=(raw.search_log)
  fi

  if hit raw.search_click_log; then
  f="$(pick search_click_log.csv)"
  [ -n "$f" ] || fail 1 raw.search_click_log "$started" "data/raw 에 search_click_log.csv 없음"
  if ! out="$("$BQ" load --quiet --replace --source_format=CSV --skip_leading_rows=1 \
      --time_partitioning_type=DAY --time_partitioning_field=clicked_at \
      raw.search_click_log "$f" "$SCHEMA/search_click_log.json" 2>&1)"; then
    fail 1 raw.search_click_log "$started" "$out"
  fi
  "$BQ" update --quiet --description "검색 서버 클릭 로그 (합성). 1행 = 검색 결과 클릭 1건. 키 (request_id, clicked_at). clicked_at(UTC) 일 파티션" raw.search_click_log >/dev/null 2>&1
  loaded+=(raw.search_click_log)
  fi

  if hit raw.ads_spend; then
  f="$(pick ads_spend.csv ad_spend.csv)"
  [ -n "$f" ] || fail 1 raw.ads_spend "$started" "data/raw 에 ads_spend.csv 없음"
  if ! out="$("$BQ" load --quiet --replace --source_format=CSV --skip_leading_rows=1 \
      --time_partitioning_type=DAY --time_partitioning_field=date \
      raw.ads_spend "$f" "$SCHEMA/ads_spend.json" 2>&1)"; then
    fail 1 raw.ads_spend "$started" "$out"
  fi
  "$BQ" update --quiet --description "광고 플랫폼 일별 집행 리포트 (합성). 1행 = 캠페인 × 일. 키 (campaign_id, date). date(KST) 일 파티션" raw.ads_spend >/dev/null 2>&1
  loaded+=(raw.ads_spend)
  fi

  [ ${#loaded[@]} -gt 0 ] || return 0
  rows="$(table_rows "${loaded[@]}")"
  secs=$(( $(date +%s) - t0 ))
  log_row 1 raw "$started" "$(now)" "$rows" 0 ok "${loaded[*]}"
  printf '[1] %-28s ok  rows=%-9s bytes=%-11s %ss\n' "raw (${#loaded[@]} tables)" "$rows" 0 "$secs"
}

echo "run_id=$RUN_ID"
# ops 표 준비 (없을 때만 생성, 과금 없음)
"$BQ" query --quiet --format=none < "$SQL/00_ops_tables.sql" >/dev/null 2>&1

want 1 && load_raw
if want 2; then
  run_sql 2 staging.map_channel  "$SQL/01_map_channel.sql"  staging.map_channel
  run_sql 2 staging.map_fee_rate "$SQL/01_map_fee_rate.sql" staging.map_fee_rate
fi
want 3 && run_sql 3 staging.events_clean    "$SQL/02_events_clean.sql"    staging.events_clean
want 4 && run_sql 4 staging.int_session     "$SQL/03_int_session.sql"     staging.int_session
if want 5; then
  run_sql 5 staging.dim_subscription "$SQL/04_dim_subscription.sql" staging.dim_subscription
  run_sql 5 staging.int_person_day   "$SQL/04_int_person_day.sql"   staging.int_person_day
fi
if want 6; then
  # 계약 → 변경 → 계약 활성일 → 주문(수수료 등급) → 행사·공간 순서
  run_sql 6 staging.dim_member          "$SQL/05_dim_member.sql"          staging.dim_member
  run_sql 6 staging.dim_contract        "$SQL/06_dim_contract.sql"        staging.dim_contract
  run_sql 6 staging.dim_contract_change "$SQL/06_dim_contract_change.sql" staging.dim_contract_change
  run_sql 6 staging.int_contract_day    "$SQL/06_int_contract_day.sql"    staging.int_contract_day
  run_sql 6 staging.fct_order           "$SQL/06_fct_order.sql"           staging.fct_order
  run_sql 6 staging.dim_event           "$SQL/06_dim_event.sql"           staging.dim_event
  run_sql 6 staging.dim_venue           "$SQL/06_dim_venue.sql"           staging.dim_venue
  run_sql 6 staging.ad_spend    "$SQL/06_ad_spend.sql"    staging.ad_spend
  # 검색·평가 (시나리오 3.0): int_search 는 int_session·int_person_day 뒤
  run_sql 6 staging.int_search  "$SQL/07_int_search.sql"  staging.int_search
  run_sql 6 staging.int_label   "$SQL/07_int_label.sql"   staging.int_label
fi
if want 7; then
  # weekly_cohort·daily_revenue·daily_subscription·daily_venue_registry 는 monthly_summary 보다 먼저
  for m in daily_metrics hourly_metrics daily_channel daily_ad daily_event daily_venue \
           funnel_daily weekly_cohort monthly_cohort weekly_activity \
           daily_revenue daily_subscription daily_venue_registry venue_registry monthly_summary \
           monthly_contract contract_cohort subscription_cohort \
           weekly_audience_funnel weekly_path person_day \
           daily_search daily_query exp_ranker_request weekly_eval_ops weekly_rater weekly_batch; do
    run_sql 7 "marts.$m" "$SQL/marts/$m.sql" "marts.$m"
  done
fi
if want 8; then
  run_sql 8 ops.reconciliation "$ROOT/bigquery/checks/reconciliation.sql"
  "$BQ" query --quiet --format=pretty --parameter="run_id::$RUN_ID" \
    "SELECT check_id, check_name, ROUND(observed, 4) AS observed, lower_bound, upper_bound, passed, note
     FROM ops.reconciliation
     WHERE run_id = @run_id AND DATE(checked_at) >= CURRENT_DATE() - 1
     ORDER BY check_id"
  failed="$("$BQ" query --quiet --format=csv --parameter="run_id::$RUN_ID" \
    "SELECT COUNTIF(NOT passed) FROM ops.reconciliation
     WHERE run_id = @run_id AND DATE(checked_at) >= CURRENT_DATE() - 1" | tail -1)"
  if [ "$failed" != "0" ]; then
    echo "[8] 검사 실패 ${failed}건 (ops.reconciliation run_id=$RUN_ID)" >&2
    want 9 && run_sql 9 ops.freshness "$SQL/09_freshness.sql" ops.freshness
    exit 1
  fi
fi
want 9 && run_sql 9 ops.freshness "$SQL/09_freshness.sql" ops.freshness

echo "done run_id=$RUN_ID total_bytes=$TOTAL_BYTES elapsed=$(( $(date +%s) - T_START ))s"
