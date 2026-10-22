"""dashboard/public/metrics.json → docs/metrics.md 생성기.

지표 정의의 원본은 metrics.json 하나다(대시보드 지표 가이드 페이지와 타일 `?` 툴팁이 같은 파일을 읽는다).
이 스크립트는 그 JSON 을 사람이 읽는 문서로 옮길 뿐이며, docs/metrics.md 를 직접 고치지 않는다.

    uv run dashboard/scripts/build_metrics_doc.py
    uv run dashboard/scripts/build_metrics_doc.py --check   # 생성물과 다르면 exit 1
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "dashboard" / "public" / "metrics.json"
OUT = ROOT / "docs" / "metrics.md"


def cell(v: str) -> str:
    """표 칸에 넣을 수 있게 줄바꿈·파이프를 정리한다."""
    return v.replace("|", "\\|").replace("\n", " ")


def render(spec: dict) -> str:
    """metrics.json 사전을 마크다운 문서로 만든다.

    Args:
        spec: {rules, groups, axes, notes, tabs, metrics} 사전.

    Returns:
        docs/metrics.md 본문.
    """
    tab_name = {t["id"]: t["name"] for t in spec["tabs"]}
    metric_name = {m["id"]: m["name"] for m in spec["metrics"]}
    axis_name = {a["id"]: a["name"] for a in spec.get("axes", [])}
    lines = [
        "# 지표 정의",
        "",
        "> 생성물 — 원본은 `dashboard/public/metrics.json`, 생성 `uv run dashboard/scripts/build_metrics_doc.py`."
        " 이 파일을 직접 고치지 않는다.",
        "",
        "마트 열 기준 정의. 비율은 마트에 저장하지 않고 분자·분모 열을 화면에서 나눈다"
        "(예외: 화면 계약상 `monthly_summary.w1_retention`). 산식의 원본은 `bigquery/sql/` 의 마트 생성 SQL 이며,"
        " 이 문서는 그 열을 가리킨다. 대시보드의 `지표 가이드` 페이지와 타일 이름 옆 `?` 가 같은 원본을 보여준다.",
        "",
        f"지표 {len(spec['metrics'])}개 · 탭 {sum(not t.get('report') for t in spec['tabs'])}개.",
        "",
        "수익 축: "
        + " · ".join(
            f"{a['name']} {sum(1 for m in spec['metrics'] if m.get('axis') == a['id'])}" for a in spec.get("axes", [])
        )
        + ". 축은 지표가 어느 수익 갈래(마켓플레이스 거래 · 소비자 구독 · 공간 B2B)의 건강을 재는지를 뜻하며,"
        " 공통은 플랫폼 매출 전체다.",
        "",
        "## 탭이 답하는 질문",
        "",
        "| 탭 | 질문 | 주 사용자 | 핵심 지표 |",
        "|---|---|---|---|",
    ]
    for t in spec["tabs"]:
        keys = " · ".join(f"{k} {metric_name[k]}" for k in t["key_metrics"])
        lines.append(f"| {t['name']} | {cell(t['question'])} | {' · '.join(t['users'])} | {keys} |")
    lines += ["", "## 공통 규칙", ""]
    lines += [f"- {r}" for r in spec["rules"]]
    for g in spec["groups"]:
        ms = [m for m in spec["metrics"] if m["group"] == g["id"]]
        if not ms:
            continue
        lines += [
            "",
            f"## {g['name']}",
            "",
            "| 코드 | 이름 | 탭 | 축 | 단위 | 정의 | 산식 | 분모 | 마트 열 | 의의 |",
            "|---|---|---|---|---|---|---|---|---|---|",
        ]
        for m in ms:
            cols = ", ".join(f"`{c}`" for c in m["mart_columns"])
            lines.append(
                f"| {m['id']} | {cell(m['name'])} | {tab_name.get(m['tab'], m['tab'])} | "
                f"{axis_name.get(m.get('axis', ''), '—')} | {m['unit']} | "
                f"{cell(m['definition'])} | {cell(m['formula'])} | {cell(m['denominator'])} | {cols} | "
                f"{cell(m['why'])} |"
            )
        for n in spec.get("notes", {}).get(g["id"], []):
            lines += ["", n]
    return "\n".join(lines) + "\n"


def main() -> None:
    """metrics.json 을 읽어 docs/metrics.md 를 쓴다(--check 면 비교만)."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="생성물과 현재 파일이 다르면 exit 1")
    a = ap.parse_args()
    spec = json.loads(SRC.read_text(encoding="utf-8"))
    ids = [m["id"] for m in spec["metrics"]]
    if len(ids) != len(set(ids)):
        raise SystemExit("metrics.json 에 중복 id")
    body = render(spec)
    if a.check:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == body
        print("일치" if same else "불일치 — build_metrics_doc.py 를 다시 실행")
        sys.exit(0 if same else 1)
    OUT.write_text(body, encoding="utf-8")
    print(f"{OUT} 지표 {len(ids)}개")


if __name__ == "__main__":
    main()
