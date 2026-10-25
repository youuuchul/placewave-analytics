# 파이프라인 운영

`bigquery/load_all.sh` 한 번으로 원천 적재부터 대조·기록까지 돈다. 설계 기준은 [architecture.md](architecture.md), 지표 정의는 [metrics.md](metrics.md).

## 실행

```bash
scripts/bq.sh login                    # 최초 1회 (개인 GCP 계정)
bigquery/load_all.sh                   # 1~9단계 전부
bigquery/load_all.sh --skip-raw        # 적재 생략, 2단계부터
bigquery/load_all.sh --only 7          # 한 단계만 (1~9)
```

- BigQuery 명령은 모두 `scripts/bq.sh` 를 거친다. GCP 프로젝트 ID `nightpulse-analytics`(초기 명칭 유지), 리전 `asia-northeast3` 가 래퍼에 고정돼 있다.
- 입력은 생성기 출력 `data/raw/` 10개 파일(이벤트 NDJSON 1 + RDB CSV 8 + 광고 CSV 1), 스키마는 `bigquery/schema/<표>.json`.
- 단계마다 stdout 한 줄(`[단계] 표 ok rows=… bytes=… 초`)과 `ops.build_log` 1행을 남긴다. 실행 ID(`run_id`)는 시작 시각(UTC)이다.

## 단계

단계별 파일·표·실행 순서와 표 카탈로그(그레인·키·파티션·원천·소비)는 [bigquery/README.md](../bigquery/README.md). 그 문서는 SQL 머리 주석에서 생성되고, 생성할 때 주석·SQL 본문·BigQuery 실물을 대조한다.

```bash
python3 bigquery/build_catalog.py      # 카탈로그 재생성 (어긋나면 exit 1)
python3 bigquery/build_catalog.py --export dashboard/public/catalog.json   # + 데이터 페이지용 표·컬럼 JSON
```

모든 단계가 멱등이다. 같은 입력이면 같은 표가 나오고, `ops.build_log`·`ops.reconciliation` 만 실행마다 누적된다. 0단계(`ops` 표 준비)는 매 실행 앞에 없을 때만 만든다.

## 재실행

| 상황 | 명령 |
|---|---|
| 생성기를 다시 돌렸다 | `bigquery/load_all.sh` |
| 채널 규칙만 바꿨다 (`01_map_channel.sql`) | `--only 2` 후 `--skip-raw` (4단계부터 다시 계산돼야 한다) |
| 수수료율만 바꿨다 (`01_map_fee_rate.sql`) | `--only 2` → `--only 6` → `--only 7` → `--only 8` (주문 원장 수수료부터 마트까지) |
| 마트 SQL 하나를 고쳤다 | `--only 7` 후 `--only 8` |
| 검사 기준만 바꿨다 | `--only 8` |
| 라벨이 바뀌었다(순위 모델 다시 학습) | `--only 6 --match ml_ranker_pairs` → `uv run --group ml python -m ranker.train` → `--match 'raw.ml_|marts.ranker'` → `--only 8` (학습 쌍과 채점이 어긋나면 검사 C22·C23 이 실패한다) |

`--only` 는 앞 단계 결과가 이미 있다고 가정한다. 상위 표를 고쳤으면 그 단계부터 끝까지 돌리는 편이 안전하다(`--skip-raw` 는 2단계부터 전부).

## 실패 시 조치

| 증상 | 확인 | 조치 |
|---|---|---|
| `[1] raw… 실패: data/raw 에 … 없음` | 생성기 출력 파일명 | 생성기 재실행. 적재는 새 이름 우선, 이전 이름(`events.ndjson.gz` 등)도 받는다 |
| `[1]` 적재 오류 (스키마·형식) | 오류 메시지의 열 이름 | `bigquery/schema/*.json` 과 CSV 헤더 대조 |
| `[n] … 실패: … bytesBilled` | `NP_MAX_BYTES` (기본 5GB) | 날짜 필터·열 선택을 먼저 줄인다. 상한을 올리는 건 마지막 |
| `… Cannot replace a table with a different partitioning spec` 류 | 표의 파티션·클러스터 설정을 바꿨다 | `CREATE OR REPLACE` 는 설정 변경을 거부한다. `scripts/bq.sh rm -f -t <데이터셋>.<표>` 로 그 표만 지우고 해당 단계를 다시 돌린다 |
| `[8] 차단 검사 실패 k건` | 아래 첫 쿼리 | C(대조)는 SQL 버그, I(무결성)는 원천 문제일 가능성이 크다. C9 는 결제 원장에 신청이 없는 티켓 결제·부분 환불, C14 는 수수료 등급 누락(`fee_tier` NULL), C15 는 계약 기간 밖 요금제 변경·`from_fee` 가 직전 요금과 다른 변경, C10·C11 은 활성 규칙·날짜(KST) 변환 차이부터 본다 |
| `[8] 경보 k건: 범위 밖 지표` | 아래 첫 쿼리 | R(범위)은 수집 누락(R12)·정의 오류·생성기 보정부터 본다. 경보라 파이프라인은 계속 돈다 |
| `extract.py`: `차단 검사 실패` · `1~7단계가 n번 다시 돌았다` · `검사 기록이 없다` | 메시지의 run | 화면 데이터를 쓰지 않고 멈춘 상태다. 차단 실패는 위 조치 뒤 다시 적재·검사하고, 검사 뒤 마트를 다시 만들었으면 `load_all.sh --only 8` 을 돌린 뒤 추출한다 |

