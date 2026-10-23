"""Placewave 순위 모델(LightGBM LambdaRank) 학습 · 오프라인 평가 · 산출물 내보내기.

입력(BigQuery SELECT, scripts/bq.sh): staging.ml_ranker_pairs · dim_venue · dim_event · int_search
출력:
    data/model/ml_query_parse.csv       → raw.ml_query_parse     검색어별 해석 결과(정식 이름·의도 유형·v1 일치)
    data/model/ml_ranker_scores.csv     → raw.ml_ranker_scores   (검색어, 후보) 교차 검증 묶음 밖 점수
    data/model/ml_ranker_features.csv   → raw.ml_ranker_features 피처 중요도
    ranker/artifacts/model.txt          LightGBM 모델(텍스트, 검색어 전체로 다시 맞춘 최종본)
    ranker/artifacts/model_card.json    데이터·피처·하이퍼파라미터·오프라인 평가·제거 실험 요약
raw 표 적재는 bigquery/load_all.sh 1단계가 한다(이 스크립트는 파일만 쓴다).

실행(레포 루트):
    uv run --group ml python -m ranker.train              BigQuery 에서 읽어 학습·내보내기
    uv run --group ml python -m ranker.train --cache      지난번 받은 입력(data/model/input_*.csv)으로
    uv run --group ml python -m ranker.train --ablate popularity
                                                          피처 묶음 하나를 빼고 교차 검증 NDCG@10 만 비교(산출물 안 씀)
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import math
import subprocess
from collections import defaultdict
from pathlib import Path

import lightgbm as lgb
import numpy as np

from ranker.features import CAT_IDX, FEATURES, GROUPS, NAMES, Items, encode, row_features
from ranker.query import QueryParser

logger = logging.getLogger("placewave.ranker")

ROOT = Path(__file__).resolve().parents[1]
BQ = ROOT / "scripts" / "bq.sh"
OUT = ROOT / "data" / "model"
ART = Path(__file__).resolve().parent / "artifacts"
NAMES_FILE = ROOT / "generator" / "seed" / "names.json"  # 장르·행사 유형·상권 기준 정보
CUTOFF = "2026-07-06"
VERSION = f"ltr-{CUTOFF}"
K = 10
SEED = 20260706
PARAMS: dict[str, object] = {
    "objective": "lambdarank",
    "metric": "ndcg",
    "eval_at": [K],
    "learning_rate": 0.05,
    "num_leaves": 15,
    "min_data_in_leaf": 20,
    "feature_fraction": 0.9,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "seed": SEED,
    "deterministic": True,
    "force_row_wise": True,
    "num_threads": 1,
    "verbose": -1,
}
ROUNDS = 200  # 반복 수 고정. 조기 종료는 묶음당 검증 검색어가 적어(관련 후보 있는 검색어 약 25개) 흔들렸다
ROUNDS_CHECK = (100, 200, 400)  # 반복 수 민감도(모델 카드에 남긴다)
FOLDS = 5
METHODS = ("popularity", "model")  # 기존 정렬(키워드 일치 뒤 인기순) · 순위 모델

QUERIES = {
    "pairs": """SELECT query_norm, item_type, item_id, venue_id, label, n_labels, fold, popularity
                FROM staging.ml_ranker_pairs ORDER BY query_norm, item_type, item_id""",
    "venues": """SELECT venue_id, venue_name, region, genre, venue_type, lat, lng
                 FROM staging.dim_venue ORDER BY venue_id""",
    "events": """SELECT event_id, venue_id, event_type FROM staging.dim_event ORDER BY event_id""",
    "searches": """SELECT query_norm, MIN(query_intent) AS query_intent, COUNT(DISTINCT query_intent) AS n
                   FROM staging.int_search
                   WHERE kst_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'
                   GROUP BY 1 ORDER BY 1""",
}


def bq_rows(sql: str) -> list[dict[str, str]]:
    """scripts/bq.sh 로 SELECT 를 실행해 CSV 행을 돌려준다.

    Args:
        sql: 표준 SQL SELECT.

    Returns:
        열 이름 → 문자열 값 사전 목록.
    """
    res = subprocess.run(
        [str(BQ), "query", "--quiet", "--format=csv", "--max_rows=1000000", "--maximum_bytes_billed=2000000000", sql],
        check=True,
        capture_output=True,
        text=True,
    )
    return list(csv.DictReader(res.stdout.splitlines()))


def load_inputs(cache: bool) -> dict[str, list[dict[str, str]]]:
    """입력 네 개를 BigQuery(또는 지난번 받은 CSV)에서 읽는다."""
    OUT.mkdir(parents=True, exist_ok=True)
    data: dict[str, list[dict[str, str]]] = {}
    for name, sql in QUERIES.items():
        path = OUT / f"input_{name}.csv"
        if cache and path.exists():
            with open(path, encoding="utf-8") as f:
                data[name] = list(csv.DictReader(f))
        else:
            data[name] = bq_rows(sql)
            with open(path, "w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(data[name][0]))
                w.writeheader()
                w.writerows(data[name])
        logger.info("입력 %-8s %7d행", name, len(data[name]))
    return data


def dcg(labels: list[int]) -> float:
    """상위 K 의 DCG. 이득 2^등급 − 1, 순위 할인 log2(순위 + 1)."""
    return sum((2**g - 1) / math.log2(i + 2) for i, g in enumerate(labels[:K]))


def ndcg(order: list[int] | None, labels: list[int]) -> float | None:
    """한 검색어의 NDCG@K.

    Args:
        order: 보여 준 순서의 등급(결과 없음이면 None → 0).
        labels: 그 검색어 후보 전체의 등급.

    Returns:
        NDCG. 이상적 DCG 가 0(관련 후보 없음)이면 None 이고 평균에서 뺀다.
    """
    ideal = dcg(sorted(labels, reverse=True))
    if ideal == 0:
        return None
    return dcg(order) / ideal if order else 0.0


def rankings(rows: list[dict], score: dict[int, float]) -> dict[str, dict[int, int | None]]:
    """방식별 순위(1부터). 결과가 없는 방식은 None.

    popularity = 기존 정렬(정식 이름과 같을 때만 결과, 인기순), model = 새 해석으로 결과가 있으면 모델 점수순.
    동점은 (item_type, item_id) 오름차순. marts.ranker_eval 과 같은 규칙이다.
    """
    out: dict[str, dict[int, int | None]] = {m: {} for m in METHODS}
    by_q: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        by_q[r["query_norm"]].append(i)
    for idx in by_q.values():
        head = rows[idx[0]]
        pop = sorted(idx, key=lambda i: (-int(rows[i]["popularity"]), rows[i]["item_type"], int(rows[i]["item_id"])))
        mod = sorted(idx, key=lambda i: (-score.get(i, -math.inf), rows[i]["item_type"], int(rows[i]["item_id"])))
        for name, order, ok in (("popularity", pop, head["v1_match"]), ("model", mod, head["query_intent"] != "other")):
            for rank, i in enumerate(order, 1):
                out[name][i] = rank if ok else None
    return out


def evaluate(rows: list[dict], ranks: dict[str, dict[int, int | None]]) -> dict[str, object]:
    """방식별 평균 NDCG@K(전체·의도 유형별), 검색어 수, 묶음별 평균의 표준편차.

    관련 후보가 하나도 없는 검색어(이상적 DCG 0)는 뺀다.
    """
    by_q: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        by_q[r["query_norm"]].append(i)
    res: dict[str, object] = {"queries": len(by_q)}
    for name, rk in ranks.items():
        vals: dict[str, list[float]] = defaultdict(list)
        per_fold: dict[int, list[float]] = defaultdict(list)
        for idx in by_q.values():
            labels = [int(rows[i]["label"]) for i in idx]
            shown = sorted((i for i in idx if rk[i] is not None), key=lambda i: rk[i])
            v = ndcg([int(rows[i]["label"]) for i in shown] or None, labels)
            if v is None:
                continue
            vals["all"].append(v)
            vals[rows[idx[0]]["query_intent"]].append(v)
            per_fold[int(rows[idx[0]]["fold"])].append(v)
        res[name] = {k: round(float(np.mean(v)), 4) for k, v in sorted(vals.items())}
        res[f"{name}_n"] = {k: len(v) for k, v in sorted(vals.items())}
        res[f"{name}_fold_sd"] = round(float(np.std([np.mean(v) for v in per_fold.values()])), 4)
    return res


def dataset(x: np.ndarray, rows: list[dict], idx: list[int], keep: list[int]) -> lgb.Dataset:
    """검색어별로 이어진 행 묶음(group)으로 LightGBM 데이터셋을 만든다."""
    groups: list[int] = []
    last = None
    for i in idx:
        if rows[i]["query_norm"] != last:
            groups.append(0)
            last = rows[i]["query_norm"]
        groups[-1] += 1
    cats = [keep.index(c) for c in CAT_IDX if c in keep]
    return lgb.Dataset(
        x[np.ix_(idx, keep)],
        label=[int(rows[i]["label"]) for i in idx],
        group=groups,
        feature_name=[NAMES[c] for c in keep],
        categorical_feature=cats,
        free_raw_data=False,
    )


def fit(x: np.ndarray, rows: list[dict], keep: list[int], train: list[int], rounds: int = ROUNDS) -> lgb.Booster:
    """학습 행으로 LightGBM LambdaRank 를 반복 rounds 회 학습한다."""
    return lgb.train(PARAMS, dataset(x, rows, train, keep), num_boost_round=rounds)


def resolved(rows: list[dict], fold: int | None = None) -> list[int]:
    """해석된 검색어의 행(fold 를 주면 그 묶음만). 해석 못 한 검색어는 결과가 없어 학습·채점하지 않는다."""
    return [i for i, r in enumerate(rows) if r["query_intent"] != "other" and (fold is None or int(r["fold"]) == fold)]


def cross_scores(x: np.ndarray, rows: list[dict], keep: list[int], rounds: int = ROUNDS) -> dict[int, float]:
    """5묶음 교차 검증: 한 묶음을 빼고 학습한 모델이 그 묶음을 채점한다(묶음 밖 점수)."""
    score: dict[int, float] = {}
    for f in range(FOLDS):
        model = fit(x, rows, keep, [i for i in resolved(rows) if int(rows[i]["fold"]) != f], rounds)
        idx = resolved(rows, f)
        # 내보내는 값(소수 6자리)으로 평가해 마트 순위와 동점 처리가 같게 한다
        score.update(zip(idx, (round(float(p), 6) for p in model.predict(x[np.ix_(idx, keep)])), strict=True))
    return score


def prepare(
    data: dict[str, list[dict[str, str]]],
) -> tuple[list[dict], np.ndarray, dict, list[dict], dict[str, int]]:
    """해석·피처를 붙인 학습 쌍, 피처 행렬, 범주 사전, 검색어 해석 표, 의도 대조 결과."""
    venues = {int(v["venue_id"]): v for v in data["venues"]}
    events = {int(e["event_id"]): e for e in data["events"]}
    items = Items(venues, events, Items.region_centers())
    names = json.loads(NAMES_FILE.read_text(encoding="utf-8"))
    unknown = {v["genre"] for v in data["venues"]} - set(names["genres"])
    if unknown:
        raise SystemExit(f"원장 장르가 기준 정보에 없음: {sorted(unknown)}")
    parser = QueryParser.load(
        list(names["genres"]),
        list(names["event_types"]),
        [r["name"] for r in names["regions"]],
        [v["venue_name"] for v in data["venues"]],
    )

    queries = sorted({r["query_norm"] for r in data["searches"]} | {r["query_norm"] for r in data["pairs"]})
    parse: dict[str, dict] = {}
    for q in queries:
        term, intent = parser.resolve(q)
        parse[q] = {"query_norm": q, "query_term": term, "query_intent": intent, "v1_match": parser.exact(q)}
    logged = {r["query_norm"]: r["query_intent"] for r in data["searches"]}
    multi = [r["query_norm"] for r in data["searches"] if r["n"] != "1"]
    bad = sorted(q for q, it in logged.items() if parse[q]["query_intent"] != it)
    check = {"search_log_queries": len(logged), "mismatch": len(bad), "multi_intent": len(multi)}
    if bad or multi:
        raise SystemExit(f"검색어 해석이 검색 로그 의도 분류와 다름: {bad[:10]} · 의도 여러 개 {multi[:10]}")

    rows: list[dict] = []
    raw: list[list[object]] = []
    for r in data["pairs"]:
        p = parse[r["query_norm"]]
        row = {**r, **p}
        rows.append(row)
        raw.append(row_features(row, p["query_term"], p["query_intent"], items))
    x, vocab = encode(raw)
    return rows, x, vocab, [parse[q] for q in queries], check


def write_csv(name: str, head: list[str], body: list[list[object]]) -> None:
    """data/model/<name> 에 CSV 를 쓴다."""
    with open(OUT / name, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(head)
        w.writerows(body)


def write_outputs(rows: list[dict], parse: list[dict], score: dict[int, float], model: lgb.Booster, card: dict) -> None:
    """검색어 해석·채점·피처 중요도 CSV 와 모델·모델 카드를 쓴다."""
    write_csv(
        "ml_query_parse.csv",
        ["query_norm", "query_term", "query_intent", "v1_match", "parser_version"],
        [
            [p["query_norm"], p["query_term"] or "", p["query_intent"], str(p["v1_match"]).lower(), VERSION]
            for p in parse
        ],
    )
    write_csv(
        "ml_ranker_scores.csv",
        ["query_norm", "item_type", "item_id", "model_score", "model_version"],
        [
            [r["query_norm"], r["item_type"], r["item_id"], f"{score[i]:.6f}", VERSION]
            for i, r in enumerate(rows)
            if i in score
        ],
    )
    gain = model.feature_importance("gain")
    splits = model.feature_importance("split")
    total = float(gain.sum()) or 1.0
    group = {n: g for n, _, g, _ in FEATURES}
    write_csv(
        "ml_ranker_features.csv",
        ["model_version", "feature", "feature_group", "gain", "gain_share", "splits"],
        [
            [VERSION, n, group[n], f"{g:.4f}", f"{g / total:.6f}", int(s)]
            for n, g, s in zip(model.feature_name(), gain, splits, strict=True)
        ],
    )
    ART.mkdir(parents=True, exist_ok=True)
    model.save_model(str(ART / "model.txt"))
    (ART / "model_card.json").write_text(json.dumps(card, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    """입력을 읽어 학습·평가하고 산출물을 쓴다(--ablate 면 비교만)."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cache", action="store_true", help="data/model/input_*.csv 가 있으면 BigQuery 대신 읽는다")
    ap.add_argument("--ablate", choices=GROUPS, help="이 피처 묶음을 빼고 학습해 교차 검증 NDCG@10 만 비교")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    rows, x, vocab, parse, check = prepare(load_inputs(a.cache))
    full = list(range(len(NAMES)))
    score = cross_scores(x, rows, full)
    metrics = evaluate(rows, rankings(rows, score))
    logger.info(
        "교차 검증 검색어 %d(관련 후보 있음 %d) · NDCG@%d 기존 정렬 %.4f · 순위 모델 %.4f (묶음 간 표준편차 %.4f)",
        metrics["queries"],
        metrics["model_n"]["all"],
        K,
        metrics["popularity"]["all"],
        metrics["model"]["all"],
        metrics["model_fold_sd"],
    )

    ablations: dict[str, float] = {}
    for g in [a.ablate] if a.ablate else GROUPS:
        keep = [i for i, f in enumerate(FEATURES) if f[2] != g]
        ab = evaluate(rows, rankings(rows, cross_scores(x, rows, keep)))["model"]["all"]
        ablations[g] = round(float(ab), 4)
        logger.info("제거 %-10s NDCG@%d %.4f (전체 피처 대비 %+.4f)", g, K, ab, ab - metrics["model"]["all"])
    if a.ablate:
        return

    rounds_check = {
        r: evaluate(rows, rankings(rows, cross_scores(x, rows, full, r)))["model"]["all"] for r in ROUNDS_CHECK
    }
    logger.info("반복 수 민감도 %s", rounds_check)
    model = fit(x, rows, full, resolved(rows))
    every = resolved(rows)
    in_sample = evaluate(rows, rankings(rows, dict(zip(every, map(float, model.predict(x[every])), strict=True))))
    card = {
        "model_version": VERSION,
        "framework": f"LightGBM {lgb.__version__} (lambdarank)",
        "label_cutoff": CUTOFF,
        "data": {
            "pairs": len(rows),
            "labels": sum(int(r["n_labels"]) for r in rows),
            "queries": metrics["queries"],
            "queries_with_relevant": metrics["model_n"]["all"],
            "folds": FOLDS,
        },
        "features": [{"name": n, "kind": k, "group": g, "desc": d} for n, k, g, d in FEATURES],
        "categories": vocab,
        "params": PARAMS,
        "rounds": ROUNDS,
        "rounds_check_cv_ndcg": rounds_check,
        "metrics_cv": metrics,
        "metrics_in_sample_final": {m: in_sample[m] for m in METHODS},
        "ablation_cv_ndcg": ablations,
        "intent_check": check,
    }
    write_outputs(rows, parse, score, model, card)
    logger.info("검색어 해석 %d개 · 산출물 %s · %s", len(parse), OUT.relative_to(ROOT), ART.relative_to(ROOT))


if __name__ == "__main__":
    main()
