"""Placewave 합성 데이터 생성기.

가상 서비스 Placewave 의 GA4 export 형태 이벤트 로그와 서비스 원장(회원·공간·행사·신청·결제·광고비)을
한 루프에서 함께 만든다. 입력은 `generator/seed/` 의 분포 파일(비율·분위수·전이 확률)뿐이며,
절대 규모는 CLI 인자로 새로 정한다. 실제 서비스 데이터가 아니다.

실행:
    uv run generator/generate.py --seed 20260923 --weeks 52 --persons 80000 \
        --end-date 2026-09-20 --out data/
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
from search_engine import Catalog, Result, SearchEngine, ranker_for, reindex_bug

logger = logging.getLogger("placewave.generate")

SEED_DIR = Path(__file__).resolve().parent / "seed"
KST = timezone(timedelta(hours=9))

CHAIN_SCREENS = [
    "home",
    "map_main",
    "search_main",
    "search_result",
    "venue_detail",
    "venue_review",
    "event_detail",
    "event_apply",
]
END = "(end)"
KEY_EVENTS = {"sign_up", "apply_event", "purchase", "share", "cancel_apply", "subscribe", "subscription_cancel"}

# 시나리오 4구간: (이름, 시작 주, 끝 주, 신규 유입 가중, 재방문 배수, 신청 전환 배수, 주당 행사 수 (구간 시작, 끝))
PHASES = [
    ("launch", 1, 10, None, 0.85, 0.9, (15, 25)),
    ("ads", 11, 24, 0.85, 0.8, 0.9, (30, 45)),
    ("stable", 25, 40, 0.9, 1.15, 1.0, (45, 55)),
    ("peak", 41, 52, 1.2, 1.25, 1.3, (55, 65)),
]
# 월별 계절 계수 (KST 월)
SEASON = {1: 0.85, 2: 0.85, 3: 0.95, 4: 1.0, 5: 1.05, 6: 1.05, 7: 1.15, 8: 1.2, 9: 1.0, 10: 1.05, 11: 0.95, 12: 1.2}

RETURN_BASE = 0.025  # 일반층 재방문 일 확률 척도
CASUAL_SIGMA = 0.5  # 일반층 재방문 성향의 개인차 (로그정규 sigma). 클수록 생존 편향으로 긴 꼬리가 두꺼워진다
CASUAL_TAIL = (0.5, 0.3, 0.2, 0.1)  # seed 곡선 W2·W4·8주·이후 바닥에 곱하는 보정 (개인차 생존 편향 상쇄)
CORE_SHARE = (0.15, 0.08)  # 단골층 비중 (비광고, 광고 유입). W4 이후 리텐션의 바닥을 만든다
CORE_DAILY = (
    0.15  # 단골층 일 방문 확률 척도. 전체 규모 보정용 손잡이 (자연 유입 신규 하루 400~700명 규모에서 행 수 유지)
)
CORE_LIFE_WEEKS = 35.0  # 단골 유지 기간 평균(지수분포). 이후는 일반층 곡선의 바닥값을 따른다
CORE_SESSIONS_PER_DAY = ([1, 2, 3, 4], [0.4, 0.3, 0.2, 0.1])  # 단골층 방문일의 세션 수
POPULARITY_TEMPER = 0.6  # seed 조회 집중도 지수 완화 (1위 행사 쏠림이 주 단위 지표를 흔들지 않게)
DOW_OUTLIER = 1.5  # 요일 합이 중앙값의 이 배수를 넘으면 seed 이상치로 본다
PAID_NEW_SHARE = 0.45  # 광고 유입 세션 중 신규 사람 비중
AD_SESSION_RATIO = 0.8  # 광고 유입 세션 / 클릭 기본값. 캠페인별로 0.6~0.9 에서 흔든다 (랜딩 이탈·추적 누락)
AD_BUDGET_SCALE = 70.0  # names.json 캠페인 일 예산 배수. 집행 구간 광고 세션 비중 보정용 (persons 규모에 비례)
SIGNUP_INTENT = (0.5, 0.09)  # 가입 의향 비중 (단골층, 일반층). 실현 가입률은 방문 횟수에 따라 더 낮다
SECOND_DEVICE = 0.5  # 가입 의향자 중 2번째 기기 보유 비중 (실현 비중은 가입 후 재방문에 달림)
DEVICE2_USE = 0.5  # 가입 이후 방문에서 2번째 기기를 쓸 확률
GA_SEARCH_LOSS = 0.015  # 검색·결과 클릭 GA 이벤트가 수집되지 않는 비중 (서버 로그에는 남는다)
REFORM_SAME = 0.6  # 결과를 누르지 않고 다시 검색할 때 같은 대상을 다시 찾는 비중 (나머지는 다른 검색어)
ZERO_RESEARCH = 1.8  # 결과 0건이면 다시 검색할 가중 배수
# 결과를 누르지 않은 검색 뒤 세션을 끝낼 확률 (결과 0건 / 결과는 있으나 클릭 없음). seed 전이에는 검색 결과 뒤
# 종료가 없어, 클릭을 검색 엔진이 정하면 실패한 검색도 결국 같은 비율로 신청에 닿아 검색 품질이 신청과 무관해진다
ZERO_EXIT = 0.35
NOCLICK_EXIT = 0.20
CANCEL_PER_SESSION = 0.03  # 보유 신청 1건당 이후 세션에서 취소할 확률
PAY_SUCCESS = 0.71  # 유료 행사 신청 후 결제 완료 비율
MEMBER_APPLY_NUDGE = 0.10  # 로그인 회원이 행사 상세에서 신청 화면으로 바로 가는 추가 확률 (연 티켓 매출 규모 보정)
APPLY_MULT = 2.2  # 신청 화면 도달 후 신청 확률 = seed 단계 비율 x 구간 배수 x 이 값
PROMO_SELECT = 0.3  # 배너 노출 대비 선택 비율
SESSIONS_PER_DAY = ([1, 2, 3], [0.93, 0.05, 0.02])

# 시나리오 2.0 — 공간 두 층·구독·B2B 계약 (docs/scenario_v2.md)
EVENT_SCALE = 1.07  # 주당 행사 수 배수 (구간 곡선 합이 연 2,400건 근처가 되게)
REGISTRY_ANCHORS = ((0, 300), (10, 600), (24, 1000), (40, 1400), (52, 1800))  # (주 끝, 등록 공간 누적)
PARTNER_ANCHORS = ((0, 8), (10, 30), (24, 80), (40, 130), (52, 180))  # (주 끝, 진행 계약 수)
SUB_ANCHORS = ((24, 500), (40, 1300), (52, 2000))  # (주 끝, 활성 구독자). 출시일에 0
SUB_LAUNCH = date(2025, 12, 1)
SUB_PRICE = 9900
SUB_DISCOUNT = 0.15  # 구독자의 파트너 공간 티켓 할인율
SUB_HAZARD = 0.06  # 구독 결제 회차당 기본 해지 확률. 회차의 계획 방문일 수에 따라 SUB_USE_MULT 를 곱한다
SUB_USE_MULT = (1.8, 1.0, 0.5)  # 회차 방문 0일 · 1~2일 · 3일 이상의 해지 배수 (혜택을 안 쓰는 구독자가 더 해지한다)
SUB_CORE_WEIGHT = 3.0  # 구독 후보 추첨 시 단골층 가중
SUB_VIEW_P = (0.008, 0.04)  # 세션당 구독 안내 조회 확률 (비회원, 비구독 회원)
CONTRACT_CHURN = (0.015, 0.025)  # 파트너 계약 월 해지율 범위 (월마다 추첨)
# 진행 계약 안 인기 지수(판매 대리값) 하위·중위·상위 1/3 의 해지 배수. 그달 평균 1로 정규화
CONTRACT_SELL_MULT = (1.6, 1.0, 0.5)
PLAN_CHANGE_MONTHLY = (0.01, 0.02)  # 진행 계약 중 그달 플랜을 바꾸는 비율 범위 (월마다 추첨). 요금은 names.json pricing
PLAN_UPGRADE_SHARE = 0.8  # 플랜 변경 중 basic -> pro 비중 (나머지 pro -> basic)
PLAN_PRO_SHARE = 0.3
VENUE_CLOSE_SHARE = 0.03  # 기간 안 폐업 공간 비중
VENUE_PARETO = 1.3  # 공간 개별 인기 지수 파레토 모양
PARTNER_VIEW_MULT = 2.5  # 파트너 공간 상세 조회 가중
PARTNER_EVENT_SHARE = 0.75  # 파트너 공간 개최 비중
EVENT_FUTURE_WEEKS = 6  # 관측 종료 후 예정 행사 생성 주 수 (원장에 미래 개최 행사 포함)
HOST_POP_TEMPER = 0.5  # 개최 공간 추첨 시 인기 지수 완화 (파트너 선정에 이미 인기가 반영돼 이중 쏠림 방지)
# 가격대: (이름, 비중, 가격 하한, 상한, 단위, 신청 확률 배수)
PRICE_TIERS = (
    ("free", 0.20, 0, 0, 1, 1.0),
    ("standard", 0.45, 15000, 30000, 1000, 1.0),
    ("premium", 0.30, 40000, 80000, 5000, 0.75),
    ("package", 0.05, 100000, 180000, 10000, 0.55),
)
AD_SPEND_SCALE = 0.62  # 광고비만 조정하는 배수 (노출·클릭은 그대로, CPM 이 바뀐다). 연 광고비 ≈ 연 티켓 매출의 10%


# ---------------------------------------------------------------- seed 로드


def _read_csv(name: str) -> list[dict[str, str]]:
    with open(SEED_DIR / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


@dataclass
class Seed:
    """seed 분포 묶음."""

    hour_cdf: np.ndarray  # [7, 24] 요일별 시(KST) 누적분포
    dow_weight: np.ndarray  # [7] 요일 가중 (평균 1)
    quantiles: dict[str, tuple[np.ndarray, np.ndarray]]
    shares: dict[str, float]
    device_platform: dict[str, float]
    organic_channels: list[tuple[str, str, str]]  # (source, medium, campaign)
    organic_weights: np.ndarray
    ad_ratio: dict[str, float]
    retention_shape: dict[int, float]  # 주 오프셋 -> W1 대비 비율
    event_reach: dict[str, tuple[float, float]]  # seed 이벤트명 -> (session_reach, per_session)
    screen_seed_share: dict[str, float]  # 출력 화면 -> seed 화면 비중 합
    funnel: dict[str, float]
    event_popularity: np.ndarray
    region_share: np.ndarray
    genre_share: np.ndarray
    chain: dict[str, tuple[list[str], np.ndarray]]
    names: dict[str, Any]


def _collapse_chain() -> dict[str, tuple[list[str], np.ndarray]]:
    """seed 전이 확률을 출력 화면 사이의 전이로 접는다.

    비화면 이벤트와 범위 밖 화면(`(other_screen)`)·결제 화면은 통과 노드로 두고, 흡수 마르코프 연쇄로
    '다음에 처음 닿는 출력 화면 또는 종료' 확률을 푼다. 상위 전이만 있는 행은 행 합으로 재정규화한다.

    Returns:
        출력 화면(및 `(start)`) -> (다음 상태 목록, 확률).
    """
    rows = _read_csv("transitions.csv")
    nodes = sorted({r["from_node"] for r in rows} | {r["to_node"] for r in rows} | {END})
    idx = {n: i for i, n in enumerate(nodes)}
    n = len(nodes)
    p = np.zeros((n, n))
    mass = np.zeros(n)
    for r in rows:
        p[idx[r["from_node"]], idx[r["to_node"]]] += float(r["prob"])
        mass[idx[r["from_node"]]] = float(r["from_share"])
    for i in range(n):
        s = p[i].sum()
        if s == 0:
            p[i, idx[END]] = 1.0
        else:
            p[i] /= s

    def target(node: str) -> str | None:
        if node == END:
            return END
        if node.startswith("screen_view:"):
            out = node.split(":", 1)[1]
            if out in CHAIN_SCREENS:
                return out
        return None

    targets = CHAIN_SCREENS + [END]
    tpos = {t: k for k, t in enumerate(targets)}
    absorbing = {i: tpos[t] for i, node in enumerate(nodes) if (t := target(node)) is not None}
    trans = [i for i in range(n) if i not in absorbing]
    q = p[np.ix_(trans, trans)]
    r = np.zeros((len(trans), len(targets)))
    for a, k in absorbing.items():
        r[:, k] += p[trans, a]
    h_trans = np.linalg.solve(np.eye(len(trans)) - q, r)
    hit = np.zeros((n, len(targets)))
    for pos, i in enumerate(trans):
        hit[i] = h_trans[pos]
    for a, k in absorbing.items():
        hit[a, k] = 1.0

    chain: dict[str, tuple[list[str], np.ndarray]] = {}
    sources: dict[str, list[int]] = {s: [] for s in CHAIN_SCREENS}
    for i, node in enumerate(nodes):
        t = target(node)
        if t in sources:
            sources[t].append(i)
    for s, members in sources.items():
        w = np.array([max(mass[i], 1e-9) for i in members])
        dist = (w[:, None] * (p[members] @ hit)).sum(axis=0) / w.sum()
        chain[s] = (targets, dist / dist.sum())
    start = p[idx["(start)"]] @ hit
    start[tpos[END]] = 0.0  # 랜딩은 항상 화면이 있다. 화면 없는 세션은 자동 로드로 따로 만든다
    chain["(start)"] = (targets, start / start.sum())
    return chain


def load_seed() -> Seed:
    """seed 디렉터리의 분포 파일을 읽어 생성기 입력으로 변환한다.

    Returns:
        Seed 묶음.
    """
    names = json.loads((SEED_DIR / "names.json").read_text(encoding="utf-8"))

    tp = np.zeros((7, 24))
    for r in _read_csv("time_pattern.csv"):
        tp[int(r["dow_iso"]) - 1, int(r["hour_kst"])] = float(r["session_share"])
    dow_total = tp.sum(axis=1)
    # seed 창(8주)의 단발 급증 요일은 매주 반복되지 않게 정상 요일 평균으로 바꾼다
    med = float(np.median(dow_total))
    outlier = dow_total > med * DOW_OUTLIER
    if outlier.any():
        normal = tp[~outlier] / dow_total[~outlier, None]
        tp[outlier] = normal.mean(axis=0) * med
        dow_total = tp.sum(axis=1)
    hour_cdf = np.cumsum(tp / dow_total[:, None], axis=1)

    quantiles: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    shares: dict[str, float] = {}
    device_platform: dict[str, float] = {}
    qp = {"p10": 0.10, "p25": 0.25, "p50": 0.50, "p75": 0.75, "p90": 0.90, "p99": 0.99}
    tmp: dict[str, list[tuple[float, float]]] = {}
    for r in _read_csv("session_shape.csv"):
        if r["key"] in qp:
            tmp.setdefault(r["metric"], []).append((qp[r["key"]], float(r["value"])))
        elif r["metric"] == "share_device_platform":
            device_platform[r["key"]] = float(r["value"])
        else:
            shares[r["metric"]] = float(r["value"])
    for m, pts in tmp.items():
        pts.sort()
        quantiles[m] = (np.array([p for p, _ in pts]), np.array([v for _, v in pts]))
    device_platform.pop("unknown", None)

    medium_of = {
        "social": "social",
        "influencer": "influencer",
        "search": "organic",
        "referral": "referral",
        "store": "referral",
        "ai": "referral",
    }
    organic: dict[tuple[str, str, str], float] = {}
    ad_ratio: dict[str, float] = {}
    for r in _read_csv("channel_mix.csv"):
        if r["kind"] == "ad_ratio":
            ad_ratio[r["metric"]] = float(r["value"])
            continue
        if r["metric"] != "session_share" or r["channel1"] != "non_paid":
            continue
        c2, c3 = r["channel2"], r["channel3"]
        if c2 == "internal" or c3 in ("unknown", "other"):
            continue
        if c2 == "direct":
            key = ("(direct)", "(none)", "(direct)")
        else:
            med = medium_of[c2]
            camp = {"organic": "(organic)", "referral": "(referral)"}.get(med, "(not set)")
            key = (c3, med, camp)
        organic[key] = organic.get(key, 0.0) + float(r["value"])
    organic_channels = sorted(organic)
    ow = np.array([organic[k] for k in organic_channels])

    ret = {}
    for r in _read_csv("retention.csv"):
        if r["scope"] == "overall" and r["basis"] == "member":
            ret[int(r["week_offset"])] = float(r["retention_rate"])
    retention_shape = {k: v / ret[1] for k, v in ret.items()}

    event_reach = {
        r["event_name"]: (float(r["session_reach"]), float(r["per_session_when_present"]))
        for r in _read_csv("event_mix.csv")
    }

    screen_seed_share = {r["screen_name"]: float(r["screen_view_share"]) for r in _read_csv("screen_mix.csv")}

    funnel = {r["step_key"]: float(r["rate_of_prev"] or r["rate_of_landing"]) for r in _read_csv("funnel_steps.csv")}

    pop_e = np.array([float(r["view_share"]) for r in _read_csv("popularity.csv") if r["entity"] == "event"])

    nm = _read_csv("name_map.csv")
    region_share = np.array([float(r["share"]) for r in names["regions"]])
    genres = sorted(
        (float(r["share"]) for r in nm if r["kind"] == "venue_genre_ga" and r["value"] not in ("MIX", "(unset)")),
        reverse=True,
    )
    genre_share = np.array(genres[: len(names["genres"])])

    return Seed(
        hour_cdf=hour_cdf,
        dow_weight=dow_total / dow_total.mean(),
        quantiles=quantiles,
        shares=shares,
        device_platform=device_platform,
        organic_channels=organic_channels,
        organic_weights=ow / ow.sum(),
        ad_ratio=ad_ratio,
        retention_shape=retention_shape,
        event_reach=event_reach,
        screen_seed_share=screen_seed_share,
        funnel=funnel,
        event_popularity=pop_e**POPULARITY_TEMPER / (pop_e**POPULARITY_TEMPER).sum(),
        region_share=region_share / region_share.sum(),
        genre_share=genre_share / genre_share.sum(),
        chain=_collapse_chain(),
        names=names,
    )


# ---------------------------------------------------------------- 도메인 객체


@dataclass
class Venue:
    """공간 원장 1행."""

    venue_id: int
    name: str
    region: int
    district: str
    lat: float
    lng: float
    genre: int
    venue_type: str
    capacity_band: str
    reg_day: int  # 등록일 (기간 시작 기준 일 번호). 초기 일괄 등록은 0
    reg_ts: int  # 등록 시각 UTC epoch 초
    close_day: int  # 폐업일. 폐업하지 않으면 큰 값
    pop: float  # 개별 인기 지수 (파레토)


@dataclass
class EventItem:
    """행사 원장 1행."""

    event_id: int
    venue_id: int
    name: str
    event_type: str
    starts_at: int  # UTC epoch 초
    publish_at: int
    genre: int
    price_tier: str
    price: int
    weight: float
    capacity: int
    is_partner: bool
    apply_mult: float
    seats: int = 0  # 신청(결제 대기 제외)으로 찬 자리


@dataclass
class Device:
    """기기(client_id) 상태."""

    client_id: str
    category: str
    os: str
    platform: str
    session_number: int = 0
    user_id: str | None = None


@dataclass
class Person:
    """사람 상태. 생성기 안에서만 존재하고 출력에는 client_id·user_id 로만 드러난다."""

    pid: int
    first_day: int
    first_channel: tuple[str, str, str, str]  # source, medium, campaign, content
    region: int
    genres: list[int]
    will_signup: bool
    signup_visit: int
    has_dev2: bool
    devices: list[Device] = field(default_factory=list)
    member_id: str | None = None
    marketing_opt_in: bool = False
    applied_events: set[int] = field(default_factory=set)
    open_apps: list[dict[str, Any]] = field(default_factory=list)
    sub_plan: tuple[int, int | None] | None = None  # (구독 시작 예정일, 해지 예정일)
    sub_id: str | None = None
    sub_active: bool = False
    sub_canceled: bool = False
    genre_mask: np.ndarray | None = None


# ---------------------------------------------------------------- 생성기


class Generator:
    """합성 세계 전체를 만드는 상태 기계."""

    def __init__(self, seed: Seed, rng_seed: int, weeks: int, persons: int, end_date: date) -> None:
        """생성기를 초기화한다.

        Args:
            seed: seed 분포 묶음.
            rng_seed: 난수 시드.
            weeks: 기간(주). 마지막 날은 end_date.
            persons: 사람 수.
            end_date: 마지막 날(KST).
        """
        self.s = seed
        self.rng = np.random.default_rng(rng_seed)
        self.plan_rng = np.random.default_rng([rng_seed, 2])  # 플랜 변경 전용 (주 난수열 보존)
        self.weeks = weeks
        self.n_days = weeks * 7
        self.n_persons = persons
        self.start_date = end_date - timedelta(days=self.n_days - 1)
        self.end_date = end_date
        self.day0 = int(
            datetime(self.start_date.year, self.start_date.month, self.start_date.day, tzinfo=KST).timestamp()
        )
        self.range_end = self.day0 + self.n_days * 86400
        self.host = seed.names["service"]["host"]
        self.phase_of_day = [self._phase(d // 7 + 1) for d in range(self.n_days)]
        self.ledger: dict[str, list[dict[str, Any]]] = {
            k: []
            for k in (
                "members",
                "venues",
                "contracts",
                "contract_changes",
                "events_master",
                "applications",
                "payments",
                "subscriptions",
                "ad_spend",
            )
        }
        self.order_seq = 0
        self.member_seq = 0
        self.sub_seq = 0
        self.end_cap = self.range_end
        self.sub_recs: dict[str, dict[str, Any]] = {}
        self.sub_launch_day = max((SUB_LAUNCH - self.start_date).days, 0)
        self.rows = 0
        self.venue_by_id: dict[int, Venue] = {}
        self.search_rng = np.random.default_rng([rng_seed, 31])  # 검색 엔진·클릭 모델 전용
        self.search_log: list[dict[str, Any]] = []
        self.search_clicks: list[dict[str, Any]] = []
        self.req_seq = 0

    # ---- 공통 도우미

    def _phase(self, week: int) -> tuple[str, float | None, float, float, tuple[int, int]]:
        for name, a, b, arrive, ret, conv, per_week in PHASES:
            if a <= week <= b:
                return name, arrive, ret, conv, per_week
        return PHASES[-1][0], PHASES[-1][3], PHASES[-1][4], PHASES[-1][5], PHASES[-1][6]

    def _day_date(self, d: int) -> date:
        return self.start_date + timedelta(days=d)

    def _season(self, d: int) -> float:
        return SEASON[self._day_date(d).month]

    def _dow(self, d: int) -> int:
        return self._day_date(d).isoweekday() - 1

    def _quantile(self, metric: str, u: float) -> float:
        probs, vals = self.s.quantiles[metric]
        xp = np.concatenate([[0.0], probs, [1.0]])
        fp = np.concatenate([[max(0.0, vals[0] * 0.5)], vals, [vals[-1] * 1.5]])
        return float(np.interp(u, xp, fp))

    def _choice(self, weights: np.ndarray) -> int:
        c = np.cumsum(weights)
        return min(int(np.searchsorted(c, self.rng.random() * c[-1], side="right")), len(c) - 1)

    # ---- 카탈로그

    def _anchor(self, anchors: tuple[tuple[int, int], ...], d: float) -> float:
        """(주 끝, 값) 기준점 사이를 선형 보간해 d 일의 값을 돌려준다."""
        xs = [max(w * 7 - 1, 0) for w, _ in anchors]
        return float(np.interp(d, xs, [v for _, v in anchors]))

    def _visible(self, reg_day: np.ndarray, d: int) -> np.ndarray:
        """d 일에 서비스에 보이는 공간 (초기 일괄 등록은 첫날부터, 나머지는 등록 다음 날부터)."""
        return (reg_day == 0) | (reg_day < d)

    def build_registry(self) -> None:
        """등록 공간 목록(상권·좌표·장르·유형·규모·등록일·폐업)과 파트너 계약 이력을 만든다."""
        nm = self.s.names
        rng = self.rng
        n_days = self.n_days
        regions = nm["regions"]
        init = REGISTRY_ANCHORS[0][1]
        total = int(round(self._anchor(REGISTRY_ANCHORS, n_days - 1)))
        # 등록일: 초기 일괄 + 누적 곡선의 일 증가분(평일 가중·일별 흔들림)
        cum = np.array([self._anchor(REGISTRY_ANCHORS, d) for d in range(n_days)])
        inc = np.diff(np.concatenate([[init], cum])) + 1e-9
        inc *= np.array([1.2 if self._dow(d) < 5 else 0.5 for d in range(n_days)]) * rng.uniform(0.6, 1.4, n_days)
        inc[0] = 0.0
        reg_days = np.concatenate(
            [np.zeros(init, dtype=int), np.sort(rng.choice(n_days, size=total - init, p=inc / inc.sum()))]
        )
        # 상권: 비중대로 정확히 나눈 뒤(최대 잔여법) 섞는다 — 상권 비중은 시간에 따라 고정
        share = np.array([r["share"] for r in regions])
        quota = share * total
        counts = np.floor(quota).astype(int)
        for i in np.argsort(-(quota - counts))[: total - counts.sum()]:
            counts[i] += 1
        region_of = rng.permutation(np.repeat(np.arange(len(regions)), counts))
        # 상권별 부중심 (골목 단위 뭉침)
        subs: list[list[tuple[float, float, str, float]]] = []
        for r in regions:
            if r.get("scatter"):
                subs.append([(c[0], c[1], r["center_districts"][j], 500.0) for j, c in enumerate(r["centers"])])
                continue
            cw = np.array(r.get("center_weights", [1.0] * len(r["centers"])))
            lst = []
            for _ in range(int(rng.integers(2, 5))):
                j = self._choice(cw)
                c = r["centers"][j]
                lat = c[0] + rng.normal(0, 250) / 111000
                lng = c[1] + rng.normal(0, 250) / 88000
                dist = r["center_districts"][j] if "center_districts" in r else r["district"]
                lst.append((lat, lng, dist, float(rng.uniform(180, 300))))
            subs.append(lst)
        sub_w = [rng.dirichlet(np.ones(len(x)) * 2) for x in subs]
        genres = nm["genres"]
        types = nm["venue_types"]
        used: set[str] = set()
        self.venues: list[Venue] = []
        for i in range(total):
            ri = int(region_of[i])
            r = regions[ri]
            sc = subs[ri][self._choice(sub_w[ri])]
            lat = sc[0] + rng.normal(0, sc[3]) / 111000
            lng = sc[1] + rng.normal(0, sc[3]) / 88000
            district = sc[2]
            if "split_lng" in r:
                cut, west, east = r["split_lng"]
                district = west if lng < cut else east
            if "split_lat" in r:
                cut, south, north = r["split_lat"]
                district = south if lat < cut else north
            vtype = types[self._choice(np.array(r["type_w"]))]
            band = nm["capacity_bands"][self._choice(np.array(nm["type_capacity_weights"][vtype]))]
            while True:
                if rng.random() < nm["venue_name_en_share"]:
                    base = f"{rng.choice(nm['venue_name_en_a'])} {rng.choice(nm['venue_name_en_b'])}"
                    name = f"{base} {nm['venue_type_suffix'][vtype][1]}"
                else:
                    base = f"{rng.choice(nm['venue_name_ko_a'])}{rng.choice(nm['venue_name_ko_b'])}"
                    name = f"{base} {nm['venue_type_suffix'][vtype][0]}"
                if name not in used:
                    used.add(name)
                    break
            rd = int(reg_days[i])
            reg_ts = self.day0 + rd * 86400 + (0 if i < init else int(rng.integers(9 * 3600, 20 * 3600)))
            self.venues.append(
                Venue(
                    venue_id=101 + i,
                    name=name,
                    region=ri,
                    district=district,
                    lat=round(lat, 6),
                    lng=round(lng, 6),
                    genre=self._choice(np.array(r["genre_w"])),
                    venue_type=vtype,
                    capacity_band=band,
                    reg_day=rd,
                    reg_ts=reg_ts,
                    close_day=10**6,
                    pop=float(min(rng.pareto(VENUE_PARETO) + 1.0, 60.0)),
                )
            )
        n = total
        reg = np.array([v.reg_day for v in self.venues])
        closable = np.nonzero(reg < n_days - 60)[0]
        for i in rng.choice(closable, size=int(round(total * VENUE_CLOSE_SHARE)), replace=False):
            v = self.venues[int(i)]
            v.close_day = int(rng.integers(v.reg_day + 60, n_days))
        close = np.array([v.close_day for v in self.venues])
        pop = np.array([v.pop for v in self.venues])
        vreg = np.array([v.region for v in self.venues])
        n_reg = len(regions)
        reg_share = np.bincount(vreg, minlength=n_reg) / n
        for v in self.venues:
            self.venue_by_id[v.venue_id] = v
            self.ledger["venues"].append(
                {
                    "venue_id": v.venue_id,
                    "name": v.name,
                    "region": regions[v.region]["name"],
                    "district": v.district,
                    "lat": f"{v.lat:.6f}",
                    "lng": f"{v.lng:.6f}",
                    "genre": genres[v.genre],
                    "venue_type": v.venue_type,
                    "capacity_band": v.capacity_band,
                    "registered_at": _ts(v.reg_ts),
                    "status": "closed" if v.close_day < n_days else "active",
                }
            )

        # 파트너 계약: 기준 곡선을 따라 신규, 월 해지율(월마다 추첨)로 해지, 폐업 시 종료. 재계약 없음
        active = np.zeros(n, dtype=bool)
        ever = np.zeros(n, dtype=bool)
        open_contract: dict[int, dict[str, Any]] = {}
        contracts: list[dict[str, Any]] = []
        self.partner_day = np.zeros((n_days, n), dtype=bool)
        hazard = 0.0
        cut = (0.0, 0.0)
        norm = 1.0

        def sell_mult(i: int) -> float:
            return CONTRACT_SELL_MULT[0 if pop[i] < cut[0] else 1 if pop[i] < cut[1] else 2]

        for d in range(n_days):
            dd = self._day_date(d)
            if d == 0 or dd.day == 1:
                nxt = date(dd.year + dd.month // 12, dd.month % 12 + 1, 1)
                hazard = float(rng.uniform(*CONTRACT_CHURN)) / (nxt - date(dd.year, dd.month, 1)).days
                act = np.nonzero(active)[0]
                if len(act) >= 3:
                    q1, q2 = np.quantile(pop[act], [1 / 3, 2 / 3])
                    cut = (float(q1), float(q2))
                    norm = float(np.mean([sell_mult(int(i)) for i in act]))
            for i in np.nonzero(active)[0]:
                if close[i] <= d or rng.random() < hazard * sell_mult(int(i)) / norm:
                    active[i] = False
                    open_contract.pop(int(i))["end_day"] = d
            need = int(round(self._anchor(PARTNER_ANCHORS, d))) - int(active.sum())
            elig = self._visible(reg, d) & (close > d) & ~ever
            for _ in range(max(need, 0)):
                # 상권 담당 영업: 공간 수 비중 대비 파트너가 가장 모자란 상권에서, 그 안은 인기 지수 가중
                regs = [r for r in range(n_reg) if (elig & (vreg == r)).any()]
                if not regs:
                    break
                k = int(active.sum()) + 1
                r = max(regs, key=lambda r: reg_share[r] * k - int((active & (vreg == r)).sum()))
                cand = np.nonzero(elig & (vreg == r))[0]
                i = int(cand[rng.choice(len(cand), p=pop[cand] / pop[cand].sum())])
                plan = "pro" if rng.random() < PLAN_PRO_SHARE else "basic"
                c = {"venue_idx": i, "plan": plan, "start_day": d, "end_day": None}
                contracts.append(c)
                open_contract[i] = c
                active[i] = True
                ever[i] = True
                elig[i] = False
            self.partner_day[d] = active
        contracts.sort(key=lambda c: (c["start_day"], c["venue_idx"]))
        for k, c in enumerate(contracts, start=1):
            c["contract_id"] = f"c{k:05d}"
        self.venue_pop = pop
        self._plan_changes(contracts)
        fee = self.s.names["pricing"]["partner_plan_fee"]
        for c in contracts:
            ended = c["end_day"] is not None
            self.ledger["contracts"].append(
                {
                    "contract_id": c["contract_id"],
                    "venue_id": self.venues[c["venue_idx"]].venue_id,
                    "plan": c["plan"],
                    "monthly_fee": fee[c["plan"]],
                    "started_at": _ts(self.day0 + c["start_day"] * 86400),
                    "ended_at": _ts(self.day0 + c["end_day"] * 86400) if ended else "",
                    "status": "ended" if ended else "active",
                }
            )
        # 상세 조회 가중 = 파트너 가중 x 개별 인기 지수, 보이는 공간만 (상권 비중은 공간 수에 이미 반영)
        self.venue_pop = pop
        base = pop
        self.venue_cum = np.zeros((n_days, n))
        for d in range(n_days):
            w = base * np.where(self.partner_day[d], PARTNER_VIEW_MULT, 1.0) * (self._visible(reg, d) & (close > d))
            self.venue_cum[d] = np.cumsum(w)
        self._reg = reg
        self._close = close

    def _plan_changes(self, contracts: list[dict[str, Any]]) -> None:
        """진행 계약의 플랜 업그레이드·다운그레이드를 만든다. 계약의 plan 은 현재값으로 바뀐다.

        그날 진행 중(시작 다음 날부터 종료 전날까지)인 계약 수 x 월 변경률(월마다 추첨)을 일로 나눈 포아송 건수를
        뽑고, 건마다 PLAN_UPGRADE_SHARE 로 방향을 정해 해당 플랜 계약 중 하나를 고른다. 변경일은 KST 자정이며
        그날부터 새 요금이다. 계약당 하루 1회.

        Args:
            contracts: contract_id 가 붙은 계약 목록 (시작일 순).
        """
        rng = self.plan_rng
        fee = self.s.names["pricing"]["partner_plan_fee"]
        rate = 0.0
        seq = 0
        for d in range(self.n_days):
            dd = self._day_date(d)
            if d == 0 or dd.day == 1:
                nxt = date(dd.year + dd.month // 12, dd.month % 12 + 1, 1)
                rate = float(rng.uniform(*PLAN_CHANGE_MONTHLY)) / (nxt - date(dd.year, dd.month, 1)).days
            live = [c for c in contracts if c["start_day"] < d and (c["end_day"] is None or c["end_day"] > d)]
            touched: set[str] = set()
            for _ in range(int(rng.poisson(len(live) * rate))):
                up = rng.random() < PLAN_UPGRADE_SHARE
                src, dst = ("basic", "pro") if up else ("pro", "basic")
                pool = [c for c in live if c["plan"] == src and c["contract_id"] not in touched]
                if not pool:
                    continue
                # 업그레이드는 판매가 큰(인기 지수 높은) 공간, 다운그레이드는 작은 공간에서 주로 나온다
                pw = np.array([self.venue_pop[c["venue_idx"]] for c in pool])
                pw = pw if up else 1.0 / pw
                c = pool[int(rng.choice(len(pool), p=pw / pw.sum()))]
                seq += 1
                self.ledger["contract_changes"].append(
                    {
                        "change_id": f"pc{seq:05d}",
                        "contract_id": c["contract_id"],
                        "venue_id": self.venues[c["venue_idx"]].venue_id,
                        "changed_at": _ts(self.day0 + d * 86400),
                        "from_plan": src,
                        "to_plan": dst,
                        "from_fee": fee[src],
                        "to_fee": fee[dst],
                    }
                )
                c["plan"] = dst
                touched.add(c["contract_id"])

    def _events_per_week(self, w: int) -> float:
        for _, a, b, _, _, _, (lo, hi) in PHASES:
            if a <= w <= b:
                return (lo + (hi - lo) * (w - a) / max(b - a, 1)) * EVENT_SCALE
        return PHASES[-1][6][1] * EVENT_SCALE

    def build_catalog(self) -> None:
        """행사 목록을 만든다. 개최 공간은 등록 공간 목록에서 파트너 75% / 비파트너 25% 로 고른다."""
        nm = self.s.names
        rng = self.rng
        regions = nm["regions"]
        reg, close = self._reg, self._close
        tier_w = np.array([t[1] for t in PRICE_TIERS])
        dow_start = np.array([0.03, 0.03, 0.05, 0.12, 0.33, 0.37, 0.07])
        self.events: list[EventItem] = []
        venue_count: dict[int, int] = {}
        eid = 5001
        # 관측 종료 후 EVENT_FUTURE_WEEKS 주까지 예정 행사를 만든다 (마지막 주에도 신청 가능한 행사가 충분하게)
        for w in range(1, self.weeks + EVENT_FUTURE_WEEKS + 1):
            k = max(1, int(rng.poisson(self._events_per_week(w))))
            for j in range(k):
                if w == self.weeks and j == 0:
                    d = self.n_days - 1  # 관측 마지막 날에도 신청 가능한 행사를 보장한다
                else:
                    d = (w - 1) * 7 + self._choice(dow_start)
                d_date = self._day_date(d)
                hour = int(rng.choice([20, 21, 22, 23], p=[0.25, 0.3, 0.3, 0.15]))
                starts = self.day0 + d * 86400 + hour * 3600
                lead = int(rng.integers(10, 29))
                dp = min(max(d - lead, 0), self.n_days - 1)
                pday = self.partner_day[min(d, self.n_days - 1)]  # 관측 후 개최는 종료일 계약 상태
                elig = self._visible(reg, dp) & (close > d)
                partner = elig & pday
                pool = partner if partner.any() and rng.random() < PARTNER_EVENT_SHARE else elig & ~pday
                if not pool.any():
                    pool = elig
                cand = np.nonzero(pool)[0]
                vi = int(cand[self._choice(self.venue_pop[cand] ** HOST_POP_TEMPER)])
                venue = self.venues[vi]
                genre = venue.genre if rng.random() < 0.7 else self._choice(self.s.genre_share)
                etype = str(rng.choice(nm["event_types"], p=nm["event_type_weights"]))
                venue_count[venue.venue_id] = venue_count.get(venue.venue_id, 0) + 1
                name = str(rng.choice(nm["event_name_templates"])).format(
                    venue=venue.name,
                    genre=nm["genres"][genre],
                    n=venue_count[venue.venue_id],
                    season=nm["seasons"][str(d_date.month)],
                    etype=etype,
                    region=regions[venue.region]["name"],
                )
                tier, _, lo, hi, unit, mult = PRICE_TIERS[self._choice(tier_w)]
                price = int(rng.integers(lo // unit, hi // unit + 1)) * unit if hi else 0
                c_lo, c_hi = nm["capacity_range"][venue.capacity_band]
                capacity = int(rng.integers(c_lo // 10, c_hi // 10 + 1)) * 10
                ev = EventItem(
                    eid,
                    venue.venue_id,
                    name,
                    etype,
                    starts,
                    starts - lead * 86400,
                    genre,
                    tier,
                    price,
                    float(rng.choice(self.s.event_popularity)) * (1.6 if self._phase(w)[0] == "peak" else 1),
                    capacity,
                    bool(pday[vi]),
                    mult,
                )
                self.events.append(ev)
                self.ledger["events_master"].append(
                    {
                        "event_id": ev.event_id,
                        "venue_id": ev.venue_id,
                        "name": ev.name,
                        "event_type": etype,
                        "starts_at": _ts(ev.starts_at),
                        "price_tier": tier,
                        "price": price,
                        "capacity": capacity,
                        "is_partner_venue": str(ev.is_partner).lower(),
                    }
                )
                eid += 1
        # 날짜별 노출 중인 행사 목록 (공개 ~ 시작 시각)과 선택용 배열
        self.listed: list[np.ndarray] = []
        self.listed_w: list[np.ndarray] = []
        self.listed_genre: list[np.ndarray] = []
        self.listed_start: list[np.ndarray] = []
        self.listed_venue: list[np.ndarray] = []
        starts_arr = np.array([e.starts_at for e in self.events])
        pub_arr = np.array([e.publish_at for e in self.events])
        w_arr = np.array([e.weight for e in self.events])
        g_arr = np.array([e.genre for e in self.events])
        v_arr = np.array([e.venue_id for e in self.events])
        for d in range(self.n_days):
            t = self.day0 + d * 86400 + 43200
            ids = np.nonzero((pub_arr <= t) & (starts_arr > t - 43200))[0]
            if len(ids) == 0:
                ids = np.argsort(np.abs(starts_arr - t))[:3]
            self.listed.append(ids)
            self.listed_w.append(w_arr[ids])
            self.listed_genre.append(g_arr[ids])
            self.listed_start.append(starts_arr[ids])
            self.listed_venue.append(v_arr[ids])

    def build_search(self) -> None:
        """검색 엔진(카탈로그·랭킹·클릭 모델)과 결과를 누르지 않았을 때의 다음 화면 분포를 준비한다."""
        nm = self.s.names
        offset = (self.start_date - date(2025, 1, 1)).days

        def kst_day(t: int) -> int:
            return (datetime.fromtimestamp(t, KST).date() - date(2025, 1, 1)).days

        vs, es = self.venues, self.events
        self.event_by_id = {e.event_id: e for e in es}
        vidx = {v.venue_id: i for i, v in enumerate(vs)}
        cat = Catalog(
            venue_id=np.array([v.venue_id for v in vs]),
            v_name=np.array([v.name for v in vs]),
            v_name_head=np.array([v.name.split(" ")[0] for v in vs]),
            v_region=np.array([nm["regions"][v.region]["name"] for v in vs]),
            v_genre=np.array([nm["genres"][v.genre] for v in vs]),
            v_type=np.array([v.venue_type for v in vs]),
            v_lat=np.array([v.lat for v in vs]),
            v_lng=np.array([v.lng for v in vs]),
            # 일괄 등록(0시)이 아니면 등록 다음 날부터 검색에 노출한다 (등록 전 조회 방지)
            v_reg_day=np.array([v.reg_day + offset + (v.reg_ts != self.day0 + v.reg_day * 86400) for v in vs]),
            v_close_day=np.array([min(v.close_day + offset, 10**6) for v in vs]),
            event_id=np.array([e.event_id for e in es]),
            e_venue_idx=np.array([vidx[e.venue_id] for e in es]),
            e_type=np.array([e.event_type for e in es]),
            e_start_day=np.array([kst_day(e.starts_at) for e in es]),
            e_partner=np.array([e.is_partner for e in es]),
            e_pub_day=np.array([kst_day(e.publish_at) + 1 for e in es]),
            genres=list(nm["genres"]),
            regions={r["name"]: [tuple(c) for c in r["centers"]] for r in nm["regions"]},
            event_types=list(nm["event_types"]),
        )
        self.engine = SearchEngine(cat, self.search_rng)
        targets, probs = self.s.chain["search_result"]
        base = np.array(probs, dtype=float)
        for t in ("venue_detail", "event_detail"):
            base[targets.index(t)] = 0.0
        zero = base.copy()
        zero[targets.index("search_result")] *= ZERO_RESEARCH

        def with_exit(w: np.ndarray, share: float) -> np.ndarray:
            out = w / w.sum() * (1.0 - share)
            out[targets.index(END)] += share
            return out

        self.no_click_chain = {
            False: (targets, with_exit(base, NOCLICK_EXIT)),
            True: (targets, with_exit(zero, ZERO_EXIT)),
        }

    # ---- 광고 계획

    def build_ads(self) -> None:
        """캠페인별 일 집행(노출·클릭·광고비)과 기대 유입 세션 수를 만든다."""
        rng = self.rng
        ar = self.s.ad_ratio
        self.ad_sessions = np.zeros(self.n_days)
        self.ad_campaign_of_day: list[list[tuple[int, float]]] = [[] for _ in range(self.n_days)]
        for ci, c in enumerate(self.s.names["campaigns"]):
            cpm = float(rng.uniform(5500, 8500))
            session_ratio = float(np.clip(rng.normal(AD_SESSION_RATIO, 0.08), 0.6, 0.9))
            if "start_date" in c:
                first = (date.fromisoformat(c["start_date"]) - self.start_date).days
                last = (date.fromisoformat(c["end_date"]) - self.start_date).days + 1
            else:
                first, last = (c["start_week"] - 1) * 7, c["end_week"] * 7
            for d in range(max(first, 0), min(last, self.n_days)):
                dow_mult = 1.15 if self._dow(d) >= 4 else 0.95
                budget = c["daily_budget"] * AD_BUDGET_SCALE * float(rng.uniform(0.85, 1.15)) * dow_mult
                imp = int(budget / cpm * 1000)
                link = int(rng.binomial(imp, ar["link_click_rate_per_impression"]))
                other = int(
                    rng.binomial(imp, max(ar["ctr_clicks_per_impression"] - ar["link_click_rate_per_impression"], 0))
                )
                spend = int(round(budget * AD_SPEND_SCALE))
                exp_sessions = (link + other) * session_ratio
                self.ad_sessions[d] += exp_sessions
                self.ad_campaign_of_day[d].append((ci, exp_sessions))
                self.ledger["ad_spend"].append(
                    {
                        "date": self._day_date(d).isoformat(),
                        "campaign_id": c["campaign_id"],
                        "campaign_name": c["name"],
                        "spend": spend,
                        "impressions": imp,
                        "clicks": link + other,
                    }
                )

    def _paid_channel(self, d: int) -> tuple[str, str, str, str]:
        camps = self.ad_campaign_of_day[d]
        w = np.array([x[1] for x in camps]) + 1e-9
        c = self.s.names["campaigns"][camps[self._choice(w)][0]]
        src = c["source"] if self.rng.random() < 0.92 else ("facebook" if c["source"] == "instagram" else "instagram")
        return src, "paid_social", c["campaign_id"], str(self.rng.choice(self.s.names["creatives"]))

    def _organic_channel(self) -> tuple[str, str, str, str]:
        src, med, camp = self.s.organic_channels[self._choice(self.s.organic_weights)]
        return src, med, camp, "(not set)"

    # ---- 사람과 방문 일정

    def build_people(self) -> None:
        """사람 목록·첫 방문일·방문 일정을 만든다 (날짜 단위 벡터 연산)."""
        rng = self.rng
        n_days = self.n_days
        # 광고 신규 유입
        paid_new = rng.poisson(self.ad_sessions * PAID_NEW_SHARE)
        n_paid = int(paid_new.sum())
        n_org = self.n_persons - n_paid
        if n_org <= 0:
            raise ValueError("광고 유입이 사람 수를 넘는다")
        arrive = np.zeros(n_days)
        for d in range(n_days):
            name, a, *_ = self.phase_of_day[d]
            week = d // 7 + 1
            base = 0.35 + 0.45 * (week - 1) / 9 if name == "launch" else a
            arrive[d] = base * self._season(d) * self.s.dow_weight[self._dow(d)]
        # 매일 최소 1명은 첫 방문하게 하고 나머지를 가중 추첨 (런칭 초기 빈 날 방지)
        org_days = np.concatenate([np.arange(n_days), rng.choice(n_days, size=n_org - n_days, p=arrive / arrive.sum())])
        firsts: list[tuple[int, bool]] = [(int(d), False) for d in org_days]
        for d in range(n_days):
            firsts.extend([(d, True)] * int(paid_new[d]))
        firsts.sort()

        platforms = list(self.s.device_platform)
        pw = np.array([self.s.device_platform[k] for k in platforms])
        self.people: list[Person] = []
        core = np.array([rng.random() < CORE_SHARE[1 if is_paid else 0] for _, is_paid in firsts])
        for pid, (d, is_paid) in enumerate(firsts):
            ch = self._paid_channel(d) if is_paid else self._organic_channel()
            will = rng.random() < SIGNUP_INTENT[0 if core[pid] else 1]
            k = int(rng.geometric(0.45))
            genres = sorted({self._choice(self.s.genre_share) for _ in range(int(rng.integers(1, 4)))})
            p = Person(
                pid, d, ch, self._choice(self.s.region_share), genres, will, k, will and rng.random() < SECOND_DEVICE
            )
            plat = platforms[self._choice(pw)]
            p.devices.append(self._new_device(plat, d))
            if p.has_dev2:
                plat2 = (
                    "desktop"
                    if plat != "desktop" and rng.random() < 0.5
                    else (
                        "ios" if plat == "android" else "android" if plat == "ios" else platforms[self._choice(pw[:2])]
                    )
                )
                p.devices.append(self._new_device(plat2, d))
            self.people.append(p)

        # 방문 일정: 날짜 루프, 사람 벡터
        n = len(self.people)
        first = np.array([p.first_day for p in self.people])
        paid_person = np.array([p.first_channel[1] == "paid_social" for p in self.people])
        prop = rng.lognormal(mean=-(CASUAL_SIGMA**2) / 2, sigma=CASUAL_SIGMA, size=n)
        prop[paid_person] *= 0.6
        core_prop = rng.lognormal(mean=-0.045, sigma=0.3, size=n)
        core_until = first + rng.exponential(CORE_LIFE_WEEKS * 7, size=n)
        k_signup = np.array([p.signup_visit if p.will_signup else 10**6 for p in self.people])
        visits = np.zeros(n, dtype=int)
        member_from = np.full(n, 10**6)
        shape = self.s.retention_shape
        wk = np.array([0, 1, 2, 4, 8, 60])
        tail = CASUAL_TAIL
        hv = np.array([1.6, 1.0, shape[2] * tail[0], shape[4] * tail[1], shape[4] * tail[2], shape[4] * tail[3]])
        self.visit_days: list[list[int]] = [[] for _ in range(n)]
        self.core = core
        self.core_until = core_until
        for d in range(n_days):
            _, _, ret_mult, _, _ = self.phase_of_day[d]
            t_weeks = (d - first) / 7.0
            h = np.interp(t_weeks, wk, hv)
            boost = np.where(member_from < d, 1.8, 1.0)
            day_mult = ret_mult * self._season(d) * self.s.dow_weight[self._dow(d)]
            is_core = core & (d < core_until)
            prob = np.where(is_core, CORE_DAILY * core_prop, RETURN_BASE * prop * h * boost) * day_mult
            prob = np.clip(prob, 0, 0.9)
            draw = rng.random(n) < prob
            draw &= first < d
            draw |= first == d
            idx = np.nonzero(draw)[0]
            visits[idx] += 1
            newly = idx[visits[idx] == k_signup[idx]]
            member_from[newly] = d
            for i in idx:
                self.visit_days[i].append(d)

        # 기존 방문자 세션 중 광고 재유입 비중 (날짜별)
        returning = np.zeros(n_days)
        for days in self.visit_days:
            for d in days[1:]:
                returning[d] += 1
        target = self.ad_sessions * (1 - PAID_NEW_SHARE)
        self.paid_return_p = np.minimum(0.5, target / np.maximum(returning, 1))

    def plan_subscriptions(self) -> None:
        """구독 시작·해지 예정일을 사람별로 정한다 (회원만, 출시일 이후 방문일에).

        활성 구독자가 기준 곡선을 따르도록 날마다 부족분을 그날 방문하는 비구독 회원 중에서 뽑는다.
        해지 확률은 결제 회차마다 SUB_HAZARD x 이용 배수(그 회차 계획 방문일 수: 0일 · 1~2일 · 3일 이상)다.
        해지는 그 회차 안의 첫 방문에서 일어나고, 회차 안에 방문이 없으면 회차가 끝나기 전에 해지만 하는
        짧은 로그인 세션(cancel_days)을 만든다.
        """
        rng = self.rng
        n_days = self.n_days
        launch = self.sub_launch_day
        if launch >= n_days:
            return
        member_day: dict[int, int] = {}
        for p in self.people:
            days = self.visit_days[p.pid]
            if p.will_signup and len(days) >= p.signup_visit:
                member_day[p.pid] = days[p.signup_visit - 1]
        visitors: list[list[int]] = [[] for _ in range(n_days)]
        for pid, md in member_day.items():
            for d in self.visit_days[pid]:
                if d > md and d >= launch:
                    visitors[d].append(pid)
        xs = [launch] + [w * 7 - 1 for w, _ in SUB_ANCHORS]
        ys = [0] + [v for _, v in SUB_ANCHORS]
        ends = np.zeros(n_days + 1, dtype=int)
        self.cancel_days: dict[int, list[int]] = {}
        taken: set[int] = set()
        active = 0
        for d in range(launch, n_days):
            active -= int(ends[d])
            gap = float(np.interp(d + 1, xs, ys)) - active
            k = int(rng.poisson(gap)) if gap > 0 else 0
            cand = [pid for pid in visitors[d] if pid not in taken]
            if k == 0 or not cand:
                continue
            w = np.array([SUB_CORE_WEIGHT if self.core[pid] else 1.0 for pid in cand])
            pick = rng.choice(len(cand), size=min(k, len(cand)), replace=False, p=w / w.sum())
            for j in sorted(int(x) for x in pick):
                pid = cand[j]
                taken.add(pid)
                active += 1
                cancel = None
                start = self._day_date(d)
                k = 1
                while True:
                    w0 = max((_add_months(start, k - 1) - self.start_date).days, d + 1)
                    w1 = (_add_months(start, k) - self.start_date).days
                    if w0 >= n_days:
                        break
                    used = [v for v in self.visit_days[pid] if w0 <= v < w1]
                    mult = SUB_USE_MULT[0 if not used else 1 if len(used) <= 2 else 2]
                    if rng.random() < SUB_HAZARD * mult:
                        if used:
                            cancel = used[0]
                        elif w0 <= min(w1, n_days) - 1:
                            cancel = int(rng.integers(w0, min(w1, n_days)))
                            self.cancel_days.setdefault(pid, []).append(cancel)
                        break
                    k += 1
                if cancel is not None:
                    ends[cancel] += 1
                self.people[pid].sub_plan = (d, cancel)

    def _new_device(self, platform: str, d: int) -> Device:
        cat = "desktop" if platform == "desktop" else "mobile"
        os_name = {"ios": "iOS", "android": "Android"}.get(platform) or str(
            self.rng.choice(["Windows", "Macintosh"], p=[0.55, 0.45])
        )
        first_ts = self.day0 + d * 86400 + int(self.rng.integers(0, 86400))
        cid = f"{int(self.rng.integers(10**9, 10**10))}.{first_ts}"
        return Device(cid, cat, os_name, platform)

    # ---- 세션·이벤트

    def run(self, out_events: Path) -> None:
        """사람별로 시간순 세션을 만들고 이벤트를 gzip NDJSON 으로 쓴다.

        Args:
            out_events: 출력 경로(.ndjson.gz).
        """
        out_events.parent.mkdir(parents=True, exist_ok=True)
        auto_share = self.s.shares["share_auto_load"]
        with open(out_events, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
            for p in self.people:
                sessions = self._plan_sessions(p, auto_share)
                for j, (kind, start, dev_i, channel) in enumerate(sessions):
                    # 같은 사람의 다음 세션 시작 전에 끝나게 한다 (구독 상태 등 사람 상태가 시각 순서를 지키도록)
                    self.end_cap = sessions[j + 1][1] - 1 if j + 1 < len(sessions) else self.range_end
                    rows = (
                        self._auto_session(p, dev_i, start)
                        if kind == "auto"
                        else self._session(p, dev_i, start, channel, cancel_only=kind == "cancel")
                    )
                    buf = "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows)
                    gz.write(buf.encode("utf-8"))
                    self.rows += len(rows)

    def _plan_sessions(self, p: Person, auto_share: float) -> list[tuple[str, int, int, tuple | None]]:
        """사람의 전체 세션 일정(종류·시작 시각·기기·채널)을 시간순으로 만든다."""
        rng = self.rng
        plan: list[tuple[str, int, int, tuple | None]] = []
        days = self.visit_days[p.pid]
        for vi, d in enumerate(days):
            spd = CORE_SESSIONS_PER_DAY if self.core[p.pid] and d < self.core_until[p.pid] else SESSIONS_PER_DAY
            n_sess = int(rng.choice(spd[0], p=spd[1]))
            dow = self._dow(d)
            starts = sorted(
                int(
                    self.day0
                    + d * 86400
                    + np.searchsorted(self.s.hour_cdf[dow], rng.random()) * 3600
                    + rng.integers(0, 3600)
                )
                for _ in range(n_sess)
            )
            for si, st in enumerate(starts):
                if vi == 0 and si == 0:
                    ch = p.first_channel
                elif si == 0 and rng.random() < self.paid_return_p[d] and self.ad_campaign_of_day[d]:
                    ch = self._paid_channel(d)
                elif rng.random() < 0.55:
                    ch = ("(direct)", "(none)", "(direct)", "(not set)")
                else:
                    ch = self._organic_channel()
                plan.append(("visit", st, 0, ch))
        # 구독 해지만 하는 짧은 로그인 세션 (해지 회차에 방문이 없을 때)
        for d in self.cancel_days.get(p.pid, []):
            st = int(self.day0 + d * 86400 + np.searchsorted(self.s.hour_cdf[self._dow(d)], rng.random()) * 3600)
            plan.append(("cancel", st + int(rng.integers(0, 3600)), 0, ("(direct)", "(none)", "(direct)", "(not set)")))
        # 자동 로드 세션: 첫 방문 이후 임의 날짜
        n_auto = int(rng.poisson(len(plan) * auto_share / (1 - auto_share)))
        for _ in range(n_auto):
            d = int(rng.integers(p.first_day, self.n_days))
            st = self.day0 + d * 86400 + int(rng.integers(0, 86400))
            plan.append(("auto", st, 0, None))
        plan.sort(key=lambda x: x[1])
        # 첫 세션은 항상 방문 세션 (자동 로드는 기존 기기에서만)
        while plan and plan[0][0] == "auto":
            plan.pop(0)
        # 시각 겹침 정리 (세션 사이 최소 31분)
        out: list[tuple[str, int, int, tuple | None]] = []
        last = -(10**12)
        for kind, st, dev_i, ch in plan:
            st = max(st, last + 1860)
            if st >= self.range_end:
                continue
            out.append((kind, st, dev_i, ch))
            last = st + 600
        return out

    def _pick_event(self, t: int, p: Person) -> EventItem:
        d = min(max((t - self.day0) // 86400, 0), self.n_days - 1)
        if p.genre_mask is None:
            p.genre_mask = np.ones(len(self.s.names["genres"]))
            p.genre_mask[p.genres] = 2.0
        w = (
            self.listed_w[d]
            * p.genre_mask[self.listed_genre[d]]
            * (1.0 + 2.0 * np.exp(-np.maximum(self.listed_start[d] - t, 0) / (5 * 86400)))
        )
        return self.events[int(self.listed[d][self._choice(w)])]

    def _pick_venue(self, d: int) -> Venue:
        c = self.venue_cum[min(max(d, 0), self.n_days - 1)]
        i = min(int(np.searchsorted(c, self.rng.random() * c[-1], side="right")), len(c) - 1)
        return self.venues[i]

    def _session(
        self, p: Person, dev_i: int, start: int, channel: tuple, cancel_only: bool = False
    ) -> list[dict[str, Any]]:
        """방문 세션 1개의 이벤트 행을 만든다. 신청·결제·취소·가입 원장도 여기서 함께 쓴다.

        cancel_only 는 구독 해지만 하는 짧은 세션(홈 → 로그인 → 구독 화면 → 해지)이다.
        """
        rng = self.rng
        s = self.s
        d = (start - self.day0) // 86400
        conv = self.phase_of_day[d][3]
        is_paid = channel[1] == "paid_social"
        # 기기 선택: 가입 후 2번째 기기 사용
        if p.member_id and len(p.devices) > 1 and rng.random() < DEVICE2_USE:
            dev_i = 1
        dev = p.devices[dev_i]
        dev.session_number += 1
        start_user = dev.user_id
        start_sub = p.sub_active
        first_session = dev.session_number == 1
        visit_no = len([x for x in self.visit_days[p.pid] if x <= d])
        signup_now = p.will_signup and p.member_id is None and visit_no >= p.signup_visit

        steps: list[tuple[str, dict[str, Any]]] = []  # (이벤트명, 속성)
        ctx: dict[str, Any] = {"event": None, "venue": None}
        user_id = dev.user_id
        sdate = self._day_date(d)
        ranker = ranker_for(sdate, dev.client_id)
        bug = reindex_bug(sdate, ranker)

        def screen(name: str, **kw: Any) -> None:
            steps.append(("screen_view", {"screen": name, **kw}))
            if name in ("event_detail", "venue_detail") and rng.random() < 0.012:
                steps.append(("share", {"screen": name, **kw}))
            if rng.random() < ue_p:
                steps.append(("user_engagement", {"screen": name, **kw}))

        ue_p = min(0.9, s.event_reach["user_engagement"][0] * 0.55)

        def view_event(ev: EventItem | None = None) -> None:
            ev = ev or self._pick_event(start, p)
            ctx["event"] = ev
            ctx["venue"] = self.venue_by_id[ev.venue_id]
            screen("event_detail", event=ev)

        def view_venue() -> None:
            ev = ctx["event"]
            if ev is not None and rng.random() < 0.7:
                v = self.venue_by_id[ev.venue_id]
            else:
                v = self._pick_venue(d)
            ctx["venue"] = v
            screen("venue_detail", venue=v)

        def do_search(canonical: str | None = None) -> None:
            canon = canonical or self._search_term(d)
            q = self.engine.typed(canon)
            res: Result = self.engine.run(q, sdate, ranker, bug)
            self.req_seq += 1
            rec = {
                "request_id": f"q{self.req_seq:08d}",
                "requested_at": None,
                "user_pseudo_id": dev.client_id,
                "ga_session_id": start,
                "query_raw": q,
                "query_intent": self.engine.intent_of(q),
                "ranker_version": ranker,
                "results_count": res.count,
                "results": [{"position": pos, "item_type": t, "item_id": i} for pos, t, i, _ in res.top],
                "promoted_event_id": self.engine.promoted(res.canonical, sdate) if res.count else None,
                "latency_ms": res.latency_ms,
            }
            self.search_log.append(rec)
            drop = bool(self.search_rng.random() < GA_SEARCH_LOSS)
            steps.append(("search", {"term": q, "req": rec, "ga_drop": drop}))
            screen("search_result")
            ctx.update(sr=res, canon=canon, req=rec, drop=drop)

        def do_signup() -> None:
            nonlocal user_id
            screen("login")
            screen("taste_setup")
            self.member_seq += 1
            p.member_id = f"m{self.member_seq:06d}"
            p.marketing_opt_in = bool(rng.random() < 0.55)
            for dv in p.devices[:1]:
                dv.user_id = p.member_id
            dev.user_id = p.member_id
            user_id = p.member_id
            steps.append(
                (
                    "sign_up",
                    {
                        "screen": "taste_setup",
                        "set_user": p.member_id,
                        "method": str(rng.choice(s.names["signup_methods"], p=s.names["signup_method_weights"])),
                    },
                )
            )

        def do_login() -> None:
            nonlocal user_id
            screen("login")
            dev.user_id = p.member_id
            user_id = p.member_id
            steps.append(
                (
                    "login",
                    {
                        "screen": "login",
                        "set_user": p.member_id,
                        "method": str(rng.choice(s.names["signup_methods"], p=s.names["signup_method_weights"])),
                    },
                )
            )

        # 세션 시작
        if first_session:
            steps.append(("first_visit", {}))
        steps.append(("session_start", {}))
        land_targets, land_p = s.chain["(start)"]
        landing = "home" if cancel_only else "event_detail" if is_paid else land_targets[self._choice(land_p)]
        if rng.random() < s.event_reach["page_view"][0]:
            steps.append(("page_view", {"landing": landing}))
        cur = landing
        if landing == "event_detail":
            view_event()
        elif landing == "venue_detail":
            view_venue()
        elif landing == "search_result":
            do_search()
        elif landing == "event_apply":
            ctx["event"] = self._pick_event(start, p)
            screen("event_apply", event=ctx["event"])
        elif landing == "venue_review":
            ctx["venue"] = self._pick_venue(d)
            screen("venue_review", venue=ctx["venue"])
        else:
            screen(landing)
        if p.member_id and user_id is None:
            land_step = next(a for e, a in steps if e == "screen_view")
            do_login()
            steps.append(("screen_view", dict(land_step)))

        # 구독: 예정일 이후 첫 로그인 세션에서 구독·해지, 그 밖에는 구독 안내 조회만
        if d >= self.sub_launch_day:
            plan = p.sub_plan
            if plan and p.member_id and user_id and p.sub_id is None and d >= plan[0]:
                screen("subscribe")
                steps.append(("subscribe_view", {"screen": "subscribe"}))
                self.sub_seq += 1
                sid = f"sub{self.sub_seq:05d}"
                rec = {"subscription_id": sid, "end_ts": None}
                self.sub_recs[sid] = rec
                p.sub_id, p.sub_active = sid, True
                steps.append(
                    (
                        "subscribe",
                        {"screen": "subscribe", "sub_id": sid, "order_id": f"{sid}-01", "sub_rec": rec, "sub_on": True},
                    )
                )
                cur = "home"
            elif plan and p.sub_active and plan[1] is not None and user_id and d >= plan[1]:
                screen("subscribe")
                p.sub_active, p.sub_canceled = False, True
                steps.append(
                    (
                        "subscription_cancel",
                        {
                            "screen": "subscribe",
                            "sub_id": p.sub_id,
                            "sub_rec": self.sub_recs[p.sub_id],
                            "sub_on": False,
                        },
                    )
                )
                cur = "home"
            elif not p.sub_active and rng.random() < SUB_VIEW_P[1 if user_id else 0]:
                screen("subscribe")
                steps.append(("subscribe_view", {"screen": "subscribe"}))
                cur = "home"

        if cancel_only:
            return self._emit(p, dev, start, channel, steps, is_paid, start_user, start_sub)

        def promotion(p_view: float) -> bool:
            if rng.random() >= p_view:
                return False
            promo = self._pick_event(start, p)
            steps.append(("view_promotion", {"screen": cur, "event": promo}))
            if rng.random() < PROMO_SELECT:
                steps.append(("select_promotion", {"screen": cur, "event": promo}))
                view_event(promo)
                return True
            return False

        if promotion(s.event_reach["view_promotion"][0]):
            cur = "event_detail"

        # 신청 보유 회원의 취소
        if p.member_id and user_id and p.open_apps:
            for app in list(p.open_apps):
                if app["starts_at"] > start and rng.random() < CANCEL_PER_SESSION:
                    view_event(app["ev"])
                    self._cancel(app, start)
                    p.open_apps.remove(app)
                    steps.append(
                        (
                            "cancel_apply",
                            {
                                "screen": "event_detail",
                                "event": app["ev"],
                                "order_id": app["order_id"],
                                "value": app["refund"],
                                "ledger_app": app,
                            },
                        )
                    )
                    cur = "event_detail"
                    break
                if app["starts_at"] <= start:
                    p.open_apps.remove(app)

        bounce = 0.45 if is_paid else 0.0
        applied_in_session = False
        max_steps = 60
        while max_steps > 0:
            max_steps -= 1
            if bounce and rng.random() < bounce:
                break
            bounce = 0.0
            if cur == "search_result":
                res = ctx["sr"]
                if res.click is not None:
                    pos, t, iid = res.click
                    steps.append(
                        (
                            "select_search_result",
                            {
                                "req": ctx["req"],
                                "position": pos,
                                "item_type": t,
                                "item_id": iid,
                                "ga_drop": ctx["drop"],
                            },
                        )
                    )
                    if t == "venue":
                        ctx["venue"] = self.venue_by_id[iid]
                        screen("venue_detail", venue=ctx["venue"])
                        cur = "venue_detail"
                    else:
                        view_event(self.event_by_id[iid])
                        cur = "event_detail"
                    continue
                targets, probs = self.no_click_chain[res.count == 0]
            else:
                targets, probs = s.chain[cur]
            nxt = targets[self._choice(probs)]
            if cur == "event_detail" and user_id is not None and rng.random() < MEMBER_APPLY_NUDGE:
                nxt = "event_apply"
            if nxt == END:
                break
            if nxt == "event_detail":
                ev_keep = ctx["event"] if ctx["event"] is not None and rng.random() < 0.3 else None
                if cur == "venue_detail" and ctx["venue"] is not None and rng.random() < 0.5:
                    at_venue = self.listed[d][self.listed_venue[d] == ctx["venue"].venue_id]
                    if len(at_venue):
                        ev_keep = self.events[int(at_venue[int(rng.integers(len(at_venue)))])]
                view_event(ev_keep)
            elif nxt == "venue_detail":
                view_venue()
            elif nxt == "venue_review":
                if ctx["venue"] is None:
                    ctx["venue"] = self._pick_venue(d)
                screen("venue_review", venue=ctx["venue"])
            elif nxt == "search_result":
                do_search(ctx["canon"] if cur == "search_result" and rng.random() < REFORM_SAME else None)
            elif nxt == "event_apply":
                ev = ctx["event"] or self._pick_event(start, p)
                ctx["event"] = ev
                if user_id is None:
                    if p.member_id:
                        do_login()
                    elif signup_now:
                        do_signup()
                        signup_now = False
                    else:
                        screen("login")
                        if rng.random() < 0.8:
                            cur = "login"
                            break
                        view_event(ev)
                        cur = "event_detail"
                        continue
                screen("event_apply", event=ev)
                if (
                    not applied_in_session
                    and ev.event_id not in p.applied_events
                    and ev.starts_at > start
                    and ev.seats < ev.capacity
                    and rng.random() < min(0.95, s.funnel["applied"] * conv * APPLY_MULT * ev.apply_mult)
                ):
                    self._apply(p, ev, steps, start)
                    applied_in_session = True
                    if rng.random() < 0.6:
                        cur = "payment_success"
                        break
                    view_event(ev)
                    nxt = "event_detail"
            else:
                screen(nxt)
                if nxt == "home" and promotion(0.5):
                    nxt = "event_detail"
            cur = nxt
        if signup_now:
            do_signup()
            screen("home")

        return self._emit(p, dev, start, channel, steps, is_paid, start_user, start_sub)

    def _search_term(self, d: int) -> str:
        nm = self.s.names
        r = self.rng.random()
        if r < 0.4:
            return str(self.rng.choice(nm["genres"], p=self.s.genre_share))
        if r < 0.65:
            return str(nm["regions"][self._choice(self.s.region_share)]["name"])
        if r < 0.8:
            return str(self.rng.choice(nm["event_types"]))
        return self._pick_venue(d).name.split(" ")[0]

    def _apply(self, p: Person, ev: EventItem, steps: list, start: int) -> None:
        """신청(+결제) 단계를 steps 에 넣는다. 원장 행은 _emit 에서 시각이 정해진 뒤 쓴다."""
        rng = self.rng
        self.order_seq += 1
        oid = f"o{self.order_seq:07d}"
        p.applied_events.add(ev.event_id)
        app = {"order_id": oid, "ev": ev, "starts_at": ev.starts_at, "refund": 0, "status": "applied"}
        steps.append(
            (
                "apply_event",
                {"screen": "event_apply", "event": ev, "order_id": oid, "value": ev.price, "ledger_app": app},
            )
        )
        if ev.price > 0:
            steps.append(("screen_view", {"screen": "payment_confirm", "event": ev}))
            if rng.random() < PAY_SUCCESS:
                method = str(rng.choice(self.s.names["payment_methods"], p=self.s.names["payment_method_weights"]))
                discount = int(round(ev.price * SUB_DISCOUNT)) if p.sub_active and ev.is_partner else 0
                app["status"] = "paid"
                app["refund"] = ev.price - discount
                steps.append(
                    (
                        "purchase",
                        {
                            "screen": "payment_confirm",
                            "event": ev,
                            "order_id": oid,
                            "value": ev.price - discount,
                            "discount": discount,
                            "method": method,
                            "ledger_pay": app,
                        },
                    )
                )
                steps.append(("screen_view", {"screen": "payment_success", "event": ev}))
            else:
                app["status"] = "payment_pending"
        if app["status"] != "payment_pending":
            p.open_apps.append(app)
            ev.seats += 1

    def _cancel(self, app: dict[str, Any], t: int) -> None:
        app["cancel_pending"] = t

    def _auto_session(self, p: Person, dev_i: int, start: int) -> list[dict[str, Any]]:
        dev = p.devices[dev_i]
        dev.session_number += 1
        steps = [("session_start", {}), ("screen_view", {"screen": "home"})]
        return self._emit(
            p,
            dev,
            start,
            ("(direct)", "(none)", "(direct)", "(not set)"),
            steps,
            False,
            dev.user_id,
            p.sub_active,
            auto=True,
        )

    # ---- 행 직렬화

    def _page(self, screen: str, kw: dict[str, Any]) -> tuple[str, str]:
        ev: EventItem | None = kw.get("event")
        v: Venue | None = kw.get("venue")
        h = f"https://{self.host}"
        paths = {
            "home": ("/", "Placewave"),
            "map_main": ("/map", "지도 | Placewave"),
            "search_main": ("/search", "검색 | Placewave"),
            "search_result": ("/search/results", "검색 결과 | Placewave"),
            "login": ("/login", "로그인 | Placewave"),
            "subscribe": ("/subscribe", "구독 | Placewave"),
            "taste_setup": ("/taste", "취향 설정 | Placewave"),
        }
        if screen in paths:
            path, title = paths[screen]
        elif screen in ("venue_detail", "venue_review") and v is not None:
            path = f"/venue/{v.venue_id}" + ("/reviews" if screen == "venue_review" else "")
            title = f"{v.name} | Placewave"
        elif ev is not None:
            suffix = {
                "event_detail": "",
                "event_apply": "/apply",
                "payment_confirm": "/payment",
                "payment_success": "/payment/success",
            }.get(screen, "")
            path = f"/event/{ev.event_id}{suffix}"
            title = f"{ev.name} | Placewave"
        else:
            path, title = "/", "Placewave"
        return h + path, title

    def _emit(
        self,
        p: Person,
        dev: Device,
        start: int,
        channel: tuple,
        steps: list,
        is_paid: bool,
        start_user: str | None,
        start_sub: bool,
        auto: bool = False,
    ) -> list[dict[str, Any]]:
        """steps 를 시각·체류·세션 속성이 붙은 이벤트 행으로 바꾸고 원장 행을 쓴다."""
        rng = self.rng
        n = len(steps)
        n_screens = sum(1 for e, _ in steps if e == "screen_view")
        if auto:
            span_s, eng_ms = float(rng.uniform(0, 1.5)), 0
        else:
            lo, hi = _band(n_screens, *self.s.quantiles["screen_views_per_session"])
            u = float(rng.uniform(lo, hi))
            span_s = max(1.0, self._quantile("span_sec_per_session", u) * float(rng.lognormal(0, 0.3)))
            eng_ms = int(
                min(self._quantile("engagement_ms_per_session", u) * float(rng.lognormal(0, 0.3)), span_s * 1000)
            )
            if is_paid:
                eng_ms = int(eng_ms * 0.6)
        end_cap = min(self.range_end, self.end_cap)
        if start + span_s >= end_cap:
            # 시작 시각(따라서 시)은 유지하고 길이만 줄여 관측 끝이나 다음 세션 시작을 넘지 않게 한다
            span_s = max(1.0, end_cap - start - 2)
            eng_ms = min(eng_ms, int(span_s * 1000))
        # 시각: 랜딩까지는 거의 동시, 이후는 구간 안 정렬 균등
        head = 0
        for e, _ in steps:
            head += 1
            if e == "screen_view":
                break
        offsets = (
            np.concatenate([np.arange(head) * 0.001, np.sort(rng.uniform(0.002, span_s, size=n - head))])
            if n > head
            else np.arange(n) * 0.001
        )
        base_us = start * 1_000_000
        ts = [base_us + int(o * 1_000_000) + i for i, o in enumerate(offsets)]
        # 체류: screen_view(랜딩 이후)·user_engagement 에 배분
        elig = [i for i, (e, a) in enumerate(steps) if e == "user_engagement" or (e == "screen_view" and i >= head)]
        eng = [0] * n
        if eng_ms > 0:
            if not elig:
                elig = [head - 1]
            parts = rng.dirichlet(np.ones(len(elig))) * eng_ms
            for i, v in zip(elig, parts, strict=True):
                eng[i] = int(v)
        key = any(e in KEY_EVENTS for e, _ in steps)
        engaged = "1" if (not auto and (eng_ms >= 10000 or n_screens >= 2 or key)) else "0"

        sid = start
        snum = dev.session_number
        src, med, camp, content = channel
        first_ch = "paid" if p.first_channel[1] == "paid_social" else "non_paid"
        uprops = [
            [
                {"key": "first_channel", "string_value": first_ch},
                {"key": "device_platform", "string_value": dev.platform},
                {"key": "subscriber", "string_value": flag},
            ]
            for flag in ("0", "1")
        ]
        sub_on = start_sub
        rows: list[dict[str, Any]] = []
        user_id = start_user
        cur_screen = "home"
        cur_kw: dict[str, Any] = {}
        for i, (e, a) in enumerate(steps):
            if "set_user" in a:
                user_id = a["set_user"]
            if "sub_on" in a:
                sub_on = a["sub_on"]
            if e == "screen_view":
                cur_screen = a["screen"]
                cur_kw = a
            elif e in ("session_start", "first_visit", "page_view") and i < head:
                land = next((x for x in steps if x[0] == "screen_view"), ("", {"screen": "home"}))[1]
                cur_screen, cur_kw = land["screen"], land
            loc, title = self._page(cur_screen, cur_kw)
            params: list[dict[str, Any]] = []
            if e == "screen_view":
                params.append(_sp("screen_name", cur_screen))
            ev: EventItem | None = a.get("event")
            if ev is not None and e != "page_view":
                params.append(_ip("event_id", ev.event_id))
            vn: Venue | None = a.get("venue")
            if vn is not None and e != "page_view":
                params.append(_ip("venue_id", vn.venue_id))
                if e == "screen_view" and cur_screen == "venue_detail":
                    dv = min((ts[i] // 1_000_000 - self.day0) // 86400, self.n_days - 1)
                    params.append(_sp("is_partner", "1" if self.partner_day[dv, vn.venue_id - 101] else "0"))
            if e == "search":
                rec = a["req"]
                lag_ms = rec["latency_ms"] + int(self.search_rng.integers(20, 250))
                rec["requested_at"] = ts[i] - lag_ms * 1000
                params.append(_sp("search_term", a["term"]))
                params.append(_sp("search_id", rec["request_id"]))
            if e == "select_search_result":
                params.append(_sp("search_id", a["req"]["request_id"]))
                params.append(_ip("position", a["position"]))
                params.append(_sp("item_type", a["item_type"]))
                params.append(_ip("item_id", a["item_id"]))
                self.search_clicks.append(
                    {
                        "request_id": a["req"]["request_id"],
                        "clicked_at": ts[i] + int(self.search_rng.integers(5, 120)) * 1000,
                        "position": a["position"],
                        "item_type": a["item_type"],
                        "item_id": a["item_id"],
                    }
                )
            if e in ("view_promotion", "select_promotion"):
                params.append(_sp("promotion_id", f"home_banner_{ev.event_id}"))
            if e == "share":
                params.append(_sp("content_type", "event" if ev is not None else "venue"))
                params.append(_sp("method", str(rng.choice(["link", "sns"], p=[0.6, 0.4]))))
            if e in ("sign_up", "login"):
                params.append(_sp("method", a["method"]))
            if e in ("apply_event", "purchase", "cancel_apply"):
                params.append(_sp("order_id", a["order_id"]))
                params.append(_ip("value", int(a["value"])))
                params.append(_sp("currency", "KRW"))
                params.append(_sp("price_tier", ev.price_tier))
            if e == "purchase":
                params.append(_sp("payment_method", a["method"]))
            if e == "subscribe":
                params.append(_sp("order_id", a["order_id"]))
                params.append(_sp("subscription_id", a["sub_id"]))
                params.append(_ip("value", SUB_PRICE))
                params.append(_sp("currency", "KRW"))
            if e == "subscription_cancel":
                params.append(_sp("subscription_id", a["sub_id"]))
            t_us = ts[i]
            if a.get("ga_drop"):
                continue
            rows.append(
                {
                    "event_date": datetime.fromtimestamp(t_us // 1_000_000, KST).strftime("%Y-%m-%d"),
                    "event_timestamp": t_us,
                    "event_name": e,
                    "user_pseudo_id": dev.client_id,
                    "user_id": user_id,
                    "ga_session_id": sid,
                    "ga_session_number": snum,
                    "engagement_time_msec": eng[i],
                    "page_location": loc,
                    "page_title": title,
                    "session_engaged": engaged,
                    "device_category": dev.category,
                    "operating_system": dev.os,
                    "traffic_source": {"source": src, "medium": med, "campaign": camp, "content": content},
                    "user_properties": uprops[1 if sub_on else 0],
                    "event_params": params,
                }
            )
            # 원장
            if e == "apply_event":
                app = a["ledger_app"]
                app["applied_ts"] = t_us // 1_000_000
                app["member_id"] = user_id
                self.ledger["applications"].append(app)
            elif e == "purchase":
                self.ledger["payments"].append(
                    {
                        "order_id": a["order_id"],
                        "member_id": user_id,
                        "kind": "ticket",
                        "event_id": ev.event_id,
                        "subscription_id": "",
                        "amount": int(a["value"]),
                        "discount_amount": a["discount"],
                        "paid_at": _ts(t_us // 1_000_000),
                        "status": "paid",
                        "method": a["method"],
                        "_app": a["ledger_pay"],
                    }
                )
            elif e == "cancel_apply":
                a["ledger_app"]["canceled_ts"] = t_us // 1_000_000
            elif e == "subscribe":
                rec = a["sub_rec"]
                rec.update(member_id=user_id, start_ts=t_us // 1_000_000)
                rec["method"] = str(rng.choice(["card", "easy_pay"], p=[0.6, 0.4]))
                self.ledger["subscriptions"].append(rec)
            elif e == "subscription_cancel":
                a["sub_rec"]["end_ts"] = t_us // 1_000_000
            elif e == "sign_up":
                self.ledger["members"].append(
                    {
                        "member_id": user_id,
                        "signed_up_at": _ts(t_us // 1_000_000),
                        "region": self.s.names["regions"][p.region]["name"],
                        "genre_tags": "|".join(self.s.names["genres"][g] for g in p.genres),
                        "marketing_opt_in": str(p.marketing_opt_in).lower(),
                    }
                )
        return rows

    # ---- 원장 마감

    def finalize_ledgers(self) -> None:
        """신청·결제·구독 원장의 최종 상태(취소·해지 반영, 구독 반복 결제)를 확정한다."""
        apps = []
        for app in self.ledger["applications"]:
            canceled = "canceled_ts" in app
            apps.append(
                {
                    "order_id": app["order_id"],
                    "event_id": app["ev"].event_id,
                    "member_id": app["member_id"],
                    "applied_at": _ts(app["applied_ts"]),
                    "status": "canceled" if canceled else app["status"],
                    "cancel_at": _ts(app["canceled_ts"]) if canceled else "",
                    "cancel_amount": app["refund"] if canceled else 0,
                }
            )
        self.ledger["applications"] = apps
        pays = []
        for pay in self.ledger["payments"]:
            app = pay.pop("_app")
            if "canceled_ts" in app:
                pay["status"] = "refunded"
            pays.append(pay)
        # 구독: 시작 시각 기준 매월 반복 결제, 해지 시각 이후·관측 끝 이후는 청구하지 않는다
        subs = []
        for rec in self.ledger["subscriptions"]:
            start = datetime.fromtimestamp(rec["start_ts"], KST)
            end_ts = rec["end_ts"]
            k = 0
            while True:
                t = int(_add_months(start, k).timestamp())
                if t >= self.range_end or (end_ts is not None and t >= end_ts):
                    break
                pays.append(
                    {
                        "order_id": f"{rec['subscription_id']}-{k + 1:02d}",
                        "member_id": rec["member_id"],
                        "kind": "subscription",
                        "event_id": "",
                        "subscription_id": rec["subscription_id"],
                        "amount": SUB_PRICE,
                        "discount_amount": 0,
                        "paid_at": _ts(t),
                        "status": "paid",
                        "method": rec["method"],
                    }
                )
                k += 1
            subs.append(
                {
                    "subscription_id": rec["subscription_id"],
                    "member_id": rec["member_id"],
                    "started_at": _ts(rec["start_ts"]),
                    "ended_at": _ts(end_ts) if end_ts is not None else "",
                    "status": "canceled" if end_ts is not None else "active",
                    "price": SUB_PRICE,
                }
            )
        self.ledger["payments"] = pays
        self.ledger["subscriptions"] = subs


# ---------------------------------------------------------------- 유틸


def _ts(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _add_months(t: Any, k: int) -> Any:
    """date 또는 datetime 에 k 개월을 더한다. 말일을 넘는 날은 그 달 말일로 맞춘다."""
    m = t.month - 1 + k
    y, m = t.year + m // 12, m % 12 + 1
    nxt = date(y + m // 12, m % 12 + 1, 1)
    last = (nxt - date(y, m, 1)).days
    return t.replace(year=y, month=m, day=min(t.day, last))


def _sp(key: str, value: str) -> dict[str, Any]:
    return {"key": key, "string_value": value, "int_value": None}


def _ip(key: str, value: int) -> dict[str, Any]:
    return {"key": key, "string_value": None, "int_value": int(value)}


def _band(n: int, probs: np.ndarray, vals: np.ndarray) -> tuple[float, float]:
    """관측값 n 이 seed 분위수 표에서 차지하는 누적확률 구간을 돌려준다."""
    lo = max([0.0] + [float(p) for p, v in zip(probs, vals, strict=True) if v < n])
    hi = min([1.0] + [float(p) for p, v in zip(probs, vals, strict=True) if v > n])
    return lo, max(hi, lo + 1e-3)


OUTPUT_FILES = {
    "members": "db_members",
    "venues": "db_venues",
    "contracts": "db_venue_contracts",
    "contract_changes": "db_venue_contract_changes",
    "events_master": "db_events",
    "applications": "db_applications",
    "payments": "db_payments",
    "subscriptions": "db_subscriptions",
    "ad_spend": "ads_spend",
}
EVENTS_FILE = "ga4_events.ndjson.gz"
SEARCH_LOG_FILE = "search_log.ndjson.gz"
SEARCH_CLICK_FILE = "search_click_log.csv"

LEDGER_COLUMNS = {
    "members": ["member_id", "signed_up_at", "region", "genre_tags", "marketing_opt_in"],
    "venues": [
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
        "status",
    ],
    "contracts": ["contract_id", "venue_id", "plan", "monthly_fee", "started_at", "ended_at", "status"],
    "contract_changes": [
        "change_id",
        "contract_id",
        "venue_id",
        "changed_at",
        "from_plan",
        "to_plan",
        "from_fee",
        "to_fee",
    ],
    "events_master": [
        "event_id",
        "venue_id",
        "name",
        "event_type",
        "starts_at",
        "price_tier",
        "price",
        "capacity",
        "is_partner_venue",
    ],
    "applications": ["order_id", "event_id", "member_id", "applied_at", "status", "cancel_at", "cancel_amount"],
    "payments": [
        "order_id",
        "member_id",
        "kind",
        "event_id",
        "subscription_id",
        "amount",
        "discount_amount",
        "paid_at",
        "status",
        "method",
    ],
    "subscriptions": ["subscription_id", "member_id", "started_at", "ended_at", "status", "price"],
    "ad_spend": ["date", "campaign_id", "campaign_name", "spend", "impressions", "clicks"],
}


def write_ledgers(g: Generator, raw_dir: Path) -> None:
    """원장 9종을 CSV 로 쓴다. 서비스 RDB 스냅샷(db_*)에는 snapshot_date 열을 붙인다.

    Args:
        g: 실행이 끝난 생성기.
        raw_dir: 출력 디렉터리.
    """
    snapshot = g.end_date.isoformat()
    for name, cols in LEDGER_COLUMNS.items():
        rows = g.ledger[name]
        if name in ("members", "applications", "payments", "subscriptions"):
            rows = sorted(rows, key=lambda r: r[cols[0]])
        out_name = OUTPUT_FILES[name]
        is_db = out_name.startswith("db_")
        fields = cols + ["snapshot_date"] if is_db else cols
        with open(raw_dir / f"{out_name}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
            w.writeheader()
            for r in rows:
                row = {c: r[c] for c in cols}
                if is_db:
                    row["snapshot_date"] = snapshot
                w.writerow(row)


def write_search_logs(g: Generator, raw_dir: Path) -> None:
    """검색 서버 요청 로그(NDJSON, 요청 1건 = 1행)와 서버 클릭 로그(CSV, 결과 클릭 1건 = 1행)를 쓴다.

    Args:
        g: 실행이 끝난 생성기.
        raw_dir: 출력 디렉터리.
    """
    snapshot = g.end_date.isoformat()

    def iso_us(t: int) -> str:
        return datetime.fromtimestamp(t / 1e6, UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    missing = sum(r["requested_at"] is None for r in g.search_log)
    if missing:
        raise SystemExit(f"요청 시각이 없는 검색 {missing}건")
    with open(raw_dir / SEARCH_LOG_FILE, "wb") as fb, gzip.GzipFile(fileobj=fb, mode="wb", mtime=0) as gz:
        for r in sorted(g.search_log, key=lambda x: (x["requested_at"], x["request_id"])):
            rec = {**r, "requested_at": iso_us(r["requested_at"]), "snapshot_date": snapshot}
            gz.write((json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    cols = ["request_id", "clicked_at", "position", "item_type", "item_id"]
    with open(raw_dir / SEARCH_CLICK_FILE, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow([*cols, "snapshot_date"])
        for r in sorted(g.search_clicks, key=lambda x: (x["clicked_at"], x["request_id"])):
            w.writerow(
                [r["request_id"], iso_us(r["clicked_at"]), r["position"], r["item_type"], r["item_id"], snapshot]
            )


def write_manifest(out: Path, seed: int, args: argparse.Namespace, elapsed: float) -> None:
    """data/MANIFEST.txt 에 파일별 행 수·SHA256·seed·생성 시각을 쓴다.

    Args:
        out: 출력 루트(data/).
        seed: 난수 시드.
        args: CLI 인자.
        elapsed: 생성 소요 초.
    """
    lines = [
        "# Placewave 합성 데이터 MANIFEST (실제 서비스 데이터 아님)",
        f"seed: {seed}",
        f"args: weeks={args.weeks} persons={args.persons} end_date={args.end_date}",
        f"generated_at_utc: {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')}",
        f"elapsed_sec: {elapsed:.1f}",
        "",
        "file\trows\tsha256",
    ]
    own = {f"{n}.csv" for n in OUTPUT_FILES.values()} | {EVENTS_FILE, SEARCH_LOG_FILE, SEARCH_CLICK_FILE}
    for f in sorted(x for x in (out / "raw").iterdir() if x.name in own):
        h = hashlib.sha256(f.read_bytes()).hexdigest()
        if f.suffix == ".gz":
            with gzip.open(f, "rt", encoding="utf-8") as fh:
                rows = sum(1 for _ in fh)
        else:
            with open(f, encoding="utf-8") as fh:
                rows = sum(1 for _ in fh) - 1
        lines.append(f"raw/{f.name}\t{rows}\t{h}")
    (out / "MANIFEST.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    """CLI 진입점."""
    ap = argparse.ArgumentParser(description="Placewave 합성 데이터 생성기")
    ap.add_argument("--seed", type=int, default=20260923)
    ap.add_argument("--weeks", type=int, default=52)
    ap.add_argument("--persons", type=int, default=8000)
    ap.add_argument("--end-date", type=date.fromisoformat, default=date(2026, 9, 20))
    ap.add_argument("--out", type=Path, default=Path("data"))
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    t0 = time.time()
    seed = load_seed()
    g = Generator(seed, args.seed, args.weeks, args.persons, args.end_date)
    g.build_registry()
    g.build_catalog()
    g.build_search()
    g.build_ads()
    g.build_people()
    g.plan_subscriptions()
    logger.info(
        "사람 %d명, 공간 %d곳, 행사 %d건, 방문일 %d",
        len(g.people),
        len(g.venues),
        len(g.events),
        sum(map(len, g.visit_days)),
    )
    raw_dir = args.out / "raw"
    g.run(raw_dir / EVENTS_FILE)
    g.finalize_ledgers()
    write_ledgers(g, raw_dir)
    write_search_logs(g, raw_dir)
    logger.info("검색 요청 %d건, 결과 클릭 %d건", len(g.search_log), len(g.search_clicks))
    elapsed = time.time() - t0
    write_manifest(args.out, args.seed, args, elapsed)
    logger.info("이벤트 %d행, %.1f초", g.rows, elapsed)


if __name__ == "__main__":
    main()
