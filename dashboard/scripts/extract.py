"""BigQuery 마트 → dashboard/public/data/ 분할 추출기.

marts 데이터셋의 표 26개를 개인 GCP 래퍼(scripts/bq.sh)로 읽어 분할 파일로 쓴다.
조회는 SELECT 뿐이며 표를 만들거나 바꾸지 않는다. 마트가 적재된 뒤에 실행한다.

    uv run dashboard/scripts/extract.py
    uv run dashboard/scripts/extract.py --from-json /tmp/sample.json   # BigQuery 없이 합친 JSON 을 분할만

출력(계약은 docs/dashboard.md §4):
    index.json                     meta + files + 첫 화면 표(고정 이름)
    <표>.<해시8>.json              지연 표(행 배열)
    person_day.<해시8>.bin         행당 8바이트 고정 바이너리
    person_day.<해시8>.pdz         위 바이너리의 gzip -9(전송용, 로더가 브라우저에서 푼다)
    person_day.meta.<해시8>.json   base_date·codes·rows·비트 배치
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import subprocess
import sys
from array import array
from datetime import UTC, date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BQ = ROOT / "scripts" / "bq.sh"
DATASET = "marts"

SEG = ["channel1", "device_platform", "member_seg"]

# 화면이 필요할 때 따로 받는 표. 나머지 표는 index.json 에 넣는다.
LAZY = ["hourly_metrics", "daily_channel", "daily_venue", "daily_event", "weekly_path", "daily_search", "daily_query"]

# person_day.bin 비트 배치: (필드, 워드, 시작 비트, 비트 수). 리틀엔디언 Uint32 2개 = 행당 8바이트.
PD_BITS = [("pk", 0, 0, 20), ("d", 0, 20, 9), ("c", 0, 29, 1), ("p", 0, 30, 2), ("m", 1, 0, 1), ("f", 1, 1, 16)]
HASHED = re.compile(r"^[a-z_]+(\.meta)?\.[0-9a-f]{8}\.(json|bin|pdz)$")

# 표 이름 → (열 목록, 정렬 열). 열 이름은 docs/architecture.md §2 marts 와 docs/dashboard.md 계약을 따른다.
TABLES: dict[str, tuple[list[str], list[str]]] = {
    "daily_search": (
        [
            "kst_date",
            "query_intent",
            "ranker_version",
            *SEG,
            "searches",
            "zero_result_searches",
            "ga_matched_searches",
            "matched_result_searches",
            "clicked_searches",
            "first_click_position_sum",
            "first_click_position_sq_sum",
            "top3_clicks",
            "reformulated_searches",
            "search_sessions",
            "search_sessions_applied",
        ],
        ["kst_date", "query_intent", "ranker_version"],
    ),
    "daily_query": (
        [
            "kst_date",
            "query_norm",
            *SEG,
            "query_intent",
            "searches",
            "zero_result_searches",
            "ga_matched_searches",
            "clicked_searches",
            "reformulated_searches",
            "failed_eval_dates",
        ],
        ["kst_date", "query_norm"],
    ),
    "weekly_eval_ops": (
        [
            "week_start",
            "requester",
            "rater_group",
            "guideline_version",
            "labels",
            "rework_labels",
            "handle_seconds",
            "gold_labels",
            "gold_correct",
            "final_labels",
            "label_pairs",
            "agree_pairs",
            "labels_g0",
            "labels_g1",
            "labels_g2",
            "labels_g3",
            "tasks_completed",
        ],
        ["week_start", "requester", "rater_group", "guideline_version"],
    ),
    "weekly_rater": (
        [
            "week_start",
            "rater_id",
            "requester",
            "rater_group",
            "labels",
            "rework_labels",
            "handle_seconds",
            "gold_labels",
            "gold_correct",
            "label_pairs",
            "agree_pairs",
        ],
        ["week_start", "rater_id", "requester"],
    ),
    "weekly_batch": (
        [
            "week_start",
            "batch_id",
            "requester",
            "purpose",
            "guideline_version",
            "priority",
            "created_date",
            "due_date",
            "as_of_date",
            "target_tasks",
            "done_tasks",
            "done_in_week",
            "remaining_tasks",
            "recent_done_14d",
            "days_to_due",
        ],
        ["week_start", "batch_id"],
    ),
    "daily_metrics": (
        [
            "kst_date",
            *SEG,
            "persons",
            "new_persons",
            "sessions",
            "engaged_sessions",
            "explorers",
            "detail_viewers",
            "signups",
            "apply_viewers",
            "applies",
            "payers",
            "pay_count",
            "pay_amount",
            "cancels",
            "subscribers",
            "sub_payers",
        ],
        ["kst_date"],
    ),
    "hourly_metrics": (
        ["kst_date", "kst_hour", *SEG, "persons", "sessions", "applies", "pay_count"],
        ["kst_date", "kst_hour"],
    ),
    "daily_channel": (
        [
            "kst_date",
            "channel1",
            "channel2",
            "channel3",
            "device_platform",
            "member_seg",
            "sessions",
            "persons",
            "new_persons",
            "signups",
            "applies",
            "payers",
            "pay_amount",
        ],
        ["kst_date"],
    ),
    "daily_ad": (
        [
            "kst_date",
            "campaign_id",
            "campaign_name",
            "spend",
            "impressions",
            "clicks",
            "sessions",
            "persons",
            "new_persons",
            "active_persons",
            "signups",
            "applies",
            "payers",
            "pay_amount",
        ],
        ["kst_date", "campaign_id"],
    ),
    "daily_event": (
        [
            "kst_date",
            "event_id",
            "event_name",
            "venue_name",
            "event_type",
            "price_tier",
            "detail_viewers",
            "applies",
            "pay_count",
            "pay_amount",
            "cancels",
        ],
        ["kst_date", "event_id"],
    ),
    "daily_venue": (
        ["kst_date", "venue_id", "venue_name", "region", "genre", "detail_viewers", "applies", "pay_count"],
        ["kst_date", "venue_id"],
    ),
    "funnel_daily": (["kst_date", "step", *SEG, "persons"], ["kst_date"]),
    "weekly_cohort": (
        ["cohort_week", "week_offset", *SEG, "cohort_size", "retained"],
        ["cohort_week", "week_offset"],
    ),
    "monthly_cohort": (
        ["cohort_month", "month_offset", "member_seg", "cohort_size", "retained"],
        ["cohort_month", "month_offset"],
    ),
    "weekly_activity": (
        ["week_start", *SEG, "wau", "new_persons", "returning_persons", "two_plus_days"],
        ["week_start"],
    ),
    "weekly_audience_funnel": (
        ["week_start", "audience_id", "step", *SEG, "persons"],
        ["week_start", "audience_id"],
    ),
    "weekly_path": (
        ["week_start", *SEG, "step", "from_screen", "to_screen", "sessions"],
        ["week_start", "step"],
    ),
    "monthly_summary": (
        [
            "month",
            "persons",
            "new_persons",
            "signups",
            "applies",
            "pay_count",
            "pay_amount",
            "cancels",
            "w1_retention",
            "top_channel",
            "gmv_amount",
            "fee_amount",
            "membership_amount",
            "partner_plan_amount",
            "platform_revenue",
            "ad_spend",
            "active_subscribers_eom",
            "partner_total_eom",
            "registered_total_eom",
        ],
        ["month"],
    ),
    "daily_revenue": (
        [
            "kst_date",
            "kind",
            "fee_tier",
            "pay_count",
            "gmv_amount",
            "paid_amount",
            "discount_amount",
            "refund_count",
            "refund_amount",
            "net_amount",
            "payers",
        ],
        ["kst_date", "kind", "fee_tier"],
    ),
    "daily_subscription": (
        [
            "kst_date",
            "active_subscribers",
            "new_subscribers",
            "churned_subscribers",
            "mrr",
            "subscriber_ticket_payers",
            "subscriber_ticket_amount",
            "discount_amount",
        ],
        ["kst_date"],
    ),
    "daily_venue_registry": (
        [
            "kst_date",
            "region",
            "registered_total",
            "partner_total",
            "new_registered",
            "new_contracts",
            "churned_contracts",
            "mrr_basic",
            "mrr_pro",
        ],
        ["kst_date", "region"],
    ),
    "venue_registry": (
        [
            "venue_id",
            "name",
            "region",
            "district",
            "lat",
            "lng",
            "genre",
            "venue_type",
            "capacity_band",
            "registered_at",
            "is_partner",
            "plan",
            "contract_started_at",
            "contract_ended_at",
            "events_365d",
            "ticket_amount_365d",
            "detail_viewers_28d",
            "status",
            "as_of_date",
        ],
        ["venue_id"],
    ),
    "monthly_contract": (
        [
            "month",
            "plan",
            "contracts_bom",
            "new_contracts",
            "churned_contracts",
            "upgrades",
            "downgrades",
            "contracts_eom",
            "mrr_bom",
            "mrr_new",
            "mrr_expansion",
            "mrr_contraction",
            "mrr_churn",
            "mrr_eom",
            "arpa",
        ],
        ["month", "plan"],
    ),
    "contract_cohort": (
        ["cohort_month", "month_offset", "cohort_size", "retained", "mrr_retained"],
        ["cohort_month", "month_offset"],
    ),
    "subscription_cohort": (
        ["cohort_month", "month_offset", "cohort_size", "retained"],
        ["cohort_month", "month_offset"],
    ),
}

STRING_COLS = {
    "kst_date",
    "cohort_week",
    "week_start",
    "cohort_month",
    "month",
    "step",
    "channel1",
    "channel2",
    "channel3",
    "device_platform",
    "member_seg",
    "campaign_id",
    "campaign_name",
    "event_name",
    "venue_name",
    "event_type",
    "price_tier",
    "region",
    "genre",
    "top_channel",
    "audience_id",
    "from_screen",
    "to_screen",
    "kind",
    "fee_tier",
    "name",
    "district",
    "venue_type",
    "capacity_band",
    "registered_at",
    "plan",
    "contract_started_at",
    "contract_ended_at",
    "status",
    "as_of_date",
    "query_intent",
    "ranker_version",
    "query_norm",
    "first_eval_date",
    "first_failed_eval_date",
    "failed_eval_dates",
    "requester",
    "rater_group",
    "guideline_version",
    "rater_id",
    "batch_id",
    "purpose",
    "created_date",
    "due_date",
}
FLOAT_COLS = {"w1_retention", "lat", "lng"}
BOOL_COLS = {"is_partner"}
MONTH_COLS = {"cohort_month", "month"}
# 표마다 타입이 다른 열: weekly_path.step 은 정수 1~4 (funnel_daily.step 은 문자열)
INT_OVERRIDE: dict[str, set[str]] = {"weekly_path": {"step"}}


def query(sql: str) -> list[dict]:
    """bq.sh 래퍼로 SELECT 를 실행하고 JSON 행을 돌려준다.

    Args:
        sql: 표준 SQL SELECT 문.

    Returns:
        행 목록. bq JSON 출력은 모든 값을 문자열로 준다.
    """
    res = subprocess.run(
        [str(BQ), "query", "--format=json", "--max_rows=2000000", "--quiet", sql],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(res.stdout or "[]")


def coerce(col: str, value: str | None, table: str = "") -> object:
    """bq 문자열 값을 계약 타입으로 바꾼다.

    Args:
        col: 열 이름.
        value: bq 가 준 값.
        table: 표 이름. INT_OVERRIDE 판정에 쓴다.

    Returns:
        문자열·정수·실수·불리언 또는 None.
    """
    if value is None:
        return None
    if col in INT_OVERRIDE.get(table, set()):
        return int(value)
    if col in MONTH_COLS:
        return str(value)[:7]
    if col in STRING_COLS:
        return str(value)
    if col in FLOAT_COLS:
        return float(value)
    if col in BOOL_COLS:
        return str(value).lower() == "true"
    return int(value)


def person_day() -> dict:
    """marts.person_day 를 열 배열 형식으로 압축한다.

    d 는 base_date 로부터의 일수, c·p·m 은 codes 의 인덱스, f 는 플래그 비트 정수다.

    Returns:
        {"base_date", "cols", "codes", "rows"} 사전.
    """
    rows = query(
        "SELECT CAST(kst_date AS STRING) AS kst_date, person_key, channel1, device_platform, member_seg, flags "
        f"FROM {DATASET}.person_day ORDER BY kst_date, person_key"
    )
    if not rows:
        raise SystemExit("person_day 가 비어 있다 — 마트 적재를 먼저 확인")
    codes = {
        "c": sorted({r["channel1"] for r in rows}),
        "p": sorted({r["device_platform"] for r in rows}),
        "m": sorted({r["member_seg"] for r in rows}),
    }
    idx = {k: {v: i for i, v in enumerate(vs)} for k, vs in codes.items()}
    base = date.fromisoformat(rows[0]["kst_date"])
    packed = [
        [
            int(r["person_key"]),
            (date.fromisoformat(r["kst_date"]) - base).days,
            idx["c"][r["channel1"]],
            idx["p"][r["device_platform"]],
            idx["m"][r["member_seg"]],
            int(r["flags"]),
        ]
        for r in rows
    ]
    return {"base_date": base.isoformat(), "cols": ["pk", "d", "c", "p", "m", "f"], "codes": codes, "rows": packed}


def fetch() -> dict:
    """마트를 읽어 합친 사전(meta + 표 + person_day)을 만든다.

    Returns:
        {"meta", <표>: 행 배열, "person_day": 열 배열 사전}.
    """
    out: dict[str, object] = {}
    for table, (cols, order) in TABLES.items():
        ints = INT_OVERRIDE.get(table, set())
        select = ", ".join(f"CAST({c} AS STRING) AS {c}" if c in STRING_COLS and c not in ints else c for c in cols)
        sql = f"SELECT {select} FROM {DATASET}.{table} ORDER BY {', '.join(order)}"
        rows = query(sql)
        out[table] = [{c: coerce(c, r.get(c), table) for c in cols} for r in rows]
        print(f"{table:22s} {len(out[table]):>8,d}")

    out["person_day"] = person_day()
    print(f"{'person_day':22s} {len(out['person_day']['rows']):>8,d}")

    dates = [r["kst_date"] for r in out["daily_metrics"]]
    if not dates:
        raise SystemExit("daily_metrics 가 비어 있다 — 마트 적재를 먼저 확인")
    meta = {
        "to_date": max(dates),
        "from_date": min(dates),
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": "bigquery",
        "tables": {k: len(v["rows"]) if isinstance(v, dict) else len(v) for k, v in out.items()},
    }
    return {"meta": meta, **out}


def pack_person_day(pd: dict) -> tuple[bytes, dict]:
    """열 배열 person_day 를 행당 8바이트 바이너리와 메타로 바꾼다.

    Args:
        pd: {"base_date", "cols", "codes", "rows"} 사전. rows 는 날짜·사람 키 순.

    Returns:
        (바이너리, 메타 사전).
    """
    ix = {c: pd["cols"].index(c) for c in ("pk", "d", "c", "p", "m", "f")}
    words = array("I")
    if words.itemsize != 4:
        raise SystemExit("array('I') 가 4바이트가 아니다")
    for r in pd["rows"]:
        w = [0, 0]
        for name, wi, lo, n in PD_BITS:
            v = r[ix[name]]
            if not 0 <= v < (1 << n):
                raise SystemExit(f"person_day.{name}={v} 가 {n}비트를 넘는다 — PD_BITS 를 늘린다")
            w[wi] |= v << lo
        words.extend(w)
    if sys.byteorder == "big":
        words.byteswap()
    meta = {
        "base_date": pd["base_date"],
        "codes": pd["codes"],
        "rows": len(pd["rows"]),
        "row_bytes": 8,
        "layout": [{"field": f, "word": w, "shift": lo, "bits": n} for f, w, lo, n in PD_BITS],
    }
    return words.tobytes(), meta


def dump(obj: object) -> bytes:
    """계약 JSON 직렬화(공백 없음, 한글 그대로)."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def hashed(stem: str, body: bytes, ext: str) -> str:
    """내용 해시 8자리를 붙인 파일 이름."""
    return f"{stem}.{hashlib.sha256(body).hexdigest()[:8]}.{ext}"


