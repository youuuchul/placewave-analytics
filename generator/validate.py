"""Placewave 합성 데이터 검증기.

생성 직후 이벤트 로그와 원장이 서로 맞는지 단언하고, 요약 통계를 `data/summary.md` 로 쓴다.
단언이 하나라도 어긋나면 exit 1.

실행:
    uv run generator/validate.py --data data/ --weeks 52 --end-date 2026-09-20
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import logging
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from search_engine import RANKER_AB_START, RANKER_V2_ALL, REINDEX_BUG, ranker_for

logger = logging.getLogger("placewave.validate")

KST = timezone(timedelta(hours=9))
KEY_EVENTS = {"sign_up", "apply_event", "purchase", "share", "cancel_apply", "subscribe", "subscription_cancel"}
DETAIL_SCREENS = {"venue_detail", "venue_review", "event_detail"}
APPLY_SCREENS = {"event_apply", "payment_confirm"}
ROW_RANGE = (7_000_000, 15_000_000)
AD_SESSION_PER_CLICK = (0.55, 0.95)
RET_OFFSETS = (1, 2, 4, 8, 12)
# 지표 일반 범위 (docs/architecture.md §6). 벗어나면 실패
RANGES = {
    "신규 방문자 W1 리텐션": (0.15, 0.30),
    "W4 리텐션": (0.08, 0.18),
    "방문 -> 가입 전환 (기간 누적 사람)": (0.06, 0.12),
    "회원 중 2기기 비율": (0.30, 0.40),
    "행사 상세 조회 -> 신청 (기간 누적 사람)": (0.03, 0.08),
    "신청 -> 결제 완료 (유료 행사)": (0.55, 0.75),
    "취소율 (신청 대비)": (0.05, 0.12),
    "광고 세션 비중 (집행일)": (0.10, 0.30),
    "자동 로드 세션 비중": (0.05, 0.10),
}
# 시나리오 2.0 완료 기준 (docs/scenario_v2.md §7). 벗어나면 실패
RANGES_V2 = {
    "등록 공간 (종료일 누적)": (1700, 1900),
    "파트너 공간 (종료일 진행 계약)": (160, 200),
    "활성 구독자 (종료일)": (1800, 2200),
    "구독 월 이탈률 (월초 활성 대비 그달 해지)": (0.04, 0.08),
    "티켓 객단가 (원, 결제 완료)": (32000, 44000),
    "연 티켓 매출 (원, 결제 완료)": (1_200_000_000, 1_800_000_000),
    "파트너 공간 행사 비중": (0.70, 0.80),
    "광고비 / 연 티켓 매출": (0.08, 0.12),
    "파트너 계약 월 해지율 (계약·월 대비)": (0.01, 0.03),
}
REGION_TOLERANCE = 0.03
TAKE_RATE_RANGE = (0.05, 0.07)  # 실효 수수료율 = 수수료 / 거래액 (docs/business_model.md §2)
PARTNER_COST_MAX = 0.15  # 파트너 부담률 = (파트너 공간 수수료 + 플랜 매출) / 파트너 거래액
REGION_ACTIVITY_TOLERANCE = 0.05  # 상권별 조회·행사 비중 - 공간 수 비중
SUB_PRICE = 9900
SUB_DISCOUNT = 0.15
SEED_DIR = Path(__file__).resolve().parent / "seed"


@dataclass
class Sess:
    """세션 1개의 집계."""

    client: str
    date: str
    ts_min: int
    ts_max: int = 0
    screens: int = 0
    eng: int = 0
    key: bool = False
    users: set[str] = field(default_factory=set)
    medium: str = ""
    campaign: str = ""
    source: str = ""
    detail: bool = False
    event_detail: bool = False
    identified: bool = False
    apply_form: bool = False
    applied: bool = False
    engaged: bool = False


def _param(row: dict, key: str) -> str | int | None:
    for p in row["event_params"]:
        if p["key"] == key:
            return p["string_value"] if p["string_value"] is not None else p["int_value"]
    return None


def _read_csv(path: Path) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def validate(data: Path, weeks: int, end_date: date) -> tuple[list[tuple[str, bool, str]], str]:
    """단언을 실행하고 요약 마크다운을 만든다.

    Args:
        data: 데이터 루트(data/).
        weeks: 기대 기간(주).
        end_date: 기대 마지막 날(KST).

    Returns:
        (단언 결과 목록 [(이름, 통과 여부, 상세)], 요약 마크다운).
    """
    raw = data / "raw"
    sessions: dict[tuple[str, int], Sess] = {}
    names: Counter[str] = Counter()
    purchase_orders: dict[str, int] = {}
    apply_orders: dict[str, str | None] = {}
    cancel_orders: dict[str, int] = {}
    signups: set[str] = set()
    client_users: dict[str, set[str]] = defaultdict(set)
    dates: set[str] = set()
    n_rows = 0
    last_day = end_date.isoformat()
    last_day_apply = 0
    last_day_pay = 0

    apps = _read_csv(raw / "db_applications.csv")
    pays_all = _read_csv(raw / "db_payments.csv")
    pays = [p for p in pays_all if p["kind"] == "ticket"]
    members = _read_csv(raw / "db_members.csv")
    events_master = _read_csv(raw / "db_events.csv")
    ads = _read_csv(raw / "ads_spend.csv")
    venues = _read_csv(raw / "db_venues.csv")
    contracts = _read_csv(raw / "db_venue_contracts.csv")
    changes = _read_csv(raw / "db_venue_contract_changes.csv")
    subs = _read_csv(raw / "db_subscriptions.csv")
    sub_iv: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for sb in subs:
        sub_iv[sb["member_id"]].append((_epoch(sb["started_at"]), _epoch(sb["ended_at"]) if sb["ended_at"] else INF))
    sub_events: dict[str, tuple[str, str, int]] = {}
    sub_cancels: dict[str, int] = {}
    venue_views: Counter[tuple[int, str, str]] = Counter()
    venue_first_view: dict[int, int] = {}
    prop_missing = 0
    prop_mismatch = 0
    boundary_rows: list[tuple[str, int, str]] = []
    sub_us: dict[str, list[int]] = defaultdict(list)
    ga_search: dict[str, set[str]] = {"search": set(), "select_search_result": set()}

    with gzip.open(raw / "ga4_events.ndjson.gz", "rt", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            n_rows += 1
            e = r["event_name"]
            names[e] += 1
            dates.add(r["event_date"])
            if r["event_date"] == last_day:
                if e == "apply_event":
                    last_day_apply += 1
                elif e == "purchase":
                    last_day_pay += 1
            if e in ga_search:
                ga_search[e].add(str(_param(r, "search_id")))
            k = (r["user_pseudo_id"], r["ga_session_id"])
            s = sessions.get(k)
            if s is None:
                s = sessions[k] = Sess(r["user_pseudo_id"], r["event_date"], r["event_timestamp"])
                s.medium = r["traffic_source"]["medium"]
                s.campaign = r["traffic_source"]["campaign"]
                s.source = r["traffic_source"]["source"]
            s.ts_min = min(s.ts_min, r["event_timestamp"])
            s.ts_max = max(s.ts_max, r["event_timestamp"])
            s.eng += r["engagement_time_msec"]
            s.engaged = r["session_engaged"] == "1"
            flag = next((u["string_value"] for u in r["user_properties"] if u["key"] == "subscriber"), None)
            if flag is None:
                prop_missing += 1
            elif r["user_id"] in sub_iv:
                t_s = r["event_timestamp"] // 1_000_000
                if any(t_s in (a, b) for a, b in sub_iv[r["user_id"]]):
                    # 원장 시각은 초 단위라 경계 초의 행은 로그의 마이크로초 경계로 나중에 판정한다
                    boundary_rows.append((r["user_id"], r["event_timestamp"], flag))
                else:
                    prop_mismatch += flag != ("1" if _active(sub_iv[r["user_id"]], t_s) else "0")
            elif r["user_id"] and flag != "0":
                prop_mismatch += 1
            if r["user_id"]:
                s.users.add(r["user_id"])
                client_users[r["user_pseudo_id"]].add(r["user_id"])
                s.identified = True
            if e in KEY_EVENTS:
                s.key = True
            if e == "screen_view":
                s.screens += 1
                sn = _param(r, "screen_name")
                s.detail |= sn in DETAIL_SCREENS
                s.event_detail |= sn == "event_detail"
                s.apply_form |= sn in APPLY_SCREENS
                if sn == "venue_detail":
                    vid = int(_param(r, "venue_id"))
                    venue_views[(vid, r["event_date"], str(_param(r, "is_partner")))] += 1
                    t_s = r["event_timestamp"] // 1_000_000
                    venue_first_view[vid] = min(venue_first_view.get(vid, t_s), t_s)
            elif e == "sign_up":
                s.identified = True
                signups.add(r["user_id"])
            elif e == "apply_event":
                s.applied = True
                apply_orders[str(_param(r, "order_id"))] = r["user_id"]
            elif e == "purchase":
                purchase_orders[str(_param(r, "order_id"))] = int(_param(r, "value") or 0)
            elif e == "cancel_apply":
                cancel_orders[str(_param(r, "order_id"))] = int(_param(r, "value") or 0)
            elif e == "subscribe":
                sub_events[str(_param(r, "subscription_id"))] = (
                    str(_param(r, "order_id")),
                    r["user_id"],
                    r["event_timestamp"] // 1_000_000,
                )
            elif e == "subscription_cancel":
                sub_cancels[str(_param(r, "subscription_id"))] = r["event_timestamp"] // 1_000_000
            if e in ("subscribe", "subscription_cancel"):
                sub_us[r["user_id"]].append(r["event_timestamp"])

    checks: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str) -> None:
        checks.append((name, ok, detail))

    check("결제 이벤트 수 = payments 행 수", names["purchase"] == len(pays), f"{names['purchase']} vs {len(pays)}")
    check(
        "결제 order_id 집합 일치", set(purchase_orders) == {p["order_id"] for p in pays}, f"{len(purchase_orders)} 건"
    )
    pay_sum = sum(int(p["amount"]) for p in pays)
    check(
        "결제 금액 합 일치",
        sum(purchase_orders.values()) == pay_sum,
        f"{sum(purchase_orders.values()):,} vs {pay_sum:,}",
    )
    check(
        "신청 이벤트 수 = applications 행 수",
        names["apply_event"] == len(apps),
        f"{names['apply_event']} vs {len(apps)}",
    )
    check(
        "신청 order_id·회원 일치",
        apply_orders == {a["order_id"]: a["member_id"] for a in apps},
        f"{len(apply_orders)} 건",
    )
    canceled = {a["order_id"]: int(a["cancel_amount"]) for a in apps if a["status"] == "canceled"}
    check(
        "취소 이벤트 = canceled 행, 금액 합 일치",
        cancel_orders == canceled,
        f"{len(cancel_orders)} 건, {sum(cancel_orders.values()):,} 원",
    )
    refunded = {p["order_id"] for p in pays if p["status"] == "refunded"}
    check("환불 결제 = 취소된 유료 신청", refunded == {o for o, v in canceled.items() if v > 0}, f"{len(refunded)} 건")
    check(
        "가입 이벤트 수 = members 행 수",
        len(signups) == names["sign_up"] == len(members),
        f"{names['sign_up']} vs {len(members)}",
    )
    event_ids = {e["event_id"] for e in events_master}
    check("신청 event_id 가 행사 원장에 존재", all(a["event_id"] in event_ids for a in apps), "")
    multi_sess = sum(1 for s in sessions.values() if len(s.users) > 1)
    check("세션 내 user_id 단일", multi_sess == 0, f"위반 세션 {multi_sess}")
    multi_client = sum(1 for u in client_users.values() if len(u) > 1)
    check("기기당 user_id 단일", multi_client == 0, f"위반 기기 {multi_client}")

    person_of = {c: next(iter(u)) for c, u in client_users.items()}
    clients = {s.client for s in sessions.values()}
    persons = {person_of.get(c, c) for c in clients}
    check("기기 수 > 사람 수", len(clients) > len(persons), f"기기 {len(clients):,} / 사람 {len(persons):,}")

    start_date = end_date - timedelta(days=weeks * 7 - 1)
    exp_dates = {(start_date + timedelta(days=i)).isoformat() for i in range(weeks * 7)}
    check(
        f"날짜 범위 {weeks}주 ({start_date} ~ {end_date})",
        dates == exp_dates,
        f"{min(dates)} ~ {max(dates)}, {len(dates)}일",
    )
    check(f"이벤트 행 수 {ROW_RANGE[0]:,}~{ROW_RANGE[1]:,}", ROW_RANGE[0] <= n_rows <= ROW_RANGE[1], f"{n_rows:,}")

    clicks: Counter[str] = Counter()
    for a in ads:
        clicks[a["campaign_id"]] += int(a["clicks"])
    ad_sess = Counter(s.campaign for s in sessions.values() if s.medium == "paid_social")
    lo, hi = AD_SESSION_PER_CLICK
    ratios = {c: ad_sess[c] / clicks[c] for c in sorted(clicks)}
    check(
        f"캠페인별 광고 세션 / 클릭 {lo}~{hi}",
        all(lo <= r <= hi for r in ratios.values()),
        ", ".join(f"{c} {ad_sess[c]}/{clicks[c]}={r:.2f}" for c, r in ratios.items()),
    )

    snap = {
        r["snapshot_date"]
        for rows in (apps, pays_all, members, events_master, venues, contracts, changes, subs)
        for r in rows
    }
    check("RDB 스냅샷 snapshot_date = 종료일", snap == {end_date.isoformat()}, ", ".join(sorted(snap)))

    summary, ret = _summary(
        sessions, names, person_of, apps, pays, members, ads, start_date, weeks, n_rows, len(clients), len(persons)
    )
    seq = [ret[o] for o in RET_OFFSETS]
    check(
        "리텐션 감쇠 W1 > W2 > W4 > W8 > W12",
        all(a > b for a, b in zip(seq, seq[1:], strict=False)),
        " / ".join(f"W{o} {ret[o]:.3f}" for o in RET_OFFSETS),
    )

    visit = [s for s in sessions.values() if not _is_auto(s)]
    detail_persons = {person_of.get(s.client, s.client) for s in visit if s.event_detail}
    apply_persons = {person_of.get(s.client, s.client) for s in visit if s.applied}
    price = {e["event_id"]: int(e["price"]) for e in events_master}
    paid_apps = [a for a in apps if price[a["event_id"]] > 0]
    ad_days = {a["date"] for a in ads}
    ad_window = [s for s in visit if s.date in ad_days]

    last_day_hours = {datetime.fromtimestamp(s.ts_min // 1_000_000, KST).hour for s in visit if s.date == last_day}
    check(
        "마지막 날 시간별 세션 0~23시 전부 존재",
        last_day_hours == set(range(24)),
        f"{len(last_day_hours)}개 시간대: {sorted(last_day_hours)}",
    )
    check("마지막 날 신청 건수 > 0", last_day_apply > 0, f"{last_day_apply}")
    check("마지막 날 결제 건수 > 0", last_day_pay > 0, f"{last_day_pay}")
    day_people: dict[str, set[str]] = defaultdict(set)
    for s in visit:
        day_people[s.date].add(person_of.get(s.client, s.client))
    prev_days = [(end_date - timedelta(days=i)).isoformat() for i in range(1, 8)]
    prev_avg = sum(len(day_people.get(d, set())) for d in prev_days) / 7
    last_day_visitors = len(day_people.get(last_day, set()))
    check(
        "마지막 날 방문자 >= 직전 7일 평균의 60%",
        prev_avg == 0 or last_day_visitors >= 0.6 * prev_avg,
        f"{last_day_visitors} vs 직전 7일 평균 {prev_avg:.1f}",
    )

    apply_day = Counter(datetime.fromtimestamp(_epoch(a["applied_at"]), KST).date() for a in apps)
    last7 = sum(apply_day[end_date - timedelta(days=i)] for i in range(7)) / 7
    prev28 = sum(apply_day[end_date - timedelta(days=i)] for i in range(7, 35)) / 28
    check(
        "마지막 7일 일평균 신청 >= 직전 4주 일평균의 70%",
        last7 >= 0.7 * prev28,
        f"{last7:.1f} vs {prev28:.1f} ({last7 / prev28:.2f})",
    )
    first_day: dict[str, str] = {}
    for s_ in visit:
        pid = person_of.get(s_.client, s_.client)
        if pid not in first_day or s_.date < first_day[pid]:
            first_day[pid] = s_.date
    new_by_day = Counter(first_day.values())
    camp_week = {week_of_date(date.fromisoformat(d), start_date) for d in ad_days}
    wk_new: dict[bool, list[int]] = {True: [], False: []}
    for i in range(weeks * 7):
        d = start_date + timedelta(days=i)
        wk_new[week_of_date(d, start_date) in camp_week].append(new_by_day[d.isoformat()])
    avg_on = sum(wk_new[True]) / max(len(wk_new[True]), 1)
    avg_off = sum(wk_new[False]) / max(len(wk_new[False]), 1)
    check(
        "캠페인 없는 주 일평균 신규 >= 캠페인 있는 주의 40%",
        avg_off >= 0.4 * avg_on,
        f"{avg_off:.0f} vs {avg_on:.0f} ({avg_off / avg_on:.2f})",
    )

    values = {
        "신규 방문자 W1 리텐션": ret[1],
        "W4 리텐션": ret[4],
        "방문 -> 가입 전환 (기간 누적 사람)": len(members) / len(persons),
        "회원 중 2기기 비율": sum(1 for c in Counter(person_of.values()).values() if c > 1) / len(members),
        "행사 상세 조회 -> 신청 (기간 누적 사람)": len(apply_persons & detail_persons) / len(detail_persons),
        "신청 -> 결제 완료 (유료 행사)": sum(a["order_id"] in purchase_orders for a in paid_apps) / len(paid_apps),
        "취소율 (신청 대비)": sum(a["status"] == "canceled" for a in apps) / len(apps),
        "광고 세션 비중 (집행일)": sum(s.medium == "paid_social" for s in ad_window) / len(ad_window),
        "자동 로드 세션 비중": 1 - len(visit) / len(sessions),
    }
    for name, (lo, hi) in RANGES.items():
        v = values[name]
        check(f"범위 {name} {lo:.0%}~{hi:.0%}", lo <= v <= hi, f"{v:.3f}")
    for uid, t_us, flag in boundary_rows:
        marks = sorted(sub_us[uid])
        ivs_us = [(marks[i], marks[i + 1] if i + 1 < len(marks) else INF) for i in range(0, len(marks), 2)]
        prop_mismatch += flag != ("1" if _active(ivs_us, t_us) else "0")
    ctx = {
        "venues": venues,
        "contracts": contracts,
        "changes": changes,
        "events": events_master,
        "subs": subs,
        "pays_all": pays_all,
        "apps": apps,
        "ads": ads,
        "members": members,
        "sub_events": sub_events,
        "sub_cancels": sub_cancels,
        "venue_views": venue_views,
        "venue_first_view": venue_first_view,
        "prop_missing": prop_missing,
        "prop_mismatch": prop_mismatch,
    }
    v2_lines = _v2(ctx, check, start_date, end_date) + _search(raw, check, ga_search) + _churn(raw, check, end_date)
    marker = "\n## 주별 추이"
    summary = summary.replace(marker, "\n".join(v2_lines) + "\n" + marker, 1)
    return checks, summary


INF = float("inf")


def _epoch(ts: str) -> int:
    return int(datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC).timestamp())


def _kst_date(ts: str) -> date:
    return datetime.fromtimestamp(_epoch(ts), KST).date()


def _active(ivs: list[tuple[int, float]], t: int) -> bool:
    return any(a <= t < b for a, b in ivs)


def _add_months(t: datetime, k: int) -> datetime:
    m = t.month - 1 + k
    y, m = t.year + m // 12, m % 12 + 1
    nxt = date(y + m // 12, m % 12 + 1, 1)
    return t.replace(year=y, month=m, day=min(t.day, (nxt - date(y, m, 1)).days))


def _v2(ctx: dict[str, Any], check: Any, start_date: date, end_date: date) -> list[str]:
    """시나리오 2.0 단언(공간·계약·행사·구독·할인·매출)을 실행하고 요약 절을 돌려준다.

    Args:
        ctx: 원장·로그 집계 묶음.
        check: 단언 기록 함수 (이름, 통과 여부, 상세).
        start_date: 관측 시작일(KST).
        end_date: 관측 마지막 날(KST).

    Returns:
        요약 마크다운 줄 목록.
    """
    venues, contracts, events, subs = ctx["venues"], ctx["contracts"], ctx["events"], ctx["subs"]
    pays_all, apps, ads = ctx["pays_all"], ctx["apps"], ctx["ads"]
    names = json.loads((SEED_DIR / "names.json").read_text(encoding="utf-8"))
    regions = names["regions"]
    plan_fee = names["pricing"]["partner_plan_fee"]
    fee_rate = names["pricing"]["commission_rate"]
    changes = ctx["changes"]
    range_end = int(datetime(end_date.year, end_date.month, end_date.day, tzinfo=KST).timestamp()) + 86400

    # 공간·계약
    reg_ts = {int(v["venue_id"]): _epoch(v["registered_at"]) for v in venues}
    partner_iv: dict[int, list[tuple[date, date]]] = defaultdict(list)
    far = date(9999, 12, 31)
    fee_ok = True
    for c in contracts:
        a = _kst_date(c["started_at"])
        b = _kst_date(c["ended_at"]) if c["ended_at"] else far
        partner_iv[int(c["venue_id"])].append((a, b))
        fee_ok &= int(c["monthly_fee"]) == plan_fee[c["plan"]]
        fee_ok &= (c["status"] == "ended") == bool(c["ended_at"])
    overlap = sum(
        1 for ivs in partner_iv.values() for i, x in enumerate(sorted(ivs)) for y in sorted(ivs)[i + 1 :] if y[0] < x[1]
    )
    check("공간당 진행 계약 1건 이하 (계약 기간 겹침 없음)", overlap == 0, f"겹침 {overlap}")
    fee_label = " / ".join(f"{k} {v:,}" for k, v in plan_fee.items())
    check(f"계약 요금·상태 규칙 (현재 플랜 요금 {fee_label}, ended ⇔ ended_at)", fee_ok, f"{len(contracts)} 건")

    # 플랜 변경: 계약별 변경 이력으로 날짜별 플랜을 복원한다
    by_contract = {c["contract_id"]: c for c in contracts}
    chg_by: dict[str, list[dict[str, str]]] = defaultdict(list)
    for ch in changes:
        chg_by[ch["contract_id"]].append(ch)
    for v in chg_by.values():
        v.sort(key=lambda ch: (ch["changed_at"], ch["change_id"]))
    fee_match = all(
        int(ch["from_fee"]) == plan_fee[ch["from_plan"]] and int(ch["to_fee"]) == plan_fee[ch["to_plan"]]
        for ch in changes
    ) and all(v[-1]["to_plan"] == by_contract[k]["plan"] for k, v in chg_by.items() if k in by_contract)
    check(
        f"요금 상수 일치 (플랜 변경 from/to 요금 = 요금표 {fee_label}, 계약 현재 플랜 = 마지막 변경)",
        fee_match,
        f"변경 {len(changes)} 건",
    )
    bad_chg = 0
    for k, v in chg_by.items():
        c = by_contract.get(k)
        if c is None:
            bad_chg += len(v)
            continue
        a = _kst_date(c["started_at"])
        b = _kst_date(c["ended_at"]) if c["ended_at"] else far
        prev_to = None
        prev_day = None
        for ch in v:
            d = _kst_date(ch["changed_at"])
            bad_chg += (
                ch["from_plan"] == ch["to_plan"]
                or ch["venue_id"] != c["venue_id"]
                or not a < d < b
                or (prev_to is not None and ch["from_plan"] != prev_to)
                or d == prev_day
            )
            prev_to, prev_day = ch["to_plan"], d
    n_up = sum(ch["from_plan"] == "basic" and ch["to_plan"] == "pro" for ch in changes)
    check(
        "플랜 변경 정합 (from ≠ to, 직전 변경과 연쇄, 변경일에 계약 진행 중, 계약·공간 일치)",
        bad_chg == 0,
        f"위반 {bad_chg}, 업그레이드 {n_up} / 다운그레이드 {len(changes) - n_up}",
    )

    def plan_on(c: dict[str, str], d: date) -> str:
        v = chg_by.get(c["contract_id"], [])
        cur = v[0]["from_plan"] if v else c["plan"]
        for ch in v:
            if _kst_date(ch["changed_at"]) <= d:
                cur = ch["to_plan"]
        return cur

    contracts_of: dict[int, list[dict[str, str]]] = defaultdict(list)
    for c in contracts:
        contracts_of[int(c["venue_id"])].append(c)

    def tier_on(vid: int, d: date) -> str:
        for c in contracts_of.get(vid, []):
            a = _kst_date(c["started_at"])
            b = _kst_date(c["ended_at"]) if c["ended_at"] else far
            if a <= d < b:
                return plan_on(c, d)
        return "non_partner"

    check(
        "계약 공간이 공간 원장에 있고 등록 후 계약",
        all(int(c["venue_id"]) in reg_ts and _epoch(c["started_at"]) >= reg_ts[int(c["venue_id"])] for c in contracts),
        "",
    )

    def is_partner(vid: int, d: date) -> bool:
        return any(a <= d < b for a, b in partner_iv.get(vid, []))

    views = ctx["venue_views"]
    bad_view = sum(
        n for (vid, d, flag), n in views.items() if flag != ("1" if is_partner(vid, date.fromisoformat(d)) else "0")
    )
    check("공간 상세 is_partner = 조회일 계약 상태", bad_view == 0, f"불일치 {bad_view} / {sum(views.values()):,} 조회")
    early = sum(1 for vid, t in ctx["venue_first_view"].items() if vid not in reg_ts or t < reg_ts[vid])
    check("공간 상세 조회 공간이 원장에 있고 등록 후 조회", early == 0, f"위반 공간 {early}")

    ev_by_id = {e["event_id"]: e for e in events}
    bad_host = sum(
        1 for e in events if int(e["venue_id"]) not in reg_ts or _epoch(e["starts_at"]) < reg_ts[int(e["venue_id"])]
    )
    check("행사 개최 공간이 개최 전에 등록", bad_host == 0, f"위반 {bad_host}")
    bad_flag = sum(
        1
        for e in events
        if (e["is_partner_venue"] == "true") != is_partner(int(e["venue_id"]), _kst_date(e["starts_at"]))
    )
    check("행사 is_partner_venue = 개최일 계약 상태", bad_flag == 0, f"불일치 {bad_flag}")
    seats = Counter(a["event_id"] for a in apps if a["status"] != "payment_pending")
    over = sum(1 for k, n in seats.items() if n > int(ev_by_id[k]["capacity"]))
    check(
        "행사별 신청(결제 대기 제외) <= 정원",
        over == 0,
        f"초과 행사 {over}, 정원 도달 {sum(1 for k, n in seats.items() if n == int(ev_by_id[k]['capacity']))}",
    )

    # 구독
    members = {m["member_id"]: _epoch(m["signed_up_at"]) for m in ctx["members"]}
    sub_ev, sub_cancel = ctx["sub_events"], ctx["sub_cancels"]
    check("구독 이벤트 수 = subscriptions 행 수", len(sub_ev) == len(subs), f"{len(sub_ev)} vs {len(subs)}")
    ok = all(
        s["subscription_id"] in sub_ev
        and sub_ev[s["subscription_id"]][1] == s["member_id"]
        and sub_ev[s["subscription_id"]][2] == _epoch(s["started_at"])
        for s in subs
    )
    check("구독 이벤트 회원·시각 = 구독 원장", ok, "")
    canceled = {s["subscription_id"]: _epoch(s["ended_at"]) for s in subs if s["status"] == "canceled"}
    check("해지 이벤트 = canceled 구독 (시각 포함)", sub_cancel == canceled, f"{len(sub_cancel)} 건")
    check(
        "구독자는 회원이고 가입 후 구독",
        all(s["member_id"] in members and _epoch(s["started_at"]) >= members[s["member_id"]] for s in subs),
        "",
    )
    sub_pays: dict[str, list[dict[str, str]]] = defaultdict(list)
    for p in pays_all:
        if p["kind"] == "subscription":
            sub_pays[p["subscription_id"]].append(p)
    bad_cycle = 0
    for s in subs:
        st = datetime.fromtimestamp(_epoch(s["started_at"]), KST)
        end = _epoch(s["ended_at"]) if s["ended_at"] else INF
        exp = []
        k = 0
        while (t := int(_add_months(st, k).timestamp())) < min(range_end, end):
            exp.append(t)
            k += 1
        got = sorted(_epoch(p["paid_at"]) for p in sub_pays.get(s["subscription_id"], []))
        bad_cycle += got != exp or any(
            int(p["amount"]) != SUB_PRICE or p["member_id"] != s["member_id"] for p in sub_pays[s["subscription_id"]]
        )
    check("구독 결제 = 시작일 기준 월 반복 (해지·종료 후 미청구, 9,900원)", bad_cycle == 0, f"위반 구독 {bad_cycle}")
    first_orders = {v[0] for v in sub_ev.values()}
    check(
        "구독 이벤트 order_id = 구독 1회차 결제",
        first_orders == {f"{s['subscription_id']}-01" for s in subs}
        and all(o in {p["order_id"] for p in pays_all} for o in first_orders),
        f"{len(first_orders)} 건",
    )

    # 할인
    sub_iv: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for s in subs:
        sub_iv[s["member_id"]].append((_epoch(s["started_at"]), _epoch(s["ended_at"]) if s["ended_at"] else INF))
    tickets = [p for p in pays_all if p["kind"] == "ticket"]
    bad_disc = 0
    for p in tickets:
        e = ev_by_id[p["event_id"]]
        price = int(e["price"])
        on = e["is_partner_venue"] == "true" and _active(sub_iv.get(p["member_id"], []), _epoch(p["paid_at"]))
        disc = int(round(price * SUB_DISCOUNT)) if on else 0
        bad_disc += int(p["discount_amount"]) != disc or int(p["amount"]) != price - disc
    n_disc = sum(int(p["discount_amount"]) > 0 for p in tickets)
    check(
        "티켓 할인 = 구독 중 파트너 공간 행사 15%, 실결제 = 정가 - 할인",
        bad_disc == 0,
        f"위반 {bad_disc}, 할인 결제 {n_disc:,}",
    )
    check(
        "user_properties.subscriber = 그 시점 구독 상태 (회원 행)",
        ctx["prop_missing"] == 0 and ctx["prop_mismatch"] == 0,
        f"누락 {ctx['prop_missing']}, 불일치 {ctx['prop_mismatch']}",
    )

    # 범위
    end_ts = range_end
    reg_total = sum(1 for t in reg_ts.values() if t < end_ts)
    partner_end = sum(1 for c in contracts if c["status"] == "active")
    active_end = sum(1 for s in subs if s["status"] == "active")
    paid_tickets = [p for p in tickets if p["status"] == "paid"]
    ticket_rev = sum(int(p["amount"]) for p in paid_tickets)
    spend = sum(int(a["spend"]) for a in ads)

    months: list[date] = []
    m = date(start_date.year, start_date.month, 1)
    while m <= end_date:
        months.append(m)
        m = date(m.year + m.month // 12, m.month % 12 + 1, 1)

    def m_ts(d: date) -> int:
        return int(datetime(d.year, d.month, d.day, tzinfo=KST).timestamp())

    sub_rows = []
    churn_num = churn_den = 0
    for i, m in enumerate(months):
        nm = months[i + 1] if i + 1 < len(months) else end_date + timedelta(days=1)
        a, b = m_ts(m), min(m_ts(nm), end_ts)
        at_start = sum(
            1 for s in subs if _epoch(s["started_at"]) < a and (not s["ended_at"] or _epoch(s["ended_at"]) >= a)
        )
        new = sum(1 for s in subs if a <= _epoch(s["started_at"]) < b)
        churned = sum(1 for s in subs if s["ended_at"] and a <= _epoch(s["ended_at"]) < b)
        at_end = sum(
            1 for s in subs if _epoch(s["started_at"]) < b and (not s["ended_at"] or _epoch(s["ended_at"]) >= b)
        )
        full = i + 1 < len(months) and m_ts(nm) <= end_ts
        if full and at_start >= 100:
            churn_num += churned
            churn_den += at_start
        sub_rows.append((m, at_start, new, churned, at_end))
    churn = churn_num / churn_den if churn_den else 0.0

    # 계약 월 해지율: 해지 건 / 계약·월(일할)
    contract_months = 0.0
    b2b: Counter[date] = Counter()
    for c in contracts:
        a = _kst_date(c["started_at"])
        b = _kst_date(c["ended_at"]) if c["ended_at"] else end_date + timedelta(days=1)
        d = a
        while d < b and d <= end_date:
            mm = date(d.year, d.month, 1)
            dim = (date(mm.year + mm.month // 12, mm.month % 12 + 1, 1) - mm).days
            b2b[mm] += plan_fee[plan_on(c, d)] / dim
            contract_months += 1 / dim
            d += timedelta(days=1)
    contract_churn = sum(1 for c in contracts if c["ended_at"]) / contract_months
    change_rate = len(changes) / contract_months

    # 거래 수수료: 정가 x 개최일 공간 등급 율, 결제 완료(환불 제외), 인식일 = 결제일
    gmv: Counter[date] = Counter()
    fee_m: Counter[date] = Counter()
    gmv_tier: Counter[str] = Counter()
    fee_tier: Counter[str] = Counter()
    for p in paid_tickets:
        e = ev_by_id[p["event_id"]]
        tier = tier_on(int(e["venue_id"]), _kst_date(e["starts_at"]))
        price = int(e["price"])
        f = price * fee_rate[tier]
        d = _kst_date(p["paid_at"])
        mm = date(d.year, d.month, 1)
        gmv[mm] += price
        fee_m[mm] += f
        gmv_tier[tier] += price
        fee_tier[tier] += f
    gmv_total = sum(gmv.values())
    fee_total = sum(fee_m.values())
    plan_total = sum(b2b.values())
    take_rate = fee_total / gmv_total
    partner_gmv = gmv_tier["basic"] + gmv_tier["pro"]
    partner_cost = (fee_tier["basic"] + fee_tier["pro"] + plan_total) / partner_gmv
    check(
        f"실효 수수료율 {TAKE_RATE_RANGE[0]:.0%}~{TAKE_RATE_RANGE[1]:.0%} (수수료 / 거래액, 정가 x 개최일 등급 율)",
        TAKE_RATE_RANGE[0] <= take_rate <= TAKE_RATE_RANGE[1],
        f"{take_rate:.2%} = {fee_total:,.0f} / {gmv_total:,}",
    )
    check(
        f"파트너 부담률 <= {PARTNER_COST_MAX:.0%} ((파트너 공간 수수료 + 플랜 매출) / 파트너 거래액)",
        partner_cost <= PARTNER_COST_MAX,
        f"{partner_cost:.2%} = ({fee_tier['basic'] + fee_tier['pro']:,.0f} + {plan_total:,.0f}) / {partner_gmv:,}",
    )

    region_cnt = Counter(v["region"] for v in venues)
    region_err = {r["name"]: abs(region_cnt[r["name"]] / len(venues) - r["share"]) for r in regions}
    partner_events = sum(e["is_partner_venue"] == "true" for e in events) / len(events)

    values = {
        "등록 공간 (종료일 누적)": reg_total,
        "파트너 공간 (종료일 진행 계약)": partner_end,
        "활성 구독자 (종료일)": active_end,
        "구독 월 이탈률 (월초 활성 대비 그달 해지)": churn,
        "티켓 객단가 (원, 결제 완료)": ticket_rev / len(paid_tickets),
        "연 티켓 매출 (원, 결제 완료)": ticket_rev,
        "파트너 공간 행사 비중": partner_events,
        "광고비 / 연 티켓 매출": spend / ticket_rev,
        "파트너 계약 월 해지율 (계약·월 대비)": contract_churn,
    }
    for name, (lo, hi) in RANGES_V2.items():
        v = values[name]
        fmt = (lambda x: f"{x:.1%}") if hi < 1 else (lambda x: f"{x:,.0f}")
        check(f"범위 {name} {fmt(lo)}~{fmt(hi)}", lo <= v <= hi, fmt(v) if hi >= 1 else f"{v:.3f}")
    worst = max(region_err, key=region_err.get)
    check(
        f"상권 비중 오차 ±{REGION_TOLERANCE:.0%}p 이내",
        max(region_err.values()) <= REGION_TOLERANCE,
        f"최대 {worst} {region_err[worst] * 100:.2f}%p",
    )

    # 요약 절
    t_month: Counter[date] = Counter()
    t_count: Counter[date] = Counter()
    t_disc: Counter[date] = Counter()
    s_month: Counter[date] = Counter()
    for p in pays_all:
        if p["status"] != "paid":
            continue
        d = _kst_date(p["paid_at"])
        mm = date(d.year, d.month, 1)
        if p["kind"] == "ticket":
            t_month[mm] += int(p["amount"])
            t_count[mm] += 1
            t_disc[mm] += int(p["discount_amount"])
        else:
            s_month[mm] += int(p["amount"])
    ad_month: Counter[date] = Counter()
    for a in ads:
        d = date.fromisoformat(a["date"])
        ad_month[date(d.year, d.month, 1)] += int(a["spend"])
    reg_month_end = []
    for i, m in enumerate(months):
        nm = months[i + 1] if i + 1 < len(months) else end_date + timedelta(days=1)
        b = min(m_ts(nm), end_ts)
        bd = datetime.fromtimestamp(b - 1, KST).date()
        reg_month_end.append(
            (
                sum(1 for t in reg_ts.values() if t < b),
                sum(1 for vid in partner_iv if is_partner(vid, bd)),
                sum(1 for c in contracts if m <= _kst_date(c["started_at"]) < nm),
                sum(1 for c in contracts if c["ended_at"] and m <= _kst_date(c["ended_at"]) < nm),
            )
        )
    out = [
        "",
        "## 결제 유입 (월별, KST)",
        "",
        "티켓 결제액 = 결제 완료(환불 제외) 실결제액(매출 아님), 구독 = 월 반복 결제, "
        "파트너 플랜 = 진행 계약 그날 플랜 요금 일할 합.",
        "",
        "| 월 | 티켓 결제 | 티켓 결제액 | 티켓 할인액 | 구독 매출 | 파트너 플랜 매출 | 유입 합 | 광고비 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    tot = [0, 0, 0, 0, 0, 0, 0]
    for m in months:
        row = [t_count[m], t_month[m], t_disc[m], s_month[m], round(b2b[m]), 0, ad_month[m]]
        row[5] = row[1] + row[3] + row[4]
        tot = [x + y for x, y in zip(tot, row, strict=True)]
        out.append(f"| {m:%Y-%m} | " + " | ".join(f"{x:,}" for x in row) + " |")
    out.append("| 합계 | " + " | ".join(f"{x:,}" for x in tot) + " |")
    out += [
        "",
        "## 플랫폼 매출 (월별, KST)",
        "",
        "플랫폼 매출 = 수수료 + 멤버십 + 파트너 플랜. 거래액 = 결제 완료(환불 제외) 티켓 정가 합(할인 전), "
        "수수료 = 정가 x 개최일 공간 등급 율("
        + " / ".join(f"{k} {v:.0%}" for k, v in fee_rate.items())
        + "), 인식일 = 결제일.",
        "",
        "| 월 | 거래액 | 수수료 | 실효 수수료율 | 멤버십 | 파트너 플랜 | 플랫폼 매출 | 플랜 변경 (업 / 다운) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    chg_month: dict[date, list[int]] = defaultdict(lambda: [0, 0])
    for ch in changes:
        d = _kst_date(ch["changed_at"])
        chg_month[date(d.year, d.month, 1)][ch["to_plan"] == "basic"] += 1
    ptot = [0, 0.0, 0, 0.0]
    for m in months:
        row = [gmv[m], fee_m[m], s_month[m], b2b[m]]
        ptot = [x + y for x, y in zip(ptot, row, strict=True)]
        rate = f"{fee_m[m] / gmv[m]:.1%}" if gmv[m] else "-"
        up, down = chg_month[m]
        out.append(
            f"| {m:%Y-%m} | {gmv[m]:,} | {round(fee_m[m]):,} | {rate} | {s_month[m]:,} | {round(b2b[m]):,} "
            f"| {round(fee_m[m] + s_month[m] + b2b[m]):,} | {up} / {down} |"
        )
    out.append(
        f"| 합계 | {ptot[0]:,} | {round(ptot[1]):,} | {ptot[1] / ptot[0]:.1%} | {ptot[2]:,} | {round(ptot[3]):,} "
        f"| {round(ptot[1] + ptot[2] + ptot[3]):,} | {n_up} / {len(changes) - n_up} |"
    )
    out += [
        "",
        "## 공간 등록·파트너 계약 (월말, KST)",
        "",
        "| 월 | 등록 공간 누적 | 파트너 (진행 계약) | 신규 계약 | 해지 계약 |",
        "|---|---|---|---|---|",
    ]
    out += [f"| {m:%Y-%m} | {r[0]:,} | {r[1]} | {r[2]} | {r[3]} |" for m, r in zip(months, reg_month_end, strict=True)]
    out += [
        "",
        "## 구독자 (월별, KST)",
        "",
        "| 월 | 월초 활성 | 신규 | 해지 | 월말 활성 | 월 이탈률 |",
        "|---|---|---|---|---|---|",
    ]
    for m, a0, new, ch, a1 in sub_rows:
        rate = f"{ch / a0:.3f}" if a0 else "-"
        out.append(f"| {m:%Y-%m} | {a0:,} | {new:,} | {ch:,} | {a1:,} | {rate} |")
    view_by_venue: Counter[int] = Counter()
    for (vid, _, _), n in views.items():
        view_by_venue[vid] += n
    region_of = {int(v["venue_id"]): v["region"] for v in venues}
    ev_region = Counter(region_of[int(e["venue_id"])] for e in events)
    view_region: Counter[str] = Counter()
    for vid, n in view_by_venue.items():
        view_region[region_of[vid]] += n
    partner_region = Counter(region_of[int(c["venue_id"])] for c in contracts if c["status"] == "active")
    total_views = sum(view_by_venue.values())
    out += [
        "",
        "## 상권별 공간 (종료일 기준)",
        "",
        "| 상권 | 목표 비중 | 실측 비중 | 등록 | 파트너 | 행사 | 행사 비중 | 공간 상세 조회 비중 |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in regions:
        n = r["name"]
        out.append(
            f"| {n} | {r['share']:.1%} | {region_cnt[n] / len(venues):.1%} | {region_cnt[n]:,} | {partner_region[n]} "
            f"| {ev_region[n]:,} | {ev_region[n] / len(events):.1%} | {view_region[n] / total_views:.1%} |"
        )
    view_dev = {n: view_region[n] / total_views - region_cnt[n] / len(venues) for n in region_cnt}
    ev_dev = {n: ev_region[n] / len(events) - region_cnt[n] / len(venues) for n in region_cnt}
    for label, dev in (("공간 상세 조회", view_dev), ("행사 개최", ev_dev)):
        worst = max(dev, key=lambda k: abs(dev[k]))
        check(
            f"상권별 {label} 비중 - 공간 수 비중 ±{REGION_ACTIVITY_TOLERANCE:.0%}p 이내",
            abs(dev[worst]) <= REGION_ACTIVITY_TOLERANCE,
            f"최대 {worst} {dev[worst] * 100:+.2f}%p",
        )
    tiers = Counter(e["price_tier"] for e in events)
    disc_total = sum(int(p["discount_amount"]) for p in tickets)
    out += [
        "",
        "## 시나리오 2.0 규모",
        "",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 등록 공간 / 폐업 | {len(venues):,} / {sum(v['status'] == 'closed' for v in venues)} |",
        f"| 파트너 계약 (누적 / 진행) | {len(contracts)} / {partner_end} |",
        f"| 행사 / 파트너 공간 개최 | {len(events):,} / {partner_events:.1%} |",
        "| 가격대 free / standard / premium / package | "
        + " / ".join(f"{tiers[t] / len(events):.1%}" for t in ("free", "standard", "premium", "package"))
        + " |",
        f"| 티켓 결제 (완료 / 환불) | {len(paid_tickets):,} / {len(tickets) - len(paid_tickets):,} |",
        f"| 티켓 객단가 / 연 티켓 매출 | {ticket_rev / len(paid_tickets):,.0f} / {ticket_rev:,} |",
        f"| 할인 결제 비중 / 할인액 합 | {n_disc / len(tickets):.1%} / {disc_total:,} |",
        f"| 구독 (누적 / 활성 / 해지) | {len(subs):,} / {active_end:,} / {len(canceled):,} |",
        f"| 구독 결제 건 / 매출 | {sum(len(v) for v in sub_pays.values()):,} / {sum(s_month.values()):,} |",
        f"| 파트너 플랜 매출 (일할) | {round(plan_total):,} |",
        f"| 거래액 (등급 non / basic / pro) | {gmv_total:,} ({gmv_tier['non_partner']:,} / {gmv_tier['basic']:,}"
        f" / {gmv_tier['pro']:,}) |",
        f"| 수수료 / 실효 수수료율 | {round(fee_total):,} / {take_rate:.2%} |",
        f"| 플랫폼 매출 (수수료 + 멤버십 + 파트너 플랜) | {round(fee_total + sum(s_month.values()) + plan_total):,} |",
        f"| 파트너 부담률 | {partner_cost:.2%} |",
        f"| 플랜 변경 (업 / 다운, 계약·월 대비) | {n_up} / {len(changes) - n_up} ({change_rate:.4f}) |",
        f"| 광고비 / 티켓 매출 | {spend:,} / {spend / ticket_rev:.1%} |",
        f"| 구독 월 이탈률 (월초 활성 100명 이상인 완결 월 합산) | {churn:.3f} |",
        f"| 파트너 계약 월 해지율 | {contract_churn:.4f} |",
    ]
    return out


def _search(raw: Path, check: Any, ga_ids: dict[str, set[str]]) -> list[str]:
    """검색 서버 요청·클릭 로그 단언과 랭킹 구간별 요약.

    Args:
        raw: 원천 디렉터리.
        check: 단언 기록 함수.
        ga_ids: GA search·select_search_result 이벤트의 search_id 집합.

    Returns:
        요약 마크다운 줄.
    """
    reqs: dict[str, dict[str, Any]] = {}
    with gzip.open(raw / "search_log.ndjson.gz", "rt", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            reqs[r["request_id"]] = r
    clicks = _read_csv(raw / "search_click_log.csv")
    first: dict[str, dict[str, str]] = {}
    orphan = bad = 0
    for c in clicks:
        r = reqs.get(c["request_id"])
        if r is None:
            orphan += 1
            continue
        pos, top = int(c["position"]), r["results"]
        hit = top[pos - 1] if 0 < pos <= len(top) else None
        if (
            r["results_count"] == 0
            or hit is None
            or (hit["item_type"], hit["item_id"]) != (c["item_type"], int(c["item_id"]))
        ):
            bad += 1
        first.setdefault(c["request_id"], c)
    check(
        "검색 클릭이 서버 요청에 있고 노출 목록의 그 순위 결과",
        orphan == 0 and bad == 0,
        f"요청 없음 {orphan} · 목록 불일치 {bad}",
    )
    check("검색 요청당 클릭 1건 이하", len(first) == len(clicks), f"클릭 {len(clicks):,} / 클릭 요청 {len(first):,}")

    def sdate(r: dict[str, Any]) -> date:
        return datetime.fromtimestamp(r["ga_session_id"], KST).date()

    bad_rk = sum(r["ranker_version"] != ranker_for(sdate(r), r["user_pseudo_id"]) for r in reqs.values())
    check("랭킹 버전 = 세션 시작일·기기 해시 규칙 (A/B 7/13~7/26, 7/27 전체 적용)", bad_rk == 0, f"위반 요청 {bad_rk}")
    extra = len(ga_ids["search"] - reqs.keys()) + len(ga_ids["select_search_result"] - first.keys())
    check("GA 검색·결과 클릭 이벤트의 search_id 가 서버 로그에 있음", extra == 0, f"없는 id {extra}")
    share = len(ga_ids["search"] & reqs.keys()) / max(1, len(reqs))
    check("GA search 수집률 97~99.5%", 0.97 <= share <= 0.995, f"{share:.4f}")

    def rates(rows: list[dict[str, Any]]) -> tuple[int, float, float]:
        n = max(1, len(rows))
        return (
            len(rows),
            sum(r["results_count"] == 0 for r in rows) / n,
            sum(r["request_id"] in first for r in rows) / n,
        )

    spans = [
        ("A/B 전 (v1)", lambda r: sdate(r) < RANKER_AB_START),
        ("A/B 대조군 (v1)", lambda r: RANKER_AB_START <= sdate(r) < RANKER_V2_ALL and r["ranker_version"] == "v1"),
        ("A/B 실험군 (v2)", lambda r: RANKER_AB_START <= sdate(r) < RANKER_V2_ALL and r["ranker_version"] == "v2"),
        (
            "전체 적용 후 (v2, 회귀 제외)",
            lambda r: sdate(r) >= RANKER_V2_ALL and not REINDEX_BUG[0] <= sdate(r) <= REINDEX_BUG[1],
        ),
        ("재색인 회귀 9/1~9/4", lambda r: REINDEX_BUG[0] <= sdate(r) <= REINDEX_BUG[1]),
    ]
    stat = {name: rates([r for r in reqs.values() if f(r)]) for name, f in spans}
    a, b = stat["A/B 대조군 (v1)"], stat["A/B 실험군 (v2)"]
    check(
        "A/B 기간 실험군 결과 0건 비율 < 대조군, 검색 성공률 > 대조군",
        b[1] < a[1] and b[2] > a[2],
        f"0건 {a[1]:.3f}→{b[1]:.3f} · 성공 {a[2]:.3f}→{b[2]:.3f}",
    )
    bug, after = stat["재색인 회귀 9/1~9/4"], stat["전체 적용 후 (v2, 회귀 제외)"]
    check(
        "재색인 회귀 기간 결과 0건 비율 > 전체 적용 후의 2배", bug[1] > 2 * after[1], f"{bug[1]:.3f} vs {after[1]:.3f}"
    )
    lines = ["", "## 검색 (세션 시작일 기준 구간)", "", "| 구간 | 요청 | 결과 0건 | 검색 성공률 |", "|---|---|---|---|"]
    lines += [f"| {k} | {n:,} | {z:.3f} | {c:.3f} |" for k, (n, z, c) in stat.items()]
    return lines


def _churn(raw: Path, check: Any, end_date: date) -> list[str]:
    """이용·판매와 해지의 연결 검사 2개.

    - 구독 회차 해지율: 직전 회차에 파트너 티켓을 멤버 할인으로 결제한 구독 ÷ 안 한 구독 (0.7 이하)
    - 계약 월 해지율: 직전 3개월(계약 3개월 미만이면 있는 달) 월평균 파트너 거래액 하위 1/3 ÷ 상위 1/3 (1.5 이상)

    Args:
        raw: 원천 디렉터리.
        check: 단언 기록 함수.
        end_date: 마지막 날(KST).

    Returns:
        요약 마크다운 줄.
    """
    subs = _read_csv(raw / "db_subscriptions.csv")
    pays = [p for p in _read_csv(raw / "db_payments.csv") if p["kind"] == "ticket"]
    disc: dict[str, list[date]] = defaultdict(list)
    for p in pays:
        if int(p["discount_amount"] or 0) > 0:
            disc[p["member_id"]].append(_kst_date(p["paid_at"]))
    end_excl = end_date + timedelta(days=1)
    risk = {True: [0, 0], False: [0, 0]}
    for sb in subs:
        s0 = _kst_date(sb["started_at"])
        ended = _kst_date(sb["ended_at"]) if sb["ended_at"] else None
        k = 2
        while True:
            p0 = _add_months(datetime(s0.year, s0.month, s0.day), k - 2).date()
            w0 = _add_months(datetime(s0.year, s0.month, s0.day), k - 1).date()
            w1 = _add_months(datetime(s0.year, s0.month, s0.day), k).date()
            if (ended is not None and ended < w0) or w0 >= end_excl:
                break
            canceled = ended is not None and w0 <= ended < w1
            if w1 > end_excl and not canceled:
                break
            used = any(p0 <= x < w0 for x in disc.get(sb["member_id"], []))
            risk[used][0] += canceled
            risk[used][1] += 1
            if canceled:
                break
            k += 1
    r_used = risk[True][0] / max(1, risk[True][1])
    r_none = risk[False][0] / max(1, risk[False][1])
    sub_ratio = r_used / r_none if r_none else float("inf")
    check(
        "구독 회차 해지율: 직전 회차 파트너 티켓 할인 결제 있음 ÷ 없음 ≤ 0.7",
        sub_ratio <= 0.7,
        f"{sub_ratio:.3f} ({r_used:.4f} / {r_none:.4f})",
    )

    ev_venue = {e["event_id"]: e["venue_id"] for e in _read_csv(raw / "db_events.csv")}
    gmv: dict[tuple[str, str], int] = defaultdict(int)
    for p in pays:
        if p["status"] == "paid":
            d = _kst_date(p["paid_at"])
            gmv[(ev_venue[p["event_id"]], f"{d.year:04d}-{d.month:02d}")] += int(p["amount"]) + int(
                p["discount_amount"] or 0
            )
    cons = _read_csv(raw / "db_venue_contracts.csv")
    tiers = {0: [0, 0], 2: [0, 0]}
    m = date(2025, 10, 1)
    while _add_months(datetime(m.year, m.month, 1), 1).date() <= end_excl:
        nxt = _add_months(datetime(m.year, m.month, 1), 1).date()
        rows = []
        for c in cons:
            st = _kst_date(c["started_at"])
            en = _kst_date(c["ended_at"]) if c["ended_at"] else None
            if not (st < m and (en is None or en >= m)):
                continue
            hist = [_add_months(datetime(m.year, m.month, 1), -k).date() for k in (1, 2, 3)]
            hist = [h for h in hist if _add_months(datetime(h.year, h.month, 1), 1).date() > st]
            if not hist:
                continue
            avg = sum(gmv.get((c["venue_id"], f"{h.year:04d}-{h.month:02d}"), 0) for h in hist) / len(hist)
            rows.append((avg, c["contract_id"], en is not None and en < nxt))
        rows.sort()
        third = len(rows) // 3
        for t, part in ((0, rows[:third]), (2, rows[len(rows) - third :])):
            tiers[t][0] += sum(x[2] for x in part)
            tiers[t][1] += len(part)
        m = nxt
    r_low = tiers[0][0] / max(1, tiers[0][1])
    r_high = tiers[2][0] / max(1, tiers[2][1])
    con_ratio = r_low / r_high if r_high else float("inf")
    check(
        "계약 월 해지율: 직전 3개월 파트너 거래액 하위 1/3 ÷ 상위 1/3 ≥ 1.5",
        con_ratio >= 1.5,
        f"{con_ratio:.3f} ({r_low:.4f} / {r_high:.4f})",
    )

    def frac(x: list[int]) -> str:
        return f"{x[0] / max(1, x[1]):.4f} ({x[0]}/{x[1]})"

    return [
        "",
        "## 이용·판매와 해지",
        "",
        "| 검사 | 값 | 분자 | 분모 |",
        "|---|---|---|---|",
        f"| 구독 회차 해지율 (직전 회차 할인 결제 유무) | {sub_ratio:.3f} | {frac(risk[True])} | {frac(risk[False])} |",
        f"| 계약 월 해지율 (거래액 하위 1/3 ÷ 상위 1/3) | {con_ratio:.3f} | {frac(tiers[0])} | {frac(tiers[2])} |",
    ]


def week_of_date(d: date, start_date: date) -> int:
    """관측 시작일 기준 주 번호(0부터)."""
    return (d - start_date).days // 7


def _is_auto(s: Sess) -> bool:
    return s.eng == 0 and s.screens <= 1 and not s.key and (s.ts_max - s.ts_min) <= 2_000_000


def _summary(
    sessions: dict,
    names: Counter,
    person_of: dict,
    apps: list,
    pays: list,
    members: list,
    ads: list,
    start_date: date,
    weeks: int,
    n_rows: int,
    n_clients: int,
    n_persons: int,
) -> tuple[str, dict[int, float]]:
    def week_of(d: str) -> int:
        return (date.fromisoformat(d) - start_date).days // 7

    wk_persons: dict[int, set[str]] = defaultdict(set)
    wk_sessions: Counter[int] = Counter()
    person_days: dict[str, set[date]] = defaultdict(set)
    day_persons: dict[str, set[str]] = defaultdict(set)
    medium: Counter[str] = Counter()
    source_medium: Counter[str] = Counter()
    dow_hour: Counter[tuple[int, int]] = Counter()
    funnel = Counter()
    n_auto = 0
    member_sessions = 0
    engaged = 0
    for s in sessions.values():
        if _is_auto(s):
            n_auto += 1
            continue
        p = person_of.get(s.client, s.client)
        w = week_of(s.date)
        wk_persons[w].add(p)
        wk_sessions[w] += 1
        person_days[p].add(date.fromisoformat(s.date))
        day_persons[s.date].add(p)
        medium[s.medium] += 1
        source_medium[f"{s.source} / {s.medium}"] += 1
        t = datetime.fromtimestamp(s.ts_min // 1_000_000, KST)
        dow_hour[(t.isoweekday(), t.hour)] += 1
        member_sessions += bool(s.users)
        engaged += s.engaged
        funnel["landing"] += 1
        if s.detail:
            funnel["detail_view"] += 1
            if s.identified:
                funnel["identified"] += 1
                if s.apply_form:
                    funnel["apply_form"] += 1
                    if s.applied:
                        funnel["applied"] += 1
    visit_sessions = len(sessions) - n_auto

    wk_signup: Counter[int] = Counter(week_of(m["signed_up_at"][:10]) for m in members)
    wk_apply: Counter[int] = Counter(week_of(a["applied_at"][:10]) for a in apps)
    wk_pay: Counter[int] = Counter()
    wk_amount: Counter[int] = Counter()
    for p in pays:
        w = week_of(p["paid_at"][:10])
        wk_pay[w] += 1
        wk_amount[w] += int(p["amount"])
    wk_spend: Counter[int] = Counter()
    for a in ads:
        wk_spend[week_of(a["date"])] += int(a["spend"])

    # 첫 방문 주 코호트 리텐션 (사람 단위, 완결 코호트만)
    first_week: dict[str, int] = {}
    visit_weeks: dict[str, set[int]] = {}
    for p, days in person_days.items():
        ws = {(d - start_date).days // 7 for d in days}
        first_week[p] = min(ws)
        visit_weeks[p] = ws
    ret = {}
    for off in RET_OFFSETS:
        num = den = 0
        for p, fw in first_week.items():
            if fw + off < weeks:
                den += 1
                num += (fw + off) in visit_weeks[p]
        ret[off] = num / den if den else 0.0

    daily = sorted(len(v) for v in day_persons.values())
    out: list[str] = [
        "# Placewave 합성 데이터 요약",
        "",
        "합성 데이터 · 실제 서비스 데이터 아님. `generator/validate.py` 생성물.",
        "",
        "## 규모",
        "",
        "| 항목 | 값 |",
        "|---|---|",
        f"| 이벤트 행 | {n_rows:,} |",
        f"| 세션 (자동 로드 포함) | {len(sessions):,} |",
        f"| 자동 로드 세션 비중 | {n_auto / len(sessions):.3f} |",
        f"| 기기 / 사람 | {n_clients:,} / {n_persons:,} |",
        f"| 회원 (가입) | {len(members):,} ({len(members) / n_persons:.1%}) |",
        f"| 신청 / 결제 / 취소 | {len(apps):,} / {len(pays):,} / {sum(a['status'] == 'canceled' for a in apps):,} |",
        f"| 티켓 결제 금액 합 (원, 환불 포함) | {sum(int(p['amount']) for p in pays):,} |",
        f"| 일 방문 사람 p10 / p50 / p90 | {daily[len(daily) // 10]} / {daily[len(daily) // 2]} / "
        f"{daily[len(daily) * 9 // 10]} |",
        f"| 방문 세션 중 회원 세션 | {member_sessions / visit_sessions:.3f} |",
        f"| 방문 세션 중 engaged | {engaged / visit_sessions:.3f} |",
        "",
        "## 주별 추이",
        "",
        "| 주 | 시작일 | 방문 사람 | 방문 세션 | 가입 | 신청 | 결제 | 결제 금액 | 광고비 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for w in range(weeks):
        out.append(
            f"| {w + 1} | {start_date + timedelta(days=7 * w)} | {len(wk_persons[w]):,} | {wk_sessions[w]:,} "
            f"| {wk_signup[w]} | {wk_apply[w]} | {wk_pay[w]} | {wk_amount[w]:,} | {wk_spend[w]:,} |"
        )
    out += ["", "## 세션 채널 비중 (방문 세션, medium)", "", "| medium | 비중 |", "|---|---|"]
    out += [f"| {k} | {v / visit_sessions:.3f} |" for k, v in medium.most_common()]
    out += ["", "상위 source / medium", "", "| source / medium | 비중 |", "|---|---|"]
    out += [f"| {k} | {v / visit_sessions:.3f} |" for k, v in source_medium.most_common(10)]
    dows = "월화수목금토일"
    out += ["", "## 요일 × 시(KST) 상위 10 (방문 세션 시작)", "", "| 요일 | 시 | 비중 |", "|---|---|---|"]
    out += [f"| {dows[d - 1]} | {h:02d} | {v / visit_sessions:.4f} |" for (d, h), v in dow_hour.most_common(10)]
    seed_funnel = {r["step_key"]: float(r["rate_of_landing"]) for r in _read_csv(SEED_DIR / "funnel_steps.csv")}
    out += ["", "## 세션 퍼널 (랜딩 대비, 누적 조건)", "", "| 단계 | 합성 | seed |", "|---|---|---|"]
    for k in ("landing", "detail_view", "identified", "apply_form", "applied"):
        out.append(f"| {k} | {funnel[k] / funnel['landing']:.3f} | {seed_funnel[k]:.3f} |")
    out += [
        "",
        "## 첫 방문 주 코호트 리텐션 (사람, 완결 코호트)",
        "",
        "| 오프셋 | 리텐션 |",
        "|---|---|",
    ]
    out += [f"| W{o} | {ret[o]:.3f} |" for o in RET_OFFSETS]
    out += ["", "## 이벤트명별 행 수", "", "| event_name | 행 수 | 비중 |", "|---|---|---|"]
    out += [f"| {k} | {v:,} | {v / n_rows:.4f} |" for k, v in names.most_common()]
    return "\n".join(out) + "\n", ret


def main() -> None:
    """CLI 진입점."""
    ap = argparse.ArgumentParser(description="Placewave 합성 데이터 검증")
    ap.add_argument("--data", type=Path, default=Path("data"))
    ap.add_argument("--weeks", type=int, default=52)
    ap.add_argument("--end-date", type=date.fromisoformat, default=date(2026, 9, 20))
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    checks, summary = validate(args.data, args.weeks, args.end_date)
    lines = [f"| {'통과' if ok else '실패'} | {name} | {detail} |" for name, ok, detail in checks]
    summary = summary.replace(
        "## 규모", "## 단언\n\n| 결과 | 항목 | 상세 |\n|---|---|---|\n" + "\n".join(lines) + "\n\n## 규모", 1
    )
    (args.data / "summary.md").write_text(summary, encoding="utf-8")
    for name, ok, detail in checks:
        (logger.info if ok else logger.error)("%s %s %s", "PASS" if ok else "FAIL", name, detail)
    if not all(ok for _, ok, _ in checks):
        sys.exit(1)
    logger.info("전부 통과 -> %s", args.data / "summary.md")


if __name__ == "__main__":
    main()
