"""(검색어, 후보) 쌍의 피처.

검색어 쪽은 해석 결과(정식 이름·의도 유형), 후보 쪽은 원장 속성(장르·공간 유형·행사 유형·상권·좌표)과 인기다.
노출 순위처럼 기존 랭킹이 만든 값은 쓰지 않는다(위치 편향을 그대로 배우지 않도록).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REGIONS_FILE = ROOT / "generator" / "seed" / "names.json"  # 상권 기준 정보(이름·중심 좌표)

# (이름, 종류, 묶음, 설명). 묶음은 제거 실험(--ablate) 단위다.
FEATURES: list[tuple[str, str, str, str]] = [
    ("query_intent", "cat", "query", "검색어 의도 유형(장르·상권·행사 유형·공간명)"),
    ("query_term", "cat", "query", "해석한 정식 이름(공간명 검색은 한 값으로 묶음)"),
    ("item_type", "cat", "item", "후보 종류(공간·행사)"),
    ("item_genre", "cat", "item", "후보 장르(행사는 개최 공간 장르)"),
    ("item_venue_type", "cat", "item", "후보 공간 유형"),
    ("item_event_type", "cat", "item", "후보 행사 유형(공간은 없음)"),
    ("genre_match", "num", "match", "후보 장르 = 검색 장르"),
    ("region_match", "num", "match", "후보 상권 = 검색 상권"),
    ("region_dist_km", "num", "distance", "검색 상권 중심까지 거리(km, 상권 검색만)"),
    ("event_type_match", "num", "match", "후보 행사 유형 = 검색 행사 유형"),
    ("host_has_event_type", "num", "match", "후보 공간이 검색 행사 유형을 연 적이 있음"),
    ("name_match", "num", "match", "후보 공간명 첫 단어 = 검색 공간명(행사는 개최 공간)"),
    ("named_area_genre", "num", "match", "검색한 공간과 상권·장르가 같은 후보"),
    ("popularity_log", "num", "popularity", "학습 마감 전 신청 수 log(1+x)"),
]
NAMES = [f[0] for f in FEATURES]
CAT_IDX = [i for i, f in enumerate(FEATURES) if f[1] == "cat"]
GROUPS = sorted({f[2] for f in FEATURES})


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """두 좌표 사이 대원 거리(km)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


@dataclass
class Items:
    """후보 원장(공간·행사)과 상권 중심."""

    venues: dict[int, dict[str, object]]
    events: dict[int, dict[str, object]]
    centers: dict[str, list[tuple[float, float]]]
    hosts: set[tuple[int, str]] = field(default_factory=set)
    first_by_head: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.hosts = {(int(e["venue_id"]), str(e["event_type"])) for e in self.events.values()}
        for vid in sorted(self.venues):
            self.first_by_head.setdefault(str(self.venues[vid]["venue_name"]).split(" ")[0], vid)

    @staticmethod
    def region_centers() -> dict[str, list[tuple[float, float]]]:
        """상권 기준 정보 파일에서 상권별 중심 좌표를 읽는다."""
        names = json.loads(REGIONS_FILE.read_text(encoding="utf-8"))
        return {r["name"]: [tuple(c) for c in r["centers"]] for r in names["regions"]}


def row_features(row: dict[str, object], term: str | None, intent: str, items: Items) -> list[object]:
    """쌍 하나의 피처 값(범주형은 문자열 그대로)."""
    vid = int(row["venue_id"])
    v = items.venues[vid]
    is_event = row["item_type"] == "event"
    etype = str(items.events[int(row["item_id"])]["event_type"]) if is_event else ""
    head = str(v["venue_name"]).split(" ")[0]
    q_term = (
        term if intent in ("genre", "region", "event_type") else ("공간명" if intent == "venue_name" else "해석 못 함")
    )
    dist = math.nan
    if intent == "region" and term and term != "기타" and items.centers.get(term):
        dist = min(haversine_km(float(v["lat"]), float(v["lng"]), la, ln) for la, ln in items.centers[term])
    named = items.venues.get(items.first_by_head.get(term or "", -1)) if intent == "venue_name" else None
    return [
        intent,
        q_term,
        str(row["item_type"]),
        str(v["genre"]),
        str(v["venue_type"]),
        etype or "없음",
        float(intent == "genre" and v["genre"] == term),
        float(intent == "region" and v["region"] == term),
        dist,
        float(intent == "event_type" and etype == term),
        float(intent == "event_type" and (vid, term) in items.hosts),
        float(intent == "venue_name" and head == term),
        float(named is not None and v["region"] == named["region"] and v["genre"] == named["genre"]),
        math.log1p(float(row["popularity"])),
    ]


def encode(
    raw: list[list[object]], vocab: dict[str, list[str]] | None = None
) -> tuple[np.ndarray, dict[str, list[str]]]:
    """범주형 열을 정수 코드로 바꿔 행렬을 만든다.

    Args:
        raw: row_features 결과 목록.
        vocab: 범주형 열별 값 목록. None 이면 raw 에서 만든다(정렬해 재현 가능).

    Returns:
        (float 행렬, vocab). 모르는 값은 -1(LightGBM 은 음수 범주를 결측으로 본다).
    """
    if vocab is None:
        vocab = {NAMES[i]: sorted({str(r[i]) for r in raw}) for i in CAT_IDX}
    index = {k: {v: j for j, v in enumerate(vals)} for k, vals in vocab.items()}
    x = np.empty((len(raw), len(NAMES)), dtype=np.float64)
    for r_i, r in enumerate(raw):
        for c_i, name in enumerate(NAMES):
            val = r[c_i]
            x[r_i, c_i] = index[name].get(str(val), -1) if name in index else float(val)
    return x, vocab
