# dashboard — Placewave KPI 대시보드 (정적 웹)

**합성 데이터 · 실제 서비스 데이터 아님.** 마트를 분할 파일(`public/data/`)로 뽑아 정적 웹에서 읽는다. 실시간 조회는 없다.

- 스택: Vite + React 19 + TypeScript + Tailwind 3 + Recharts
- 입력: `public/data/` — `index.json`(첫 화면) + 지연 표 JSON + `person_day` 바이너리 (계약은 `docs/dashboard.md` §4)
- 탭·지표·필터 원칙: `docs/dashboard.md`

## public/data/ 를 만드는 경로

| 경로 | 명령 | 언제 |
|---|---|---|
| BigQuery 마트 | `uv run dashboard/scripts/extract.py` | 마트 적재 후. `scripts/bq.sh`(개인 GCP 래퍼)로 `marts.*` 를 SELECT 해 분할 파일로 쓴다 |
| 합친 JSON 분할 | `uv run dashboard/scripts/extract.py --from-json <file.json>` | BigQuery 없이. 입력은 표 키를 한 파일에 담은 JSON(샘플 생성기 출력 등) |
| 합성 샘플 | `uv run dashboard/scripts/make_sample_data.py --out /tmp/sample.json` → 위 `--from-json` | 마트 없이 화면 개발. 시드 고정(20260923)·사람 3,500명·52주 |

저장소 루트에서 실행한다. 추출의 기본 출력 폴더는 `dashboard/public/data/` 이고 `--out <폴더>` 로 바꾼다. 정적 배포가 이 폴더를 그대로 쓰므로 커밋한다(현재 BigQuery 추출본). 샘플은 `--out /tmp/…` 로 따로 뽑아 덮어쓰지 않는다. `meta.source` 가 `sample` / `bigquery` 로 구분된다.

`index.json` 을 뺀 파일은 이름에 내용 해시 8자리가 붙고(`hourly_metrics.e0c3f16c.json`) `index.json` 의 `files` 가 가리킨다. 다시 추출하면 폴더에 남은 이전 해시 파일은 지운다.

## 실행

```bash
cd dashboard
npm ci
npm run dev          # 개발 서버
npm run build        # tsc + vite build → dist/
npm run capture      # dist 를 preview 로 띄워 탭별·페이지별 캡처 → captures/ (gitignore)
npm run capture -- --all   # + 보기 전환·1일·1년·다크·폰 폭
```

`dist/` 는 `base: './'` 로 빌드되어 어떤 정적 호스트 하위 경로에도 올릴 수 있다. `public/data/` 는 `dist/data/` 로 함께 복사된다.

## 구조

```
src/
  App.tsx              탭·보기 정의, 필터 바 조립
  About.tsx            프로젝트 개요 (?page=about)
  DataPage.tsx         데이터 카탈로그 (?page=data, catalog.json + 마트 미리보기)
  lib/state.ts         URL 쿼리 ↔ 필터 상태
  lib/source.ts        index.json 로드, 지연 표 useTable(key)(메모리 캐시·동시 요청 병합), person_day.bin 디코드
  lib/persons.ts       person_day 비트 배치·기간 고유 사람 수
  lib/agg.ts           기간 해석·세그먼트 필터·합산·일/주 버킷
  lib/labels.ts        채널·가격대·퍼널 라벨, 색 슬롯
  components/          Header(페이지 이동·기준일·테마) · FilterBar · ui(타일·카드·범례) · charts(추이·히트맵·퍼널) · DataTable · ReachTable(도달률 히트맵 표) · PathSankey(경로 생키)
  tabs/                탭별 화면 (각 탭 = 스코어보드 → 추이 → 표)
scripts/
  make_sample_data.py  합성 샘플(합친 JSON 한 파일)
  extract.py           BigQuery 마트(또는 --from-json) → public/data/ 분할
  capture.mjs          헤드리스 캡처
```
