"""SQL 머리 주석을 읽어 bigquery/README.md(표 카탈로그)를 만든다.

    python3 bigquery/build_catalog.py            머리 주석 검사 + BigQuery 실물 대조 + 마지막 실행 요약
    python3 bigquery/build_catalog.py --offline  BigQuery 조회 없이 (실물 대조·실행 요약 생략)
    python3 bigquery/build_catalog.py --export dashboard/public/catalog.json
                                                 위에 더해 데이터 페이지용 표·컬럼 카탈로그 JSON 을 쓴다

머리 주석이 틀에 맞지 않거나 SQL 본문·실물과 어긋나면 README 를 쓰지 않고 exit 1.
BigQuery 조회는 scripts/bq.sh 래퍼로 SELECT 만 한다.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BQ_DIR = ROOT / "bigquery"
BQ = ROOT / "scripts" / "bq.sh"
LOAD_ALL = BQ_DIR / "load_all.sh"
CHECKS = BQ_DIR / "checks" / "reconciliation.sql"
RAW_HEADERS = BQ_DIR / "schema" / "raw_tables.sql"
README = BQ_DIR / "README.md"

LAYERS = ["raw", "staging", "marts", "ops"]
LAYER_TITLE = {
    "raw": "raw — 원천 적재",
    "staging": "staging — 정제·중간·차원",
    "marts": "marts — 화면용 지표·리스트",
    "ops": "ops — 실행 기록·검사·신선도",
}
FIELDS = ["표", "1행", "키", "파티션·클러스터", "원천", "소비", "검사"]
REQUIRED = FIELDS[:6]
TOKEN = re.compile(r"\b(raw|staging|marts|ops)\.([a-z][a-z0-9_]*(?:·[a-z][a-z0-9_]*)*)")
CHECK_ID = re.compile(r"^[CRI]\d+[a-z]?$")
# README 검사 표의 목적별 묶음(ID 는 추가된 순서라 그대로 둔다). 판정은 종류로 정한다: 대조·무결성 = 차단, 범위 = 경보.
CHECK_GROUPS: list[tuple[str, list[str]]] = [
    (
        "원천 정합: 원장과 로그·마트가 같은가",
        ["C1a", "C1b", "C2", "C12a", "C12b", "C9", "C14", "C10", "C11", "C13", "C15"],
    ),
    (
        "층 보존: 층을 지나며 빠지거나 겹친 행이 없는가",
        ["C3", "C4", "C5", "C6", "C7", "C8", "C16", "C17", "C21", "C18", "C19", "C22", "C23"],
    ),
    ("무결성: 규칙을 어긴 행이 0인가", ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "I9", "I10", "I11", "C20"]),
    ("지표 범위: 지표가 상식 범위 안인가", ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R12"]),
]
KEY_COUNT = {"두": 2, "세": 3, "네": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9}


@dataclass
class Table:
    """머리 주석 한 블록 = 표 하나."""

    name: str
    desc: str
    file: Path
    fields: dict[str, str] = field(default_factory=dict)

    @property
    def layer(self) -> str:
        return self.name.split(".")[0]

    @property
    def short(self) -> str:
        return self.name.split(".")[1]

    @property
    def rel(self) -> str:
        return self.file.relative_to(BQ_DIR).as_posix()


def tokens(text: str) -> set[str]:
    """'staging.a·b, marts.c' 형태를 {'staging.a', 'staging.b', 'marts.c'} 로 푼다."""
    out: set[str] = set()
    for layer, names in TOKEN.findall(text):
        out.update(f"{layer}.{n}" for n in names.split("·"))
    return out


def parse_blocks(path: Path, errors: list[str]) -> list[Table]:
    """파일에서 '-- 표:' 로 시작하는 머리 주석 블록을 모두 읽는다."""
    lines = path.read_text().split("\n")
    blocks: list[Table] = []
    i = 0
    while i < len(lines):
        if not lines[i].startswith("-- 표:"):
            i += 1
            continue
        fields: dict[str, str] = {}
        last = None
        order: list[str] = []
        while i < len(lines) and lines[i].startswith("--") and lines[i].strip() != "--":
            body = lines[i][2:]
            m = re.match(r"^ (\S+?): (.*)$", body)
            if m and m.group(1) in FIELDS:
                last = m.group(1)
                order.append(last)
                fields[last] = m.group(2).strip()
            elif body.startswith("   ") and last:
                fields[last] += " " + body.strip()
            else:
                errors.append(f"{path.relative_to(ROOT)}:{i + 1}: 틀에 없는 머리 주석 줄: {lines[i]!r}")
            i += 1
        expected = [f for f in FIELDS if f in order]
        if order != expected or len(set(order)) != len(order):
            errors.append(f"{path.relative_to(ROOT)}: 필드 순서가 틀과 다름 {order} (틀: {FIELDS})")
        missing = [f for f in REQUIRED if f not in fields]
        if missing:
            errors.append(f"{path.relative_to(ROOT)}: 필수 필드 없음 {missing}")
            continue
        m = re.match(r"^((?:raw|staging|marts|ops)\.[a-z][a-z0-9_]*)(?: — (.+))?$", fields["표"])
        if not m:
            errors.append(f"{path.relative_to(ROOT)}: '표:' 값은 '<층.표> — <설명>' 형식이어야 함: {fields['표']!r}")
            continue
        blocks.append(Table(m.group(1), m.group(2) or "", path, fields))
    return blocks


def strip_comments(sql: str) -> str:
    return "\n".join(re.sub(r"--.*", "", line) for line in sql.split("\n"))


def body_refs(path: Path) -> tuple[set[str], set[str]]:
    """SQL 본문(주석 제외)에서 (쓰는 표, 읽는 표)를 뽑는다."""
    code = strip_comments(path.read_text())
    written = {
        f"{a}.{b}"
        for a, b in re.findall(
            r"(?:TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INSERT\s+INTO|DELETE\s+FROM)\s+(raw|staging|marts|ops)\.(\w+)", code
        )
    }
    read = {
        f"{a}.{b}"
        for a, b in re.findall(r"\b(raw|staging|marts|ops)\.([A-Za-z_]\w*)", code)
        if not b.startswith("__") and b != "INFORMATION_SCHEMA"
    }
    return written, read - written


def ddl_specs() -> dict[str, str]:
    """SQL 파일의 CREATE 문에서 표별 '파티션 / 클러스터' 문자열을 만든다."""
    specs: dict[str, str] = {}
    for path in sql_files():
        code = strip_comments(path.read_text())
        for m in re.finditer(
            r"CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:raw|staging|marts|ops)\.\w+)", code
        ):
            stmt = code[m.end() : code.find(";", m.end())]
            depth, cut = 0, len(stmt)
            for j, ch in enumerate(stmt):  # 열 정의 괄호 뒤만 본다
                depth += ch == "("
                depth -= ch == ")"
                if depth == 0 and ch == ")":
                    cut = j + 1
                    break
            tail = stmt[cut:]
            tail = tail[: tail.find("OPTIONS")] if "OPTIONS" in tail else tail
            tail = tail[: re.search(r"\bAS\b", tail).start()] if re.search(r"\bAS\b", tail) else tail
            part = re.search(r"PARTITION BY\s+(.+?)(?=\s+CLUSTER BY|\s*$)", tail.strip(), re.S)
            clus = re.search(r"CLUSTER BY\s+(.+?)\s*$", tail.strip(), re.S)
            specs[m.group(1)] = f"{norm(part.group(1)) if part else '없음'} / {norm(clus.group(1)) if clus else '없음'}"
    return specs


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def sql_files() -> list[Path]:
    return (
        sorted((BQ_DIR / "sql").glob("*.sql"))
        + sorted((BQ_DIR / "sql" / "marts").glob("*.sql"))
        + sorted((BQ_DIR / "checks").glob("*.sql"))
    )


def parse_checks() -> list[dict[str, str]]:
    """checks/reconciliation.sql 의 검사 행(ID·종류·이름·통과 범위)을 순서대로 읽는다."""
    code = strip_comments(CHECKS.read_text())
    out: list[dict[str, str]] = []
    for chunk in re.split(r"\bUNION ALL\b", code):
        m = re.search(r"SELECT\s+'([CRI]\d+[a-z]?)'(?:\s+AS\s+\w+)?,\s*'(\w+)'(?:\s+AS\s+\w+)?,\s*'([^']*)'", chunk)
        if not m:
            continue
        bounds = re.findall(
            r"(-?[\d.]+)(?:\s+AS\s+lower_bound)?,\s*(-?[\d.]+)(?:\s+AS\s+upper_bound)?,\s*(?:NULL|FORMAT\(|CAST\(NULL)",
            chunk,
        )
        lo, hi = bounds[-1] if bounds else ("", "")
        out.append({"id": m.group(1), "category": m.group(2), "name": m.group(3), "lo": lo, "hi": hi})
    return out


def parse_steps(tables: dict[str, Table]) -> list[tuple[str, str, str]]:
    """load_all.sh 에서 (단계, 표, 파일) 순서를 읽는다."""
    text = LOAD_ALL.read_text()
    steps: list[tuple[str, str, str]] = []
    if re.search(r'"\$SQL/00_ops_tables\.sql"', text):
        steps.append(("0", "ops 표 준비", "sql/00_ops_tables.sql"))
    if re.search(r"want 1 && load_raw", text):
        for t in (t for t in tables.values() if t.layer == "raw"):
            steps.append(("1", t.name, f"schema/{t.short}.json"))
    loop = re.search(r"for m in (.*?); do\s*\n\s*run_sql (\d+) \"marts\.\$m\"", text, re.S)
    loop_names = loop.group(1).replace("\\", " ").split() if loop else []
    for m in re.finditer(r'run_sql (\d+) "?([\w.$]+)"?\s+"\$(SQL|ROOT/bigquery)/([^"]+)"', text):
        step, name, base, rel = m.groups()
        rel = rel if base == "ROOT/bigquery" else f"sql/{rel}"
        names = [(name.replace("$m", n), rel.replace("$m", n)) for n in loop_names] if "$m" in name else [(name, rel)]
        for n, r in names:
            if (step, n, r) not in steps:
                steps.append((step, n, r))
    return steps


def bq_select(sql: str) -> list[dict]:
    res = subprocess.run(
        [str(BQ), "query", "--quiet", "--format=json", "--max_rows=10000", "--maximum_bytes_billed=200000000", sql],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip())
    out = res.stdout.strip()
    return json.loads(out) if out else []


def validate(tables: dict[str, Table], checks: list[dict[str, str]], steps, errors: list[str]) -> None:
    check_ids = {c["id"] for c in checks}
    grouped = [cid for _, ids in CHECK_GROUPS for cid in ids]
    for cid in sorted(check_ids - set(grouped)):
        errors.append(f"checks/reconciliation.sql: 검사 {cid} 가 build_catalog.py CHECK_GROUPS 묶음에 없음")
    for cid in sorted({c for c in grouped if grouped.count(c) > 1 or c not in check_ids}):
        errors.append(f"build_catalog.py CHECK_GROUPS: {cid} 가 두 번 있거나 checks/reconciliation.sql 에 없음")
    for title, ids in CHECK_GROUPS:
        kinds = {c["category"] == "range" for c in checks if c["id"] in ids}
        if len(kinds) > 1:
            errors.append(f"build_catalog.py CHECK_GROUPS: {title} 에 차단·경보 검사가 섞임")
    specs = ddl_specs()
    for t in tables.values():
        for fname in ("원천", "소비"):
            for ref in tokens(t.fields[fname]) - set(tables):
                errors.append(f"{t.rel}: {t.name} {fname} 에 카탈로그에 없는 표 {ref}")
        for cid in re.split(r"[·,\s]+", t.fields.get("검사", "").strip()) if t.fields.get("검사") else []:
            if not CHECK_ID.match(cid) or cid not in check_ids:
                errors.append(f"{t.rel}: {t.name} 검사 {cid!r} 가 checks/reconciliation.sql 에 없음")
        if t.name in specs and norm(t.fields["파티션·클러스터"]) != specs[t.name]:
            errors.append(f"{t.rel}: {t.name} 파티션·클러스터 {t.fields['파티션·클러스터']!r} ≠ DDL {specs[t.name]!r}")
        if t.layer != "raw":
            written, read = body_refs(t.file)
            if t.name not in written:
                errors.append(f"{t.rel}: 본문이 {t.name} 을 쓰지 않음")
            declared = tokens(t.fields["원천"])
            if declared != read:
                errors.append(
                    f"{t.rel}: 원천 주석 ≠ 본문 참조. "
                    f"주석만 {sorted(declared - read)}, 본문만 {sorted(read - declared)}"
                )
    for t in tables.values():
        consumers = {u.name for u in tables.values() if t.name in tokens(u.fields["원천"])}
        declared = tokens(t.fields["소비"])
        if declared != consumers:
            errors.append(
                f"{t.rel}: {t.name} 소비 주석 ≠ 다른 표의 원천. "
                f"주석만 {sorted(declared - consumers)}, 빠짐 {sorted(consumers - declared)}"
            )
    for p in sql_files():
        rel = p.relative_to(BQ_DIR).as_posix()
        own = [t for t in tables.values() if t.file == p]
        if len(own) != 1:
            errors.append(f"{rel}: 머리 주석 표 블록이 {len(own)}개 (파일당 1개)")
            continue
        t = own[0]
        if rel.startswith("sql/marts/"):
            ok = p.stem == t.short and t.layer == "marts"
        elif rel.startswith("sql/"):
            m = re.match(r"^\d{2}_(\w+)$", p.stem)
            ok = bool(m) and m.group(1) in (t.short, f"{t.layer}_tables")
        else:
            ok = True
        if not ok:
            errors.append(f"{rel}: 파일 이름이 규약(sql/NN_<표>.sql, sql/marts/<표>.sql)과 다름 — 표 {t.name}")
        if not any(r == rel for _, _, r in steps):
            errors.append(f"{rel}: load_all.sh 실행 순서에 없음")
    for _, _, r in steps:
        if not (BQ_DIR / r).exists():
            errors.append(f"load_all.sh: 없는 파일 {r}")


def live(tables: dict[str, Table], errors: list[str]) -> tuple[list[dict], list[dict]]:
    """실물 표·파티션 대조와 마지막 실행 기록 조회."""
    rows = bq_select(
        " UNION ALL ".join(f"SELECT table_schema, table_name FROM {d}.INFORMATION_SCHEMA.TABLES" for d in LAYERS)
    )
    actual = {f"{r['table_schema']}.{r['table_name']}" for r in rows}
    if actual != set(tables):
        errors.append(
            f"INFORMATION_SCHEMA.TABLES ≠ 카탈로그. "
            f"실물만 {sorted(actual - set(tables))}, 카탈로그만 {sorted(set(tables) - actual)}"
        )
    cols = bq_select(
        " UNION ALL ".join(
            "SELECT table_schema, table_name, column_name, is_partitioning_column, clustering_ordinal_position "
            f"FROM {d}.INFORMATION_SCHEMA.COLUMNS "
            "WHERE is_partitioning_column = 'YES' OR clustering_ordinal_position IS NOT NULL"
            for d in LAYERS
        )
    )
    part: dict[str, str] = {}
    clus: dict[str, list[tuple[int, str]]] = {}
    for c in cols:
        key = f"{c['table_schema']}.{c['table_name']}"
        if c["is_partitioning_column"] == "YES":
            part[key] = c["column_name"]
        if c.get("clustering_ordinal_position"):
            clus.setdefault(key, []).append((int(c["clustering_ordinal_position"]), c["column_name"]))
    for t in tables.values():
        if t.name not in actual:
            continue
        p_decl, c_decl = [s.strip() for s in t.fields["파티션·클러스터"].split("/", 1)]
        p_real = part.get(t.name)
        c_real = ", ".join(n for _, n in sorted(clus.get(t.name, []))) or "없음"
        p_ok = (p_decl == "없음") if p_real is None else re.search(rf"\b{p_real}\b", p_decl) is not None
        if not p_ok or norm(c_decl) != c_real:
            errors.append(
                f"{t.rel}: {t.name} 파티션·클러스터 주석 {t.fields['파티션·클러스터']!r} "
                f"≠ 실물 ({p_real or '없음'} / {c_real})"
            )
    build = bq_select(
        "SELECT step, step_name, run_id, FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', ended_at, 'Asia/Seoul') AS ended_kst, "
        "TIMESTAMP_DIFF(ended_at, started_at, SECOND) AS sec, rows_out, bytes_processed, status "
        "FROM ops.build_log "
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY step_name ORDER BY started_at DESC) = 1 "
        "ORDER BY SAFE_CAST(step AS INT64), started_at"
    )
    recon = bq_select(
        "SELECT run_id, check_id, ROUND(observed, 4) AS observed, passed, "
        "FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', checked_at, 'Asia/Seoul') AS checked_kst "
        "FROM ops.reconciliation WHERE run_id = (SELECT MAX(run_id) FROM ops.reconciliation)"
    )
    return build, recon


def wrapper_setting(name: str) -> str:
    """scripts/bq.sh 에 고정된 PROJECT·LOCATION 값을 읽는다."""
    m = re.search(rf'^{name}="([^"]+)"', BQ.read_text(), re.M)
    if not m:
        raise RuntimeError(f"scripts/bq.sh 에 {name} 없음")
    return m.group(1)


def split_keys(t: Table, cols: list[str], errors: list[str]) -> list[str]:
    """키 주석을 열 이름 배열로. '이 네 열' 은 컬럼 순서 앞 N개."""
    text = t.fields["키"].strip()
    m = re.match(r"^이 (\S+) 열$", text)
    if m:
        n = KEY_COUNT.get(m.group(1))
        if n is None or n > len(cols):
            errors.append(f"{t.rel}: {t.name} 키 {text!r} 를 열 이름으로 풀 수 없음")
            return []
        return cols[:n]
    names = [k.strip() for k in text.strip("()").split(",")]
    if not all(re.fullmatch(r"[a-z][a-z0-9_]*", k) for k in names):
        errors.append(f"{t.rel}: {t.name} 키 {text!r} 를 열 이름으로 풀 수 없음")
        return []
    missing = [k for k in names if k not in cols]
    if missing:
        errors.append(f"{t.rel}: {t.name} 키 {missing} 가 실물 열에 없음")
    return names


def consumer_list(text: str) -> list[str]:
    """소비 주석을 표·화면 목록으로. 첫 문장은 ' — ' 앞까지 쉼표로 나누고, 뒤 문장은 표 이름만 줍는다."""
    prev = None
    while prev != text:
        prev, text = text, re.sub(r"\s*\([^()]*\)", "", text)
    out: list[str] = []
    for i, sentence in enumerate(re.split(r"\.\s+", text.strip().rstrip("."))):
        head = sentence.split(" — ")[0] if i == 0 else sentence
        for piece in (p.strip() for p in head.split(",")):
            found = sorted(tokens(piece))
            if found:
                out.extend(found)
            elif i == 0 and piece:
                out.append(piece)
    return list(dict.fromkeys(out))


def export_catalog(tables: dict[str, Table], errors: list[str]) -> dict | None:
    """데이터 페이지 계약(docs/backlog.md §6)대로 표·컬럼 카탈로그를 만든다."""
    cols = bq_select(
        " UNION ALL ".join(
            "SELECT c.table_schema, c.table_name, c.column_name, c.ordinal_position, c.data_type, "
            "c.is_partitioning_column, c.clustering_ordinal_position, IFNULL(f.description, '') AS description "
            f"FROM {d}.INFORMATION_SCHEMA.COLUMNS c "
            f"LEFT JOIN {d}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS f "
            "ON f.table_name = c.table_name AND f.field_path = c.column_name"
            for d in LAYERS
        )
    )
    stats = bq_select(
        " UNION ALL ".join(f"SELECT dataset_id, table_id, row_count, size_bytes FROM {d}.__TABLES__" for d in LAYERS)
    )
    by_table: dict[str, list[dict]] = {}
    for c in sorted(cols, key=lambda c: int(c["ordinal_position"])):
        by_table.setdefault(f"{c['table_schema']}.{c['table_name']}", []).append(c)
    size = {f"{s['dataset_id']}.{s['table_id']}": s for s in stats}
    if set(by_table) != set(tables) or set(size) != set(tables):
        errors.append(
            f"export: 실물 표 {len(by_table)}개(COLUMNS)·{len(size)}개(__TABLES__) ≠ 카탈로그 {len(tables)}개"
        )
        return None
    out_tables = []
    for t in tables.values():
        tc = by_table[t.name]
        names = [c["column_name"] for c in tc]
        part = next((c["column_name"] for c in tc if c["is_partitioning_column"] == "YES"), None)
        clus = [
            c["column_name"]
            for c in sorted(
                (c for c in tc if c.get("clustering_ordinal_position")),
                key=lambda c: int(c["clustering_ordinal_position"]),
            )
        ]
        src = sorted(tokens(t.fields["원천"])) or re.findall(r"data/raw/[\w.]+", t.fields["원천"])
        checks = [c for c in re.split(r"[·,\s]+", t.fields.get("검사", "").strip()) if c]
        out_tables.append(
            {
                "layer": t.layer,
                "name": t.short,
                "description": t.desc,
                "grain": t.fields["1행"],
                "keys": split_keys(t, names, errors),
                "partition": part,
                "cluster": clus,
                "rows": int(size[t.name]["row_count"]),
                "size_mb": round(int(size[t.name]["size_bytes"]) / 1024 / 1024, 1),
                "sources": src,
                "consumers": consumer_list(t.fields["소비"]),
                "checks": checks,
                "sql": t.file.relative_to(ROOT).as_posix(),
                "columns": [
                    {"name": c["column_name"], "type": c["data_type"], "description": c["description"]} for c in tc
                ],
            }
        )
    return {
        "built_at": datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds"),
        "project": wrapper_setting("PROJECT"),
        "location": wrapper_setting("LOCATION"),
        "layers": LAYERS,
        "tables": out_tables,
    }


def cell(s: str) -> str:
    return s.replace("|", "\\|")


def node(name: str) -> str:
    return name.replace(".", "_")


def render(tables: dict[str, Table], checks, steps, build, recon, offline: bool) -> str:
    out: list[str] = []
    w = out.append
    w("<!-- 생성물: python3 bigquery/build_catalog.py 가 SQL 머리 주석에서 만든다. 직접 고치지 않는다. -->")
    w("# bigquery — 표 카탈로그\n")
    w(
        "합성 이벤트 로그와 서비스 원장을 raw → staging → marts → ops 네 층으로 쌓는 SQL 모음. "
        f"표 {len(tables)}개, 층마다 BigQuery 데이터셋 하나. 이 문서의 모든 표 정보는 각 SQL 파일 머리 주석에서 온다.\n"
    )
    w("```bash")
    w("bigquery/load_all.sh                     # 적재 → 정제 → 마트 → 검사 → 신선도 (0~9단계)")
    w("bigquery/load_all.sh --only 8            # 검사만")
    w("python3 bigquery/build_catalog.py        # 이 문서 재생성 (주석·본문·실물 대조, 어긋나면 exit 1)")
    w("```\n")
    w("운영 절차·재실행·실패 조치는 [docs/pipeline.md](../docs/pipeline.md).\n")
    w("머리 주석 틀 (모든 SQL 파일 첫 줄부터, 검사는 있을 때만):\n")
    w("```sql")
    w("-- 표: <층.표> — <한 줄 설명>")
    w("-- 1행: <그레인>")
    w("-- 키: <고유 키>")
    w("-- 파티션·클러스터: <파티션 식 또는 없음> / <클러스터 열 또는 없음>")
    w("-- 원천: <읽는 표와 용도>")
    w("-- 소비: <이 표를 읽는 표·화면>")
    w("-- 검사: <checks/reconciliation.sql 의 검사 ID>")
    w("--")
    w("-- <규칙·메모 자유 서술>")
    w("```\n")

    w("## 표 카탈로그\n")
    for layer in LAYERS:
        rows = [t for t in tables.values() if t.layer == layer]
        w(f"### {LAYER_TITLE[layer]}\n")
        w("| 표 | 1행 | 키 | 파티션 / 클러스터 | 원천 | 소비 | 검사 | 파일 |")
        w("|---|---|---|---|---|---|---|---|")
        for t in rows:
            f = t.fields
            w(
                f"| **{t.short}**<br>{cell(t.desc)} | {cell(f['1행'])} | {cell(f['키'])} "
                f"| {cell(f['파티션·클러스터'])} "
                f"| {cell(f['원천'])} | {cell(f['소비'])} | {cell(f.get('검사', ''))} | [{t.file.name}]({t.rel}) |"
            )
        w("")

    w("## 계보\n")
    w("원천 주석에서 뽑은 간선. 점선은 검사(ops.reconciliation)가 읽는 층 — 표별 대상은 검사 절의 대상 표 열.\n")
    w("```mermaid")
    w("flowchart LR")
    for layer in LAYERS:
        w(f"  subgraph {layer}")
        for t in (t for t in tables.values() if t.layer == layer):
            w(f'    {node(t.name)}["{t.short}"]')
        w("  end")
    for t in tables.values():
        srcs = sorted(tokens(t.fields["원천"]))
        if t.layer == "ops":
            for layer in sorted({s.split(".")[0] for s in srcs}, key=LAYERS.index):
                w(f"  {layer} -.-> {node(t.name)}")
            continue
        for src in srcs:
            w(f"  {node(src)} --> {node(t.name)}")
    w("```\n")

    w("## 실행 순서\n")
    w("`load_all.sh` 단계와 파일. 단계 안에서는 위에서 아래 순서로 돈다.\n")
    w("| 단계 | 표 | 파일 |")
    w("|---|---|---|")
    for step, name, rel in steps:
        w(f"| {step} | {name} | [{rel}]({rel}) |")
    w("")

    w("## 검사\n")
    w(
        "[checks/reconciliation.sql](checks/reconciliation.sql), 8단계. "
        "대조·무결성은 차단 검사다. 하나라도 통과하지 못하면 `load_all.sh` 가 exit 1 로 멈추고, "
        "`dashboard/scripts/extract.py` 는 마지막 실행에 차단 실패가 있거나 "
        "그 뒤 1~7단계가 다시 돌았으면 추출을 거부한다. "
        "범위는 경보 검사다. 결과를 기록하고 범위 밖 건수만 출력한다. ID 는 추가된 순서이고 표는 목적별로 묶었다.\n"
    )
    by_check: dict[str, list[str]] = {}
    for t in tables.values():
        for cid in re.split(r"[·,\s]+", t.fields.get("검사", "").strip()):
            if cid:
                by_check.setdefault(cid, []).append(t.short)
    last = {r["check_id"]: r for r in recon}
    by_id = {c["id"]: c for c in checks}
    kind = {"reconcile": "대조", "range": "범위", "integrity": "무결성"}
    for title, ids in CHECK_GROUPS:
        warn = by_id[ids[0]]["category"] == "range"
        w(f"### {title} ({'경보' if warn else '차단'} {len(ids)}개)\n")
        head = "| ID | 종류 | 이름 | 통과 기준 | 대상 표 |"
        if last:
            head += " 최근 관측 | 판정 |"
        w(head)
        w("|" + "---|" * (head.count("|") - 1))
        for cid in ids:
            c = by_id[cid]
            crit = f"{c['lo']} ~ {c['hi']}" if c["category"] == "range" else "0"
            targets = ", ".join(by_check.get(cid, []))
            row = f"| {cid} | {kind.get(c['category'], c['category'])} | {cell(c['name'])} | {crit} | {targets} |"
            if last:
                r = last.get(cid, {})
                bad = "범위 밖" if warn else "실패"
                row += f" {r.get('observed', '')} | {'통과' if r.get('passed') == 'true' else (bad if r else '')} |"
            w(row)
        w("")

    w("## 마지막 실행\n")
    if offline:
        w("오프라인 생성 — 실행 기록을 조회하지 않았다.\n")
    else:
        if recon:
            warn_ids = {c["id"] for c in checks if c["category"] == "range"}
            block = [r for r in recon if r["check_id"] not in warn_ids]
            failed = sorted(r["check_id"] for r in block if r["passed"] != "true")
            out_of_range = sorted(r["check_id"] for r in recon if r["check_id"] in warn_ids and r["passed"] != "true")
            w(
                f"검사 run `{recon[0]['run_id']}` ({recon[0]['checked_kst']} KST): "
                f"차단 {len(block) - len(failed)}/{len(block)} 통과"
                + (f"(실패 {', '.join(failed)})" if failed else "")
                + f", 경보 {len(recon) - len(block)}개 중 범위 밖 {len(out_of_range)}"
                + (f"({', '.join(out_of_range)})" if out_of_range else "")
                + "\n"
            )
        w("단계별 마지막 기록 (`ops.build_log`, 시각 KST):\n")
        w("| 단계 | 표 | run | 종료 | 초 | 행 | 처리 바이트 | 상태 |")
        w("|---|---|---|---|---:|---:|---:|---|")
        for r in build:
            w(
                f"| {r['step']} | {r['step_name']} | {r['run_id']} | {r['ended_kst']} | {r['sec']} "
                f"| {int(r['rows_out'] or 0):,} | {int(r['bytes_processed'] or 0):,} | {r['status']} |"
            )
        w("")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="BigQuery 조회 생략")
    ap.add_argument("--export", type=Path, metavar="경로", help="데이터 페이지용 catalog.json 경로")
    args = ap.parse_args()

    errors: list[str] = []
    blocks: list[Table] = parse_blocks(RAW_HEADERS, errors)
    for p in sql_files():
        text = p.read_text()
        if not text.startswith("-- 표:"):
            errors.append(f"{p.relative_to(ROOT)}: 첫 줄이 '-- 표:' 머리 주석이 아님")
            continue
        found = parse_blocks(p, errors)
        blocks.extend(found[:1])
    tables: dict[str, Table] = {}
    for t in blocks:
        if t.name in tables:
            errors.append(f"{t.rel}: {t.name} 이 {tables[t.name].rel} 에도 선언됨")
        tables[t.name] = t
    tables = dict(sorted(tables.items(), key=lambda kv: LAYERS.index(kv[1].layer)))
    checks = parse_checks()
    if not checks:
        errors.append("checks/reconciliation.sql: 검사 행을 읽지 못함")
    steps = parse_steps(tables)
    validate(tables, checks, steps, errors)

    build: list[dict] = []
    recon: list[dict] = []
    catalog: dict | None = None
    if not args.offline and not errors:
        try:
            build, recon = live(tables, errors)
            if args.export and not errors:
                catalog = export_catalog(tables, errors)
        except RuntimeError as e:
            errors.append(f"BigQuery 조회 실패: {e}")

    if errors:
        print(f"카탈로그 생성 중단 — {len(errors)}건", file=sys.stderr)
        for e in errors:
            print(f"  {e}", file=sys.stderr)
        return 1
    README.write_text(render(tables, checks, steps, build, recon, args.offline) + "\n")
    print(
        f"{README.relative_to(ROOT)} — 표 {len(tables)}개, 검사 {len(checks)}개, 단계 행 {len(steps)}개"
        + (" (오프라인)" if args.offline else "")
    )
    if args.export and args.offline:
        print("--offline 이라 catalog.json 은 쓰지 않았다 (행 수·컬럼은 실물 조회가 필요)")
    elif catalog:
        args.export.parent.mkdir(parents=True, exist_ok=True)
        args.export.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n")
        ncol = sum(len(t["columns"]) for t in catalog["tables"])
        print(f"{args.export} — 표 {len(catalog['tables'])}개, 컬럼 {ncol}개, {args.export.stat().st_size:,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
