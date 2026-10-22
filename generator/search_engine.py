"""Placewave 검색 엔진 시뮬레이터 (생성기 공용).

세션 시뮬레이션(`generate.py`)이 검색할 때 부른다. 사용자가 실제로 입력하는 검색어
(정식 이름·줄임말·띄어쓰기·대소문자 변형), 랭킹 버전별 검색어 해석과 정렬, 노출 목록,
위치·관련도 기반 클릭 모델, 응답 시간을 만든다. 평가 원천 생성기(`search_eval.py`)는
같은 카탈로그와 참 관련도(`Catalog.grades`)로 평가 후보와 정답 등급을 정한다.

- v1(키워드 정확 일치): 정식 이름과 글자가 같을 때만 찾는다(대소문자 구분).
  정렬이 키워드 일치·인기 위주라 관련도와 거의 무관하다
- v2(관련성 라벨 학습 + 동의어·부분 일치): 소문자·구분자·공백을 정규화하고 동의어 사전과 공간명 앞부분 일치로 해석한다.
  라벨로 학습한 관련도로 정렬해 관련도 높은 결과가 위로 온다
- 재색인 회귀(9/1~9/4): v2 정규화에서 구분자(·) 처리가 빠져 구분자가 든 검색어를 해석하지 못한다
- 클릭 모델(캐스케이드): 위에서부터 순서대로 보고(위치별 확인 확률), 본 결과를 관련도별 확률로 누른다.
  첫 클릭에서 멈춘다
"""

from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass, field
from datetime import date

import numpy as np

TOP_N = 10
DAY0 = date(2025, 1, 1)

# 시나리오 사건. 랭킹 버전·회귀는 세션 시작 시각(KST 날짜) 기준으로 정해 세션 도중 바뀌지 않는다
RANKER_AB_START = date(2026, 7, 13)  # 새 랭킹 A/B 시작: 기기 해시 50:50
RANKER_V2_ALL = date(2026, 7, 27)  # 새 랭킹 전체 적용
REINDEX_BUG = (date(2026, 9, 1), date(2026, 9, 4))  # 가을 캠페인 대비 재색인에서 구분자(·) 정규화 누락, 9/5 핫픽스
PROMOTION_START = date(2026, 5, 4)  # 검색 결과 상단 추천 슬롯

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

# 사용자가 입력하는 검색어 변형 (정식 이름 → [(입력, 비중)]). v1 은 정식 이름만, v2 는 모두 해석한다
GENRE_TYPED = {
    "힙합": [("힙합", 0.84), ("hiphop", 0.11), ("랩", 0.05)],
    "K-pop/팝": [("K-pop/팝", 0.60), ("케이팝", 0.18), ("kpop", 0.10), ("팝", 0.08), ("아이돌", 0.04)],
    "시티팝/디스코": [("시티팝/디스코", 0.60), ("시티팝", 0.27), ("디스코", 0.09), ("city pop", 0.04)],
    "일렉트로닉": [("일렉트로닉", 0.80), ("일렉", 0.10), ("edm", 0.07), ("테크노", 0.03)],
    "재즈/소울": [("재즈/소울", 0.58), ("재즈", 0.31), ("소울", 0.07), ("jazz", 0.04)],
    "어쿠스틱": [("어쿠스틱", 0.97), ("통기타", 0.03)],
}
EVENT_TYPED = {
    "팝업 이벤트": [("팝업 이벤트", 0.68), ("팝업", 0.27), ("팝업스토어", 0.05)],
    "라이브 공연": [("라이브 공연", 0.68), ("라이브", 0.15), ("공연", 0.12), ("콘서트", 0.05)],
    "루프탑 세션": [("루프탑 세션", 0.76), ("루프탑", 0.24)],
    "쇼케이스": [("쇼케이스", 1.0)],
    "리스닝 세션": [("리스닝 세션", 0.78), ("리스닝", 0.22)],
}
REGION_CANONICAL_SHARE = 0.62  # 상권 정식 이름(구분자 포함)으로 입력하는 비중. 나머지는 한 동네 이름·띄어 쓴 이름
REGION_SPACED_SHARE = 0.10
VENUE_TYPED = (("head", 0.62), ("full", 0.10), ("lower", 0.08), ("prefix", 0.05), ("typo", 0.15))