```sql
-- 마지막 실행의 실패 항목
SELECT check_id, check_name, left_value, right_value, observed, lower_bound, upper_bound, note
FROM ops.reconciliation
WHERE DATE(checked_at) >= CURRENT_DATE() - 1
  AND run_id = (SELECT MAX(run_id) FROM ops.reconciliation WHERE DATE(checked_at) >= CURRENT_DATE() - 1)
  AND NOT passed;

-- 단계별 시간·바이트
SELECT step, step_name, TIMESTAMP_DIFF(ended_at, started_at, SECOND) AS sec, rows_out, bytes_processed, status, message
FROM ops.build_log
WHERE DATE(started_at) >= CURRENT_DATE() - 1
ORDER BY started_at;
```

실패한 단계는 `ops.build_log` 에 `status = 'failed'` 와 오류 요약으로 남고 스크립트는 즉시 멈춘다. 이전 단계 표는 그대로다. 원인을 고친 뒤 그 단계부터 다시 돌린다.

## 검사 (8단계)

검사 46개의 ID·통과 기준·대상 표·최근 관측값은 [bigquery/README.md § 검사](../bigquery/README.md#검사)(목적별 묶음). 대조 C 25개 · 무결성 I 11개는 차단 검사다. 하나라도 통과하지 못하면 `load_all.sh` 가 exit 1 이고, `dashboard/scripts/extract.py` 는 마지막 검사 실행에 차단 실패가 있거나 그 뒤 1~7단계가 다시 돌았으면 추출을 거부한다. 범위 R 10개는 경보 검사로, 범위 밖 건수만 출력하고 계속한다. 범위 검사(R)의 분자·분모 정의는 [metrics.md](metrics.md) 의 해당 지표와 같다.

## 비용

전체 실행 1회에 쿼리 처리량 약 10GB(표 61개, `ops.build_log` 단계별 마지막 성공 기록의 합, 2026-10-19 확인 — 그중 시나리오 3.0 표 약 0.9GB, 검사 `ops.reconciliation` 약 0.8GB). 처음 측정한 표 41개 시점에는 약 7.3GB(정제 2.2GB·세션 1.4GB가 대부분)였다. 단계당 상한 `NP_MAX_BYTES` 기본 5GB. 적재는 무료다. 무료 한도(월 1TB 쿼리·10GB 저장) 안에서 하루 여러 번 돌려도 된다.

| 단계 | 처리량 | 비고 |
|---|---:|---|
| 3 `events_clean` | 약 220MB | 원천 전 열을 한 번 읽는 유일한 단계 |
| 4 `int_session` | 약 140MB | 정제 이벤트 전체 |
| 7 `daily_event` · `daily_venue` | 각 약 60MB | 정제 이벤트에서 필요한 열만 |
| 7 `weekly_path` | 약 68MB | 정제 이벤트 `screen_view` 만, 필요한 열만 |
| 나머지 | 각 25MB 이하 | |

- 이벤트 표(`raw.ga4_events`, `staging.events_clean`)는 일 파티션 + 파티션 필터 필수다. 전체 재생성 SQL도 기간을 명시한다.
- 단계마다 `--maximum_bytes_billed` 상한(`NP_MAX_BYTES`, 기본 5GB)이 걸려 있어 상한을 넘는 쿼리는 실행되지 않는다.
- 마트·중간 표는 날짜 파티션과 세그먼트 클러스터를 둔다. 화면 조회는 기간 필터로 파티션만 읽는다.

## 운영 가정

실제 서비스라면 GA4 export(오전 도착)와 RDB 야간 스냅샷 이후 예약 실행이 1~9단계를 하루 한 번 돌리고, 원천이 늦으면 대기 후 재시도한다. 이 저장소는 로컬 1회 실행만 지원한다.
