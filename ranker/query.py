"""검색어 해석: 정규화 → 동의어 사전 → 공간명 앞부분 일치.

해석 결과는 정식 이름(장르·상권·행사 유형·공간명 첫 단어)과 의도 유형이다. 해석하지 못하면 결과 0건이다.
기존 랭킹(v1)은 정식 이름과 글자가 같을 때만 찾는다(`QueryParser.exact`).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

SYNONYMS = Path(__file__).resolve().parent / "synonyms.json"
_SEP = re.compile(r"[\s·/]+")
MIN_PREFIX = 2


def normalize(q: str) -> str:
    """소문자로 바꾸고 공백·구분자(·, /)를 지운다.

    Args:
        q: 사용자가 입력한 검색어.

    Returns:
        해석 키. 예: '홍대 합정 연남' → '홍대합정연남'.
    """
    return _SEP.sub("", q.strip().lower())


@dataclass
class QueryParser:
    """정식 이름 사전과 공간명 첫 단어 목록으로 검색어를 해석한다."""

    genres: list[str]
    event_types: list[str]
    regions: list[str]
    venue_names: list[str]
    synonyms: dict[str, dict[str, list[str]]]
    canon: dict[str, str] = field(default_factory=dict)
    heads: list[tuple[str, str]] = field(default_factory=list)
    v1_exact: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        canon: dict[str, str] = {}
        for g in self.genres:
            canon[normalize(g)] = g
            for t in self.synonyms["genre"].get(g, []):
                canon[normalize(t)] = g
        for e in self.event_types:
            canon[normalize(e)] = e
            for t in self.synonyms["event_type"].get(e, []):
                canon[normalize(t)] = e
        for r in self.regions:
            canon[normalize(r)] = r
            for part in r.split("·"):
                canon.setdefault(normalize(part), r)
        heads_all = [n.split(" ")[0] for n in self.venue_names]
        for full, head in zip(self.venue_names, heads_all, strict=True):
            canon.setdefault(normalize(full), head)
        for h in heads_all:
            canon.setdefault(normalize(h), h)
        heads = list(dict.fromkeys(heads_all))
        self.canon = canon
        self.heads = sorted({normalize(h): h for h in heads_all}.items())
        exact = set(self.genres) | set(self.regions) | set(self.event_types) | set(heads) | set(self.venue_names)
        self.v1_exact = {x.lower() for x in exact}

    @classmethod
    def load(cls, genres: list[str], event_types: list[str], regions: list[str], venue_names: list[str]) -> QueryParser:
        """동의어 사전 파일(synonyms.json)을 읽어 만든다."""
        syn = json.loads(SYNONYMS.read_text(encoding="utf-8"))
        return cls(genres, event_types, regions, venue_names, {k: v for k, v in syn.items() if not k.startswith("_")})

    def intent(self, term: str) -> str:
        """정식 이름의 의도 유형 genre / region / event_type / venue_name."""
        if term in self.genres:
            return "genre"
        if term in self.regions:
            return "region"
        if term in self.event_types:
            return "event_type"
        return "venue_name"

    def resolve(self, q: str) -> tuple[str | None, str]:
        """검색어 → (정식 이름, 의도 유형). 해석하지 못하면 (None, 'other').

        Args:
            q: 정규화 전후 어느 쪽이든 된다.

        Returns:
            정식 이름과 의도 유형.
        """
        k = normalize(q)
        if not k:
            return None, "other"
        if k in self.canon:
            term = self.canon[k]
            return term, self.intent(term)
        if len(k) >= MIN_PREFIX:
            for nk, h in self.heads:
                if nk.startswith(k):
                    return h, "venue_name"
        return None, "other"

    def exact(self, query_norm: str) -> bool:
        """기존 랭킹(v1) 기준: 정식 이름과 글자가 같은가(대소문자만 무시)."""
        return query_norm.strip().lower() in self.v1_exact