# 클릭 모델
EXAMINE = tuple(0.95 * 0.85**k for k in range(TOP_N))  # 순위별 확인 확률
ATTRACT = {3: 0.30, 2: 0.10, 1: 0.02, 0: 0.01}  # 확인한 결과를 누를 확률 (참 관련도별)
# 정렬 점수 잡음 (참 관련도 단위). v1 은 키워드 일치·인기 위주라 관련도와 거의 무관하게 섞인다
NOISE = {"v1": 6.0, "v2": 1.4}
FLOOR = {"v1": 1, "v2": 1}  # 검색에 걸리는 최소 참 관련도
LATENCY_MEDIAN = {"v1": 110.0, "v2": 124.0}  # ms. v2 는 동의어 확장·재정렬로 조금 느리다
LATENCY_SIGMA = 0.35

_SEP = re.compile(r"[\s·/]+")


def norm(q: str) -> str:
    """v2 정규화: 소문자, 공백·구분자(·, /) 제거."""
    return _SEP.sub("", q.strip().lower())


def norm_buggy(q: str) -> str | None:
    """재색인 회귀 중 v2 정규화: 구분자(·)가 든 입력은 색인과 맞지 않아 해석 실패(None)."""
    return None if "·" in q else norm(q)


def haversine_km(lat1: np.ndarray, lng1: np.ndarray, lat2: float, lng2: float) -> np.ndarray:
    """위경도 배열과 한 점 사이 거리(km)."""
    r = 6371.0
    p1, p2 = np.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2) - np.radians(lng1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * math.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def day_no(d: date) -> int:
    """기준일(2025-01-01)부터 일 번호."""
    return (d - DAY0).days


def bucket(client_id: str) -> int:
    """기기 해시 버킷 0/1 (A/B 배정). 1 = 실험군."""
    return int(hashlib.md5(client_id.encode()).hexdigest()[:8], 16) % 2


def ranker_for(d: date, client_id: str) -> str:
    """세션 시작일·기기의 랭킹 버전."""
    if d < RANKER_AB_START:
        return "v1"
    if d < RANKER_V2_ALL:
        return "v2" if bucket(client_id) else "v1"
    return "v2"


def reindex_bug(d: date, ranker: str) -> bool:
    """세션 시작일에 재색인 회귀가 걸려 있는가 (v2 색인에서만)."""
    return ranker == "v2" and REINDEX_BUG[0] <= d <= REINDEX_BUG[1]


@dataclass
class Catalog:
    """공간·행사 원장과 검색어 → 참 관련도. 생성기는 메모리의 원장으로, 평가 생성기는 CSV 로 만든다."""

    venue_id: np.ndarray
    v_name: np.ndarray
    v_name_head: np.ndarray
    v_region: np.ndarray
    v_genre: np.ndarray
    v_type: np.ndarray
    v_lat: np.ndarray
    v_lng: np.ndarray
    v_reg_day: np.ndarray
    v_close_day: np.ndarray
    event_id: np.ndarray
    e_venue_idx: np.ndarray
    e_type: np.ndarray
    e_start_day: np.ndarray
    e_partner: np.ndarray
    genres: list[str]
    regions: dict[str, list[tuple[float, float]]]
    event_types: list[str]
    e_pub_day: np.ndarray | None = None  # 공개일 (생성기 메모리 원장에만 있다. 없으면 28일 안 시작 예정)
    vidx: dict[int, int] = field(default_factory=dict)
    eidx: dict[int, int] = field(default_factory=dict)
    cache: dict[str, tuple[np.ndarray, np.ndarray]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.vidx = {int(v): i for i, v in enumerate(self.venue_id)}
        self.eidx = {int(e): i for i, e in enumerate(self.event_id)}

    def intent(self, term: str) -> str:
        """정식 이름의 의도 유형 genre / region / event_type / venue_name."""
        if term in self.genres:
            return "genre"
        if term in self.regions:
            return "region"
        if term in self.event_types:
            return "event_type"
        return "venue_name"

    def grades(self, term: str) -> tuple[np.ndarray, np.ndarray]:
        """정식 이름에 대한 (공간 등급, 행사 등급) 0~3. 기간 무관 속성 일치로만 정한다."""
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
        """그날 보이는 공간(등록 완료·폐업 전)·행사 마스크.

        행사는 공개 후 시작 전(공개일이 없으면 28일 안 시작 예정)이고 개최 공간이 보일 때만 보인다.
        """
        k = day_no(d)
        vvis = (self.v_reg_day <= k) & (self.v_close_day > k)
        if self.e_pub_day is not None:
            evis = (self.e_pub_day <= k) & (self.e_start_day >= k)
        else:
            evis = (self.e_start_day >= k) & (self.e_start_day <= k + 28)
        return vvis, evis & vvis[self.e_venue_idx]


@dataclass
class Result:
    """검색 1건의 서버 응답과 클릭."""

    canonical: str | None
    count: int
    top: list[tuple[int, str, int, int]]  # (순위, item_type, item_id, 참 관련도)
    latency_ms: int
    click: tuple[int, str, int] | None  # (순위, item_type, item_id)


class SearchEngine:
    """검색어 입력 → 해석 → 검색·정렬 → 클릭."""

    def __init__(self, cat: Catalog, rng: np.random.Generator) -> None:
        self.cat = cat
        self.rng = rng
        heads = [str(h) for h in cat.v_name_head]
        self.head_set = set(heads)
        self.full_to_head = {str(n): str(h) for n, h in zip(cat.v_name, cat.v_name_head, strict=True)}
        self.head_to_full = {h: n for n, h in reversed(list(self.full_to_head.items()))}
        canon: dict[str, str] = {}
        for g in cat.genres:
            canon[norm(g)] = g
            for t, _ in GENRE_TYPED.get(g, []):
                canon[norm(t)] = g
        for e in cat.event_types:
            canon[norm(e)] = e
            for t, _ in EVENT_TYPED.get(e, []):
                canon[norm(t)] = e
        for r in cat.regions:
            canon[norm(r)] = r
            for part in r.split("·"):
                canon.setdefault(norm(part), r)
        for n, h in self.full_to_head.items():
            canon.setdefault(norm(n), h)
        for h in heads:
            canon.setdefault(norm(h), h)
        self.v2_dict = canon
        self.v2_heads = sorted({norm(h): h for h in heads}.items())
        self.v1_exact = (
            set(cat.genres) | set(cat.regions) | set(cat.event_types) | self.head_set | set(self.full_to_head)
        )

    # ---------- 입력 ----------

    def _pick(self, opts: list[tuple[str, float]]) -> str:
        p = np.array([w for _, w in opts])
        return opts[int(self.rng.choice(len(opts), p=p / p.sum()))][0]

    def typed(self, canonical: str) -> str:
        """정식 이름을 사용자가 실제로 입력한 검색어로 바꾼다."""
        cat, rng = self.cat, self.rng
        it = cat.intent(canonical)
        if it == "genre":
            return self._pick(GENRE_TYPED.get(canonical, [(canonical, 1.0)]))
        if it == "event_type":
            return self._pick(EVENT_TYPED.get(canonical, [(canonical, 1.0)]))
        if it == "region":
            parts = canonical.split("·")
            if len(parts) == 1:
                return canonical
            u = rng.random()
            if u < REGION_CANONICAL_SHARE:
                return canonical
            if u < REGION_CANONICAL_SHARE + REGION_SPACED_SHARE:
                return " ".join(parts)
            w = np.array([0.6, 0.25, 0.15][: len(parts)])
            return parts[int(rng.choice(len(parts), p=w / w.sum()))]
        kind = self._pick([(k, w) for k, w in VENUE_TYPED])
        head = canonical
        full = self.head_to_full.get(head, head)
        latin = head[:1].isascii() and head[:1].isalpha()
        if kind == "full":
            return full
        if kind == "lower":
            return head.lower() if latin else head
        if kind == "prefix":
            return head[:4].lower() if latin else head[:2]
        if kind == "typo" and len(head) >= 3:
            i = int(rng.integers(1, len(head) - 1))
            return head[:i] + head[i + 1 :]
        return head

    # ---------- 해석·검색 ----------

    def resolve(self, q: str, ranker: str, bug: bool = False) -> str | None:
        """입력 검색어 → 정식 이름. 해석 못 하면 None(결과 0건)."""
        if ranker == "v1":
            if q not in self.v1_exact:
                return None
            return self.full_to_head.get(q, q)
        k = norm_buggy(q) if bug else norm(q)
        if not k:
            return None
        if k in self.v2_dict:
            return self.v2_dict[k]
        if len(k) >= 2:
            for nk, h in self.v2_heads:
                if nk.startswith(k):
                    return h
        return None

    def intent_of(self, q: str) -> str:
        """검색어 분류기(랭킹과 별개): 동의어 사전으로 해석한 의도 유형. 해석 못 하면 other."""
        canonical = self.resolve(q, "v2")
        return self.cat.intent(canonical) if canonical else "other"

    def search(
        self, q: str, d: date, ranker: str, bug: bool = False
    ) -> tuple[str | None, int, list[tuple[int, str, int, int]]]:
        """결과 수와 상위 10 [(순위, item_type, item_id, 참 관련도)]. 해석 실패면 0건."""
        canonical = self.resolve(q, ranker, bug)
        if canonical is None:
            return None, 0, []
        cat, rng = self.cat, self.rng
        vg, eg = cat.grades(canonical)
        vvis, evis = cat.visible(d)
        floor = FLOOR[ranker]
        vi = np.flatnonzero(vvis & (vg >= floor))
        ei = np.flatnonzero(evis & (eg >= floor))
        if not len(vi) and not len(ei):
            return canonical, 0, []
        noise = NOISE[ranker]
        score = np.concatenate([vg[vi] + rng.normal(0, noise, len(vi)), eg[ei] - 0.2 + rng.normal(0, noise, len(ei))])
        order = np.argsort(-score)[:TOP_N]
        top = []
        for pos, k in enumerate(order, 1):
            if k < len(vi):
                top.append((pos, "venue", int(cat.venue_id[vi[k]]), int(vg[vi[k]])))
            else:
                j = ei[k - len(vi)]
                top.append((pos, "event", int(cat.event_id[j]), int(eg[j])))
        return canonical, len(vi) + len(ei), top

    def click(self, top: list[tuple[int, str, int, int]]) -> tuple[int, str, int] | None:
        """캐스케이드 클릭: 위에서부터 확인하고, 확인한 결과를 관련도별 확률로 누른다."""
        rng = self.rng
        for pos, t, i, g in top:
            if rng.random() >= EXAMINE[pos - 1]:
                return None
            if rng.random() < ATTRACT[g]:
                return pos, t, i
        return None

    def promoted(self, canonical: str | None, d: date) -> int | None:
        """상단 추천 슬롯 행사 (파트너 공간 예정 행사). 결과가 있을 때만 부른다."""
        rng, cat = self.rng, self.cat
        if d < PROMOTION_START or rng.random() > 0.6:
            return None
        _, evis = cat.visible(d)
        pool = np.flatnonzero(evis & cat.e_partner)
        if not len(pool):
            return None
        good = pool[cat.grades(canonical)[1][pool] >= 1] if canonical else pool[:0]
        pick = good if len(good) and rng.random() < 0.5 else pool
        return int(cat.event_id[pick[int(rng.integers(len(pick)))]])

    def latency(self, ranker: str) -> int:
        """응답 시간(ms)."""
        return int(self.rng.lognormal(math.log(LATENCY_MEDIAN[ranker]), LATENCY_SIGMA))

    def run(self, q: str, d: date, ranker: str, bug: bool = False) -> Result:
        """검색 1건: 해석 → 검색·정렬 → 응답 시간 → 클릭."""
        canonical, count, top = self.search(q, d, ranker, bug)
        lat = self.latency(ranker)
        return Result(canonical, count, top, lat, self.click(top) if top else None)