def split(data: dict, out_dir: Path) -> None:
    """합친 사전을 index.json + 지연 표 + person_day 바이너리로 나눠 쓴다.

    출력 폴더에 남은 이전 해시 파일은 지운다(이번에 쓴 파일과 index.json 만 남긴다).

    Args:
        data: fetch() 또는 합친 JSON 과 같은 모양의 사전.
        out_dir: 출력 폴더.
    """
    blobs: dict[str, bytes] = {}
    files: dict[str, str] = {}
    for key in LAZY:
        if key not in data:
            continue
        body = dump(data[key])
        files[key] = hashed(key, body, "json")
        blobs[files[key]] = body
    if data.get("person_day"):
        bin_body, pd_meta = pack_person_day(data["person_day"])
        meta_body = dump(pd_meta)
        gz_body = gzip.compress(bin_body, compresslevel=9, mtime=0)
        files["person_day"] = hashed("person_day", bin_body, "bin")
        files["person_day_gz"] = hashed("person_day", gz_body, "pdz")
        files["person_day_meta"] = hashed("person_day.meta", meta_body, "json")
        blobs[files["person_day"]] = bin_body
        blobs[files["person_day_gz"]] = gz_body
        blobs[files["person_day_meta"]] = meta_body

    index = {"meta": data["meta"], "files": files}
    index.update({k: v for k, v in data.items() if k not in ("meta", "person_day", *LAZY)})
    index_body = dump(index)

    out_dir.mkdir(parents=True, exist_ok=True)
    for name, body in blobs.items():
        (out_dir / name).write_bytes(body)
    (out_dir / "index.json").write_bytes(index_body)
    for old in out_dir.iterdir():
        if HASHED.match(old.name) and old.name not in blobs:
            old.unlink()
    for name in ["index.json", *blobs]:
        print(f"{name:40s} {(out_dir / name).stat().st_size / 1e6:6.2f}MB")


def main() -> None:
    """마트(또는 합친 JSON)를 읽어 분할 파일을 쓴다."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(ROOT / "dashboard" / "public" / "data"), help="출력 폴더")
    ap.add_argument("--from-json", help="BigQuery 대신 읽을 합친 JSON(이전 data.json·샘플 생성기 출력)")
    a = ap.parse_args()

    data = json.loads(Path(a.from_json).read_text(encoding="utf-8")) if a.from_json else fetch()
    split(data, Path(a.out))


if __name__ == "__main__":
    main()
