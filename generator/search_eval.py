"""Placewave 검색 서버 로그 · 관련성 평가 원천 생성기 (시나리오 3.0).

기존 원천(`data/raw/ga4_events.ndjson.gz`, `db_venues.csv`, `db_events.csv`)을 **읽기만** 하고
부속 원천 6개를 새로 쓴다. 기존 파일은 바꾸지 않는다. 설계는 `docs/scenario_v3_search_eval.md`.

    raw/search_log.ndjson.gz   검색 요청 1건 = 1행 (GA search 이벤트마다 1건 + GA 미수집 요청)
    raw/eval_raters.csv        평가자
    raw/eval_batches.csv       평가 배치
    raw/eval_queries.csv       배치에 편입된 검색어
    raw/eval_tasks.csv         검색어 × 후보 과제
    raw/eval_labels.csv        라벨

실행:
    uv run generator/search_eval.py --data data/
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import logging
import math
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger("placewave.search_eval")

SEED_DIR = Path(__file__).resolve().parent / "seed"
KST = timezone(timedelta(hours=9))
SNAPSHOT = date(2026, 9, 20)

RANKER_AB_START = date(2026, 7, 13)
RANKER_V2_ALL = date(2026, 7, 27)
PROGRAM_START = date(2026, 4, 1)
PROMOTION_START = date(2026, 5, 4)
GUIDELINE_V2 = date(2026, 6, 1)
CAMPAIGN_ADHOC = date(2026, 9, 1)
PRELAUNCH_ADHOC = date(2026, 7, 6)
REINDEX_BUG = (date(2026, 9, 1), date(2026, 9, 4))  # 가을 캠페인 대비 재색인에서 구분자(·) 정규화 누락, 9/5 핫픽스
REINDEX_BUG_ZERO = 0.9  # 회귀 기간 구분자 검색어 중 클릭이 없던 요청이 결과 0건이 될 확률
REGRESSION_ADHOC = date(2026, 9, 8)  # 회귀 검증용 검색팀 긴급 배치

GA_MISSING_SHARE = 0.015  # 서버에만 남은 요청 비중 (GA 미수집)
MATCH_WINDOW_US = 3_000_000
TOP_N = 10
LABELS_PER_TASK = 3
GOLD_SHARE = 0.10
AUDIT_SHARE = 0.20  # 검수 표본 비중. 표본 중 오답은 반려되어 재작업
FAILED_MIN_SEARCHES = 20
FAILED_MIN_ZERO_RATE = 0.30
TASKS_PER_QUERY = 12
PLAN_SHARE = 0.80  # 주간 계획 과제 = 명목 용량(weekly_target 합 ÷ 과제당 라벨)의 80%. 결근·재작업 여유

GENRE_NEIGHBOR = {
    "힙합": ["K-pop/팝"],
    "K-pop/팝": ["힙합", "일렉트로닉"],
    "시티팝/디스코": ["일렉트로닉"],
    "일렉트로닉": ["시티팝/디스코", "K-pop/팝"],
    "재즈/소울": ["어쿠스틱"],
    "어쿠스틱": ["재즈/소울"],
}
PARTY_GENRES = {"힙합", "K-pop/팝", "시티팝/디스코", "일렉트로닉"}
PARTY_TYPES = {"팝업 스페이스", "카페", "루프탑"}
CALM_TYPES = {"라운지", "바", "라이브홀"}
EVENT_NEIGHBOR = {
    "팝업 이벤트": ["루프탑 세션"],
    "루프탑 세션": ["팝업 이벤트"],
    "라이브 공연": ["쇼케이스", "리스닝 세션"],
    "쇼케이스": ["라이브 공연"],
    "리스닝 세션": ["라이브 공연"],
}
EVENT_VENUE_TYPE = {
    "팝업 이벤트": {"팝업 스페이스"},
    "루프탑 세션": {"루프탑"},
    "라이브 공연": {"라이브홀"},
    "쇼케이스": {"라이브홀", "라운지"},
    "리스닝 세션": {"라운지", "바"},
}


def kst_date(us: int) -> date:
    """UTC 마이크로초 → KST 날짜."""
    return datetime.fromtimestamp(us / 1e6, KST).date()


def monday(d: date) -> date:
    """그 주 월요일(KST)."""
    return d - timedelta(days=d.weekday())


def bucket(client_id: str) -> int:
    """기기 해시 버킷 0/1 (랭킹 50% 노출)."""
    return int(hashlib.md5(client_id.encode()).hexdigest()[:8], 16) % 2


def ranker_for(d: date, client_id: str) -> str:
    """요청 날짜·기기의 랭킹 버전."""
    if d < RANKER_AB_START:
        return "v1"
    if d < RANKER_V2_ALL:
        return "v2" if bucket(client_id) else "v1"
    return "v2"


def haversine_km(lat1: np.ndarray, lng1: np.ndarray, lat2: float, lng2: float) -> np.ndarray:
    """위경도 배열과 한 점 사이 거리(km)."""
    r = 6371.0
    p1, p2 = np.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2) - np.radians(lng1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * math.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


@dataclass
class Catalog:
    """공간·행사 원장과 검색어 → 참 관련도 계산."""

    venue_id: np.ndarray
    v_name_head: np.ndarray
    v_region: np.ndarray
    v_genre: np.ndarray
    v_type: np.ndarray
    v_lat: np.ndarray
    v_lng: np.ndarray
    v_reg_day: np.ndarray
    event_id: np.ndarray
    e_venue_idx: np.ndarray
    e_type: np.ndarray
    e_start_day: np.ndarray
    e_partner: np.ndarray
    genres: set[str]
    regions: dict[str, list[tuple[float, float]]]
    event_types: set[str]
    vidx: dict[int, int] = field(default_factory=dict)
    eidx: dict[int, int] = field(default_factory=dict)
    cache: dict[str, tuple[np.ndarray, np.ndarray]] = field(default_factory=dict)

    @classmethod
    def load(cls, raw: Path) -> Catalog:
        """db_venues·db_events·names.json 을 읽는다."""
        names = json.loads((SEED_DIR / "names.json").read_text(encoding="utf-8"))
        with open(raw / "db_venues.csv", encoding="utf-8") as f:
            vs = list(csv.DictReader(f))
        with open(raw / "db_events.csv", encoding="utf-8") as f:
            es = list(csv.DictReader(f))

        def day(ts: str) -> int:
            return (datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(KST).date() - date(2025, 1, 1)).days

        vid = np.array([int(v["venue_id"]) for v in vs])
        vidx = {int(v): i for i, v in enumerate(vid)}
        cat = cls(
            venue_id=vid,
            v_name_head=np.array([v["name"].split(" ")[0] for v in vs]),
            v_region=np.array([v["region"] for v in vs]),
            v_genre=np.array([v["genre"] for v in vs]),
            v_type=np.array([v["venue_type"] for v in vs]),
            v_lat=np.array([float(v["lat"]) for v in vs]),
            v_lng=np.array([float(v["lng"]) for v in vs]),
            v_reg_day=np.array([day(v["registered_at"]) for v in vs]),
            event_id=np.array([int(e["event_id"]) for e in es]),
            e_venue_idx=np.array([vidx[int(e["venue_id"])] for e in es]),
            e_type=np.array([e["event_type"] for e in es]),
            e_start_day=np.array([day(e["starts_at"]) for e in es]),
            e_partner=np.array([e["is_partner_venue"] == "true" for e in es]),
            genres=set(names["genres"]),
            regions={r["name"]: [tuple(c) for c in r["centers"]] for r in names["regions"]},
            event_types=set(names["event_types"]),
        )
        cat.vidx = vidx
        cat.eidx = {int(e): i for i, e in enumerate(cat.event_id)}
        return cat

    def intent(self, term: str) -> str:
        """검색어 의도 유형 genre / region / event_type / venue_name."""
        if term in self.genres:
            return "genre"
        if term in self.regions:
            return "region"
        if term in self.event_types:
            return "event_type"
        return "venue_name"

    def grades(self, term: str) -> tuple[np.ndarray, np.ndarray]:
        """검색어에 대한 (공간 등급, 행사 등급) 0~3. 기간 무관 속성 일치로만 정한다."""
        if term in self.cache:
            return self.cache[term]
        it = self.intent(term)
        n = len(self.venue_id)
        vg = np.zeros(n, dtype=np.int8)
        if it == "genre":
            near = GENRE_NEIGHBOR.get(term, [])
            weak = PARTY_TYPES if term in PARTY_GENRES else CALM_TYPES
            vg[np.isin(self.v_type, list(weak))] = 1
            vg[np.isin(self.v_genre, near)] = 2
            vg[self.v_genre == term] = 3
            eg = vg[self.e_venue_idx].copy()
        elif it == "region":
            centers = self.regions.get(term, [])
            if centers and term != "기타":
                dist = np.min([haversine_km(self.v_lat, self.v_lng, la, ln) for la, ln in centers], axis=0)
                vg[dist <= 5.0] = 1
                vg[dist <= 2.5] = 2
            vg[self.v_region == term] = 3
            eg = vg[self.e_venue_idx].copy()
        elif it == "event_type":
            vg[np.isin(self.v_type, list(EVENT_VENUE_TYPE.get(term, set())))] = 1
            eg = np.zeros(len(self.event_id), dtype=np.int8)
            eg[np.isin(self.e_type, EVENT_NEIGHBOR.get(term, []))] = 2
            eg[self.e_type == term] = 3
            hosts = np.unique(self.e_venue_idx[self.e_type == term])
            vg[hosts] = np.maximum(vg[hosts], 2)
        else:
            hit = self.v_name_head == term
            if hit.any():
                ref = np.flatnonzero(hit)[0]
                vg[(self.v_region == self.v_region[ref]) & (self.v_genre == self.v_genre[ref])] = 1
            vg[hit] = 3
            eg = np.where(hit[self.e_venue_idx], 2, 0).astype(np.int8)
        self.cache[term] = (vg, eg)
        return vg, eg

    def visible(self, d: date) -> tuple[np.ndarray, np.ndarray]:
        """그날 보이는 공간(등록 완료)·행사(28일 안 시작 예정) 마스크."""
        k = (d - date(2025, 1, 1)).days
        return self.v_reg_day <= k, (self.e_start_day >= k) & (self.e_start_day <= k + 28)


@dataclass
class Search:
    """GA search 이벤트에서 읽은 검색 1건."""

    client_id: str
    ts: int
    term: str
    next_kind: str  # click / research / other
    click_venue: int | None


def read_ga_searches(path: Path) -> list[Search]:
    """GA 로그를 세션 단위로 훑어 search 이벤트와 그 다음 행동을 뽑는다.

    다음 행동은 검색 결과 화면(screen_view search_result) 바로 다음의 screen_view 또는 search 이벤트로 정한다.
    """
    out: list[Search] = []
    cur: tuple[str, int] | None = None
    buf: list[tuple[int, str, str | None, int | None]] = []

    def flush() -> None:
        if not buf or not any(b[1] == "S" for b in buf):
            return
        buf.sort(key=lambda b: b[0])
        for i, (ts, kind, val, _vid) in enumerate(buf):
            if kind != "S":
                continue
            j = i + 1
            while j < len(buf) and not (buf[j][1] == "V" and buf[j][2] == "search_result"):
                j += 1
            nxt, click = "other", None
            if j + 1 < len(buf):
                k = buf[j + 1]
                if k[1] == "S":
                    nxt = "research"
                elif k[2] == "venue_detail" and k[3] is not None:
                    nxt, click = "click", k[3]
            out.append(Search(cur[0], ts, val or "", nxt, click))

    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            is_search = '"event_name":"search"' in line
            if not is_search and '"screen_view"' not in line:
                continue
            e = json.loads(line)
            key = (e["user_pseudo_id"], e["ga_session_id"])
            if key != cur:
                flush()
                cur, buf = key, []
            p = {
                x["key"]: (x["string_value"] if x["string_value"] is not None else x["int_value"])
                for x in e["event_params"]
            }
            if is_search:
                buf.append((e["event_timestamp"], "S", p.get("search_term"), None))
            else:
                buf.append((e["event_timestamp"], "V", p.get("screen_name"), p.get("venue_id")))
        flush()
    return out


class Builder:
    """검색 서버 로그와 평가 운영 원천을 만든다."""

    def __init__(self, cat: Catalog, seed: int) -> None:
        self.cat = cat
        self.rng = np.random.default_rng(seed)
        self.bug_rng = np.random.default_rng([seed, 3])  # 재색인 회귀 전용 난수열. 기존 난수 흐름을 바꾸지 않는다
        self.log: list[dict[str, Any]] = []
        self.raters: list[dict[str, Any]] = []
        self.batches: list[dict[str, Any]] = []
        self.queries: list[dict[str, Any]] = []
        self.tasks: list[dict[str, Any]] = []
        self.labels: list[dict[str, Any]] = []

    # ---------- 검색 서버 로그 ----------

    def zero_prob(self, term: str, ranker: str, d: date) -> float:
        """클릭이 없었던 검색이 결과 0건일 확률. v1 은 구분자·영문 대소문자에 약하다."""
        it = self.cat.intent(term)
        punct = ("·" in term) or ("/" in term)
        latin = term[:1].isascii() and term[:1].isalpha()
        if it == "region":
            p = 0.10 + (0.45 if punct else 0.0)
        elif it == "genre":
            p = 0.08 + (0.40 if punct else 0.0)
        elif it == "event_type":
            p = 0.12
        else:
            p = 0.18 + (0.30 if latin else 0.0)
        if ranker == "v2":
            p *= 0.22
        return min(p, 0.9)

    def rank(self, term: str, d: date, ranker: str, click: int | None) -> tuple[int, list[tuple[int, str, int]]]:
        """결과 수와 상위 10 목록 [(순위, item_type, item_id)]. v1 은 등급 2 이상만, v2 는 1 이상을 찾는다."""
        cat, rng = self.cat, self.rng
        vg, eg = cat.grades(term)
        vvis, evis = cat.visible(d)
        floor = 2 if ranker == "v1" else 1
        vi = np.flatnonzero(vvis & (vg >= floor))
        ei = np.flatnonzero(evis & (eg >= floor))
        noise = 1.2 if ranker == "v1" else 0.5
        score = np.concatenate([vg[vi] + rng.normal(0, noise, len(vi)), eg[ei] - 0.2 + rng.normal(0, noise, len(ei))])
        order = np.argsort(-score)[: TOP_N + 1]
        top = [
            ("venue", int(cat.venue_id[vi[k]])) if k < len(vi) else ("event", int(cat.event_id[ei[k - len(vi)]]))
            for k in order
        ]
        count = len(vi) + len(ei)
        if click is not None:
            p = 0.35 if ranker == "v1" else 0.55
            item = ("venue", click)
            if item in top:
                top.remove(item)
            elif cat.vidx[click] not in set(vi.tolist()):
                count += 1
            pos = min(int(rng.geometric(p)), TOP_N, len(top) + 1)
            top.insert(pos - 1, item)
        top = top[:TOP_N]
        return max(count, len(top)), [(k + 1, t, i) for k, (t, i) in enumerate(top)]

    def promoted(self, term: str, d: date) -> int | None:
        """상단 추천 슬롯 행사 (파트너 공간 예정 행사)."""
        if d < PROMOTION_START or self.rng.random() > 0.6:
            return None
        _, evis = self.cat.visible(d)
        pool = np.flatnonzero(evis & self.cat.e_partner)
        if not len(pool):
            return None
        _, eg = self.cat.grades(term)
        good = pool[eg[pool] >= 1]
        pick = good if len(good) and self.rng.random() < 0.5 else pool
        return int(self.cat.event_id[pick[int(self.rng.integers(len(pick)))]])

    def build_log(self, searches: list[Search]) -> None:
        """GA 검색마다 서버 요청 1건, 그리고 GA 미수집 요청을 만든다."""
        rng = self.rng
        extra = rng.random(len(searches)) < GA_MISSING_SHARE
        rows: list[tuple[int, str, str, str | None, int | None]] = []
        for s, ex in zip(searches, extra, strict=True):
            rows.append((s.ts + int(rng.integers(50_000, 900_000)), s.client_id, s.term, s.next_kind, s.click_venue))
            if ex:
                rows.append((s.ts + int(rng.integers(20, 200)) * 1_000_000, s.client_id, s.term, None, None))
        rows.sort(key=lambda r: r[0])
        for n, (ts, cid, term, nxt, click) in enumerate(rows, 1):
            d = kst_date(ts)
            rk = ranker_for(d, cid)
            if click is None and rng.random() < self.zero_prob(term, rk, d):
                count, top = 0, []
            else:
                count, top = self.rank(term, d, rk, click)
                if count == 0:
                    top = []
            med = 120 if rk == "v1" else 95
            row = {
                "request_id": f"q{n:08d}",
                "requested_at": datetime.fromtimestamp(ts / 1e6, UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                "kst_date": d,
                "user_pseudo_id": cid,
                "query_raw": term,
                "ranker_version": rk,
                "results_count": count,
                "results": [{"position": p, "item_type": t, "item_id": i} for p, t, i in top],
                "promoted_event_id": self.promoted(term, d) if count else None,
                "latency_ms": int(rng.lognormal(math.log(med), 0.35)),
                "_ga": nxt is not None,
            }
            if (
                click is None
                and "·" in term
                and REINDEX_BUG[0] <= d <= REINDEX_BUG[1]
                and self.bug_rng.random() < REINDEX_BUG_ZERO
            ):
                row["_bug"] = (row["results_count"], row["results"], row["promoted_event_id"])
                row.update(results_count=0, results=[], promoted_event_id=None)
            self.log.append(row)

    def set_reindex_bug(self, on: bool) -> None:
        """재색인 회귀로 0건이 된 요청을 회귀 상태(on) 또는 원래 결과(off)로 둔다."""
        for r in self.log:
            if "_bug" in r:
                count, results, promoted = (0, [], None) if on else r["_bug"]
                r.update(results_count=count, results=results, promoted_event_id=promoted)

    # ---------- 평가 운영 ----------

    def build_raters(self) -> None:
        """평가자 13명. 내부 3 · 외부 10, 5월 확대, 7월 교체 1명, 8월 이탈·충원 1명."""
        spec = [
            ("R01", "internal", PROGRAM_START, None),
            ("R02", "internal", PROGRAM_START, None),
            ("R03", "vendor", PROGRAM_START, None),
            ("R04", "vendor", PROGRAM_START, None),
            ("R05", "vendor", PROGRAM_START, date(2026, 8, 7)),
            ("R06", "vendor", PROGRAM_START, None),
            ("R07", "internal", PROMOTION_START, None),
            ("R08", "vendor", PROMOTION_START, None),
            ("R09", "vendor", PROMOTION_START, None),
            ("R10", "vendor", PROMOTION_START, date(2026, 7, 17)),
            ("R11", "vendor", PROMOTION_START, None),
            ("R12", "vendor", PROMOTION_START, None),
            ("R13", "vendor", date(2026, 8, 10), None),
        ]
        for rid, grp, joined, left in spec:
            acc = 0.93 if grp == "internal" else float(np.clip(self.rng.normal(0.89, 0.025), 0.83, 0.94))
            speed = 32.0 if grp == "internal" else float(np.clip(self.rng.normal(26, 2.5), 21, 31))
            self.raters.append(
                {
                    "rater_id": rid,
                    "rater_group": grp,
                    "joined_at": joined,
                    "left_at": left,
                    "weekly_target": 300 if grp == "internal" else 800,
                    "_acc": acc,
                    "_speed": speed,
                }
            )

    def week_log(self, start: date, days: int) -> list[dict[str, Any]]:
        """[start, start+days) KST 날짜의 서버 요청."""
        end = start + timedelta(days=days)
        return [r for r in self.log if start <= r["kst_date"] < end]

    def candidates(
        self, term: str, rows: list[dict[str, Any]], d: date
    ) -> list[tuple[str, int, int | None, str | None]]:
        """검색어의 평가 후보 (item_type, item_id, 노출 순위, 랭킹 버전). 노출 목록 빈도순 + 확장 후보."""
        seen: dict[tuple[str, int], tuple[int, str]] = {}
        freq: Counter[tuple[str, int]] = Counter()
        for r in rows:
            for it in r["results"]:
                k = (it["item_type"], it["item_id"])
                freq[k] += 1
                if k not in seen or it["position"] < seen[k][0]:
                    seen[k] = (it["position"], r["ranker_version"])
        out = [(t, i, seen[(t, i)][0], seen[(t, i)][1]) for (t, i), _ in freq.most_common(TASKS_PER_QUERY)]
        if len(out) < TASKS_PER_QUERY:
            vg, eg = self.cat.grades(term)
            vvis, evis = self.cat.visible(d)
            pool = [("venue", int(self.cat.venue_id[i])) for i in np.flatnonzero(vvis & (vg >= 1))]
            pool += [("event", int(self.cat.event_id[i])) for i in np.flatnonzero(evis & (eg >= 1))]
            pool = [p for p in pool if p not in freq]
            self.rng.shuffle(pool)
            out += [(t, i, None, None) for t, i in pool[: TASKS_PER_QUERY - len(out)]]
        return out

    def true_grade(self, term: str, item_type: str, item_id: int) -> int:
        """과제의 참 등급."""
        vg, eg = self.cat.grades(term)
        if item_type == "venue":
            return int(vg[self.cat.vidx[item_id]])
        return int(eg[self.cat.eidx[item_id]])

    def add_batch(
        self, requester: str, purpose: str, created: date, due_days: int, priority: int, pairs: list[dict[str, Any]]
    ) -> None:
        """배치와 과제를 등록한다. 과제의 GOLD_SHARE 는 정답셋."""
        bid = f"B{len(self.batches) + 1:03d}"
        gv = "v2" if created >= GUIDELINE_V2 else "v1"
        created_at = datetime(created.year, created.month, created.day, 10, tzinfo=KST)
        for p in pairs:
            self.tasks.append(
                {
                    "task_id": f"T{len(self.tasks) + 1:06d}",
                    "batch_id": bid,
                    "query_norm": p["query"].strip().lower(),
                    "item_type": p["item_type"],
                    "item_id": p["item_id"],
                    "shown_position": p["pos"],
                    "ranker_version": p["ranker"],
                    "is_gold": bool(self.rng.random() < GOLD_SHARE),
                    "gold_grade": None,
                    "_grade": self.true_grade(p["query"], p["item_type"], p["item_id"]),
                    "_bidx": len(self.batches),
                }
            )
            if self.tasks[-1]["is_gold"]:
                self.tasks[-1]["gold_grade"] = self.tasks[-1]["_grade"]
        self.batches.append(
            {
                "batch_id": bid,
                "requester": requester,
                "purpose": purpose,
                "guideline_version": gv,
                "target_tasks": len(pairs),
                "labels_per_task": LABELS_PER_TASK,
                "created_at": created_at,
                "due_at": created_at + timedelta(days=due_days),
                "priority": priority,
            }
        )

    def search_batch(self, created: date, purpose: str, n_tasks: int, mix: tuple[float, float, float]) -> None:
        """검색팀 배치. 직전 7일 서버 로그에서 실패 → 상위 → 무작위 순으로 검색어를 뽑는다."""
        rows = self.week_log(created - timedelta(days=7), 7)
        by_q: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for r in rows:
            by_q[r["query_raw"].strip().lower()].append(r)
        stat = {q: (len(v), sum(1 for r in v if r["results_count"] == 0)) for q, v in by_q.items()}
        failed = [q for q, (n, z) in stat.items() if n >= FAILED_MIN_SEARCHES and z / n >= FAILED_MIN_ZERO_RATE]
        failed.sort(key=lambda q: -stat[q][0])
        head = [q for q, _ in sorted(stat.items(), key=lambda kv: -kv[1][0]) if q not in failed]
        rest = [q for q in by_q if q not in failed and q not in head[:40]]
        self.rng.shuffle(rest)
        picks: list[tuple[str, str]] = []
        carry = 0
        for k, (src, pool) in enumerate((("failed", failed), ("head", head), ("random", rest))):
            quota = n_tasks - len(picks) * TASKS_PER_QUERY if k == 2 else int(n_tasks * mix[k]) + carry
            got = 0
            for q in pool:
                if got >= quota or any(q == p for p, _ in picks):
                    continue
                picks.append((q, src))
                got += TASKS_PER_QUERY
            carry = max(0, quota - got)
        pairs = []
        bid = f"B{len(self.batches) + 1:03d}"
        for q, src in picks:
            term = by_q[q][0]["query_raw"]
            self.queries.append({"batch_id": bid, "query_norm": q, "source": src, "sampled_at": created})
            for t, i, pos, rk in self.candidates(term, by_q[q], created):
                pairs.append({"query": term, "item_type": t, "item_id": i, "pos": pos, "ranker": rk})
        due = 4 if purpose == "adhoc" else (21 if purpose == "eval" else 7)
        prio = 1 if purpose == "adhoc" else 2
        self.add_batch("search", purpose, created, due, prio, pairs)

    def promotion_batch(
        self, created: date, n_tasks: int, purpose: str = "train", due: int = 14, prio: int = 2
    ) -> None:
        """프로모션 배치. 직전 7일 상단 추천 슬롯 (검색어, 행사) 쌍."""
        rows = self.week_log(created - timedelta(days=7), 7)
        seen: dict[tuple[str, int], int] = {}
        for r in rows:
            if r["promoted_event_id"] is not None:
                seen[(r["query_raw"], r["promoted_event_id"])] = (
                    seen.get((r["query_raw"], r["promoted_event_id"]), 0) + 1
                )
        keys = list(seen)
        self.rng.shuffle(keys)
        keys = keys[:n_tasks]
        bid = f"B{len(self.batches) + 1:03d}"
        for q in sorted({k[0].strip().lower() for k in keys}):
            self.queries.append({"batch_id": bid, "query_norm": q, "source": "promoted", "sampled_at": created})
        pairs = [{"query": q, "item_type": "event", "item_id": e, "pos": 0, "ranker": None} for q, e in keys]
        self.add_batch("promotion", purpose, created, due, prio, pairs)

    def plan_with_regression(self) -> None:
        """재색인 회귀를 넣어 배치를 계획한다. 라벨 시뮬레이션은 회귀가 없을 때의 계획이 끝난 난수 지점에서
        시작해, 회귀의 영향을 받는 9/7 배치 이전의 과제·라벨이 회귀 추가 전과 같게 남는다."""
        start = self.rng.bit_generator.state
        self.set_reindex_bug(False)
        self.plan_batches(regression=False)
        after = self.rng.bit_generator.state
        self.batches, self.tasks, self.queries = [], [], []
        self.rng.bit_generator.state = start
        self.set_reindex_bug(True)
        self.plan_batches(regression=True)
        self.rng.bit_generator.state = after

    def plan_batches(self, regression: bool = True) -> None:
        """한 해의 배치 일정. 목표는 그 시점 평가 인력 용량에 맞춘다."""
        days = [PROGRAM_START]
        d = monday(PROGRAM_START) + timedelta(days=7)
        while d <= SNAPSHOT - timedelta(days=3):
            days.append(d)
            d += timedelta(days=7)
        for d in sorted({*days, CAMPAIGN_ADHOC, *([REGRESSION_ADHOC] if regression else [])}):
            if d == CAMPAIGN_ADHOC:
                self.promotion_batch(d, 2400, "adhoc", 4, 1)
                continue
            if d == REGRESSION_ADHOC:
                self.search_batch(d, "adhoc", 480, (0.8, 0.2, 0.0))
                continue
            active = [r for r in self.raters if r["joined_at"] <= d and (r["left_at"] is None or r["left_at"] > d)]
            cap_tasks = sum(r["weekly_target"] for r in active) / LABELS_PER_TASK
            promo = d > PROMOTION_START
            plan = cap_tasks * PLAN_SHARE
            self.search_batch(d, "train", int(plan * (0.6 if promo else 1.0)), (0.45, 0.35, 0.20))
            if promo:
                self.promotion_batch(d, int(plan * 0.4), due=7)
            if d.day <= 7 and d > PROGRAM_START:
                self.search_batch(d, "eval", 360, (0.0, 0.5, 0.5))
            if d == PRELAUNCH_ADHOC:
                self.search_batch(d, "adhoc", 900, (0.4, 0.6, 0.0))

    def accuracy(self, r: dict[str, Any], d: date, gv: str, grade: int) -> float:
        """평가자가 참 등급을 맞힐 확률."""
        acc = r["_acc"]
        weeks_in = (d - r["joined_at"]).days / 7
        acc -= 0.10 * max(0.0, 1 - weeks_in / 3)
        if grade in (1, 2):
            acc *= 0.86 if gv == "v1" else 0.95
        if r["rater_id"] == "R10" and d >= date(2026, 6, 15):
            acc = 0.58
        return float(np.clip(acc, 0.3, 0.98))

    def handle_seconds(self, r: dict[str, Any], d: date, gv: str) -> int:
        """라벨 1건 처리 시간(초)."""
        med = r["_speed"]
        since_v2 = (d - GUIDELINE_V2).days
        if gv == "v2":
            med *= 1.25 if 0 <= since_v2 < 21 else 0.97
        if r["rater_id"] == "R10" and d >= date(2026, 6, 15):
            med = 12.0
        return max(4, int(self.rng.lognormal(math.log(med), 0.45)))

    def observe(self, grade: int, acc: float) -> int:
        """참 등급에 잡음을 얹은 관측 등급."""
        if self.rng.random() < acc:
            return grade
        step = 1 if self.rng.random() < 0.85 else 2
        cand = [g for g in (grade - step, grade + step) if 0 <= g <= 3] or [g for g in range(4) if g != grade]
        return int(cand[int(self.rng.integers(len(cand)))])

    def simulate(self) -> None:
        """일 단위로 평가자에게 과제를 배정하고 라벨을 만든다. 검수 반려분은 다음 근무일 재작업."""
        rng = self.rng
        n_lab = [0] * len(self.tasks)
        who: list[set[str]] = [set() for _ in self.tasks]
        by_batch: dict[int, list[int]] = defaultdict(list)
        for k, t in enumerate(self.tasks):
            by_batch[t["_bidx"]].append(k)
        rework_q: dict[str, list[tuple[int, int]]] = defaultdict(list)
        d = PROGRAM_START
        while d <= SNAPSHOT:
            if d.weekday() >= 5:
                d += timedelta(days=1)
                continue
            open_b = sorted(
                (b for b, x in enumerate(self.batches) if x["created_at"].date() <= d),
                key=lambda b: (self.batches[b]["priority"], self.batches[b]["created_at"]),
            )
            for r in self.raters:
                if r["joined_at"] > d or (r["left_at"] is not None and r["left_at"] <= d):
                    continue
                cap = int(r["weekly_target"] / 5 * rng.uniform(0.7, 1.15))
                clock = datetime(d.year, d.month, d.day, 11, tzinfo=KST) + timedelta(minutes=int(rng.integers(0, 90)))
                jobs: list[tuple[int, bool]] = [(k, True) for k, _ in rework_q.pop(r["rater_id"], [])]
                for b in open_b:
                    if len(jobs) >= cap:
                        break
                    by_batch[b] = [k for k in by_batch[b] if n_lab[k] < LABELS_PER_TASK]
                    for k in by_batch[b]:
                        if len(jobs) >= cap:
                            break
                        if n_lab[k] < LABELS_PER_TASK and r["rater_id"] not in who[k]:
                            jobs.append((k, False))
                            n_lab[k] += 1
                            who[k].add(r["rater_id"])
                for k, rework in jobs:
                    t = self.tasks[k]
                    gv = self.batches[t["_bidx"]]["guideline_version"]
                    acc = 0.92 if rework else self.accuracy(r, d, gv, t["_grade"])
                    g = self.observe(t["_grade"], acc)
                    sec = self.handle_seconds(r, d, gv)
                    clock += timedelta(seconds=sec + int(rng.integers(2, 25)))
                    self.labels.append(
                        {
                            "label_id": f"L{len(self.labels) + 1:07d}",
                            "task_id": t["task_id"],
                            "rater_id": r["rater_id"],
                            "grade": g,
                            "submitted_at": clock.astimezone(UTC),
                            "handle_seconds": sec,
                            "is_rework": rework,
                        }
                    )
                    if not rework and g != t["_grade"] and rng.random() < AUDIT_SHARE:
                        rework_q[r["rater_id"]].append((k, 0))
            d += timedelta(days=1)

    # ---------- 출력 ----------

    def write(self, raw: Path) -> dict[str, int]:
        """부속 원천 6개를 쓴다. 기존 파일은 건드리지 않는다."""
        counts: dict[str, int] = {}
        path = raw / "search_log.ndjson.gz"
        with open(path, "wb") as fb, gzip.GzipFile(fileobj=fb, mode="wb", mtime=0) as gz:
            for r in self.log:
                rec = {k: v for k, v in r.items() if not k.startswith("_") and k != "kst_date"}
                rec["snapshot_date"] = SNAPSHOT.isoformat()
                gz.write((json.dumps(rec, ensure_ascii=False) + "\n").encode("utf-8"))
        counts["search_log"] = len(self.log)

        def fmt(v: Any) -> Any:
            if isinstance(v, datetime):
                return v.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            if isinstance(v, date):
                return v.isoformat()
            if isinstance(v, bool):
                return "true" if v else "false"
            return "" if v is None else v

        def dump(name: str, rows: list[dict[str, Any]], cols: list[str]) -> None:
            with open(raw / f"{name}.csv", "w", encoding="utf-8", newline="") as f:
                w = csv.writer(f)
                w.writerow([*cols, "snapshot_date"])
                for r in rows:
                    w.writerow([fmt(r[c]) for c in cols] + [SNAPSHOT.isoformat()])
            counts[name] = len(rows)

        dump("eval_raters", self.raters, ["rater_id", "rater_group", "joined_at", "left_at", "weekly_target"])
        dump(
            "eval_batches",
            self.batches,
            [
                "batch_id",
                "requester",
                "purpose",
                "guideline_version",
                "target_tasks",
                "labels_per_task",
                "created_at",
                "due_at",
                "priority",
            ],
        )
        dump("eval_queries", self.queries, ["batch_id", "query_norm", "source", "sampled_at"])
        dump(
            "eval_tasks",
            self.tasks,
            [
                "task_id",
                "batch_id",
                "query_norm",
                "item_type",
                "item_id",
                "shown_position",
                "ranker_version",
                "is_gold",
                "gold_grade",
            ],
        )
        dump(
            "eval_labels",
            self.labels,
            ["label_id", "task_id", "rater_id", "grade", "submitted_at", "handle_seconds", "is_rework"],
        )
        return counts


def summarize(b: Builder) -> dict[str, Any]:
    """시나리오 사건이 수치로 재현됐는지 보는 요약."""

    def zr(rows: list[dict[str, Any]]) -> float:
        return sum(r["results_count"] == 0 for r in rows) / max(1, len(rows))

    ab = [r for r in b.log if RANKER_AB_START <= r["kst_date"] < RANKER_V2_ALL]
    out: dict[str, Any] = {
        "search_log": len(b.log),
        "ga_missing": sum(not r["_ga"] for r in b.log),
        "zero_rate_v1_before": round(zr([r for r in b.log if r["kst_date"] < RANKER_AB_START]), 4),
        "zero_rate_ab_v1": round(zr([r for r in ab if r["ranker_version"] == "v1"]), 4),
        "zero_rate_ab_v2": round(zr([r for r in ab if r["ranker_version"] == "v2"]), 4),
        "zero_rate_v2_after": round(zr([r for r in b.log if r["kst_date"] >= RANKER_V2_ALL]), 4),
        "zero_rate_reindex_bug": round(zr([r for r in b.log if REINDEX_BUG[0] <= r["kst_date"] <= REINDEX_BUG[1]]), 4),
        "reindex_bug_zeroed": sum("_bug" in r for r in b.log),
        "batches": len(b.batches),
        "tasks": len(b.tasks),
        "labels": len(b.labels),
    }
    task = {t["task_id"]: t for t in b.tasks}
    for gv in ("v1", "v2"):
        gold = [
            x
            for x in b.labels
            if not x["is_rework"]
            and task[x["task_id"]]["is_gold"]
            and b.batches[task[x["task_id"]]["_bidx"]]["guideline_version"] == gv
        ]
        out[f"gold_acc_{gv}"] = round(
            sum(x["grade"] == task[x["task_id"]]["gold_grade"] for x in gold) / max(1, len(gold)), 4
        )
    done = Counter(x["task_id"] for x in b.labels if not x["is_rework"])
    out["tasks_done"] = sum(1 for v in done.values() if v >= LABELS_PER_TASK)
    return out


def validate(b: Builder) -> list[str]:
    """생성 단언. 어긋난 항목 목록(빈 목록이면 통과)."""
    errs: list[str] = []
    for r in b.log:
        if r["results_count"] < len(r["results"]):
            errs.append(f"{r['request_id']} results_count < 목록 길이")
            break
        pos = [x["position"] for x in r["results"]]
        if pos != list(range(1, len(pos) + 1)):
            errs.append(f"{r['request_id']} 순위가 1부터 연속이 아님")
            break
    per = Counter((x["task_id"], x["rater_id"]) for x in b.labels if not x["is_rework"])
    if any(v > 1 for v in per.values()):
        errs.append("같은 평가자가 같은 과제에 첫 라벨을 두 번 제출")
    first = Counter(x["task_id"] for x in b.labels if not x["is_rework"])
    if any(v > LABELS_PER_TASK for v in first.values()):
        errs.append("과제당 라벨 수 초과")
    s = summarize(b)
    if not s["zero_rate_ab_v2"] < s["zero_rate_ab_v1"]:
        errs.append("50% 노출 기간 v2 0건 비율이 v1 보다 낮지 않음")
    if not s["gold_acc_v2"] > s["gold_acc_v1"]:
        errs.append("지침 v2 정답셋 정확도가 v1 보다 높지 않음")
    if not 0.005 < s["ga_missing"] / s["search_log"] < 0.03:
        errs.append("GA 미수집 요청 비중 범위 밖")
    if not s["zero_rate_reindex_bug"] > 2 * s["zero_rate_v2_after"]:
        errs.append("재색인 회귀 기간 0건 비율이 v2 전체 적용 후 평균의 2배를 넘지 않음")
    return errs


def write_manifest(data: Path, counts: dict[str, int], seed: int, elapsed: float) -> None:
    """data/MANIFEST_search_eval.txt — 부속 원천 행 수·SHA256."""
    names = {"search_log": "search_log.ndjson.gz"}
    lines = [
        "# Placewave 검색·평가 부속 원천 MANIFEST (합성, 실제 서비스 데이터 아님)",
        f"seed: {seed}",
        f"generated_at_utc: {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')}",
        f"elapsed_sec: {elapsed:.1f}",
        "",
        "file\trows\tsha256",
    ]
    for k, n in counts.items():
        f = data / "raw" / names.get(k, f"{k}.csv")
        lines.append(f"raw/{f.name}\t{n}\t{hashlib.sha256(f.read_bytes()).hexdigest()}")
    (data / "MANIFEST_search_eval.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    """CLI 진입점."""
    ap = argparse.ArgumentParser(description="Placewave 검색·평가 부속 원천 생성기")
    ap.add_argument("--data", type=Path, default=Path("data"))
    ap.add_argument("--seed", type=int, default=20261002)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    t0 = time.time()
    raw = args.data / "raw"
    cat = Catalog.load(raw)
    searches = read_ga_searches(raw / "ga4_events.ndjson.gz")
    logger.info("GA 검색 %d건 읽음 (%.0f초)", len(searches), time.time() - t0)
    b = Builder(cat, args.seed)
    b.build_log(searches)
    logger.info("서버 로그 %d건", len(b.log))
    b.build_raters()
    b.plan_with_regression()
    b.simulate()
    errs = validate(b)
    for k, v in summarize(b).items():
        logger.info("%s = %s", k, v)
    if errs:
        for e in errs:
            logger.error("검증 실패: %s", e)
        raise SystemExit(1)
    counts = b.write(raw)
    write_manifest(args.data, counts, args.seed, time.time() - t0)
    logger.info("완료 %s (%.0f초)", counts, time.time() - t0)


if __name__ == "__main__":
    main()
