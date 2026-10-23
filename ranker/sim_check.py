"""A/B 시뮬레이션의 랭킹 수준과 학습 모델 비교(README 근거용).

데이터 생성기(generator/search_engine.py)는 A/B 의 기존·새 랭킹을 '참 관련도 + 정렬 잡음'으로 흉내 낸다
(기존 σ 6.0, 새 σ 1.4). 같은 후보·같은 라벨에서 그 정렬의 NDCG@10 을 재서, ranker/train.py 가 학습한 모델의
교차 검증 NDCG@10(model_card.json)과 나란히 놓는다. 입력은 train.py 가 남긴 data/model/input_pairs.csv.

    uv run --group ml python -m ranker.sim_check
"""

from __future__ import annotations

import csv
import json
import logging
import sys
from collections import defaultdict

import numpy as np

from ranker.train import ART, NAMES_FILE, OUT, ROOT, ndcg

sys.path.insert(0, str(ROOT / "generator"))
from search_engine import NOISE  # noqa: E402
from search_eval import load_catalog  # noqa: E402

logger = logging.getLogger("placewave.ranker.sim")
DRAWS = 200


def main() -> None:
    """시뮬레이터 랭킹(잡음 draw 평균)과 모델의 NDCG@10 을 출력한다."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cat = load_catalog(ROOT / "data" / "raw")
    names = json.loads(NAMES_FILE.read_text(encoding="utf-8"))
    with open(OUT / "input_pairs.csv", encoding="utf-8") as f:
        pairs = list(csv.DictReader(f))
    by_q: dict[str, list[dict]] = defaultdict(list)
    for r in pairs:
        by_q[r["query_norm"]].append(r)
    canon = {t.lower(): t for t in [*names["genres"], *names["event_types"], *(r["name"] for r in names["regions"])]}
    heads = {str(h).lower(): str(h) for h in cat.v_name_head}
    rng = np.random.default_rng(20260713)
    res: dict[str, list[float]] = defaultdict(list)
    for q, rows in by_q.items():
        labels = [int(r["label"]) for r in rows]
        if max(labels) == 0:
            continue
        term = canon.get(q) or heads.get(q)
        vg, eg = cat.grades(term)
        truth = np.array(
            [
                int(vg[cat.vidx[int(r["item_id"])]] if r["item_type"] == "venue" else eg[cat.eidx[int(r["item_id"])]])
                for r in rows
            ]
        )
        for ranker, sigma in NOISE.items():
            vals = []
            for _ in range(DRAWS):
                order = np.argsort(-(truth + rng.normal(0, sigma, len(rows))))
                vals.append(ndcg([labels[i] for i in order], labels))
            res[ranker].append(float(np.mean(vals)))
    card = json.loads((ART / "model_card.json").read_text(encoding="utf-8"))
    logger.info("검색어 %d개 · NDCG@10", len(res["v1"]))
    for ranker, sigma in NOISE.items():
        logger.info("  시뮬레이터 %s (참 관련도 + 잡음 σ %.1f): %.4f", ranker, sigma, float(np.mean(res[ranker])))
    logger.info("  기존 정렬 재현(인기순): %.4f", card["metrics_cv"]["popularity"]["all"])
    logger.info("  학습 모델(교차 검증): %.4f", card["metrics_cv"]["model"]["all"])


if __name__ == "__main__":
    main()
